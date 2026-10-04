import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logEntry } = vi.hoisted(() => ({
  logEntry: { create: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: { logEntry } }));

type Store = typeof import("@/lib/log-store");
let store: Store;
const now = new Date("2026-10-07T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const groups = (counts: Record<string, number>) => Object.entries(counts).map(([event, count]) => ({ event, _count: { _all: count } }));
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // A fresh module for each test resets the purge clock and the in-flight alert check.
  vi.resetModules();
  store = await import("@/lib/log-store");
  for (const mock of Object.values(logEntry)) mock.mockReset();
  logEntry.create.mockResolvedValue({});
  logEntry.deleteMany.mockResolvedValue({ count: 0 });
  logEntry.groupBy.mockResolvedValue([]);
  logEntry.findFirst.mockResolvedValue(null);
  logEntry.findMany.mockResolvedValue([]);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  errors.mockRestore();
  warnings.mockRestore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("saving entries", () => {
  it("stores the level, event, context, and time of a line", async () => {
    await store.saveLogEntry({ event: "upload_rejected", level: "warn", timestamp: now.toISOString(), reason: "empty_file", courseId: "course-a" });
    expect(logEntry.create).toHaveBeenCalledWith({ data: { level: "WARN", event: "upload_rejected", context: { reason: "empty_file", courseId: "course-a" }, createdAt: now } });
  });
  it("checks the alert threshold after an error, but not after a warning", async () => {
    await store.saveLogEntry({ event: "upload_rejected", level: "warn", timestamp: now.toISOString() });
    expect(logEntry.groupBy).not.toHaveBeenCalled();
    await store.saveLogEntry({ event: "upload_failed", level: "error", timestamp: now.toISOString() });
    expect(logEntry.groupBy).toHaveBeenCalledTimes(1);
  });
});

describe("retention", () => {
  it("deletes entries older than 30 days", async () => {
    logEntry.deleteMany.mockResolvedValue({ count: 3 });
    expect(await store.purgeOldEntries(now)).toBe(3);
    expect(logEntry.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: minutesAgo(30 * 24 * 60) } } });
  });
  it("runs at most once an hour unless forced", async () => {
    await store.purgeOldEntries(now);
    await store.purgeOldEntries(new Date(now.getTime() + 30 * 60_000));
    expect(logEntry.deleteMany).toHaveBeenCalledTimes(1);
    await store.purgeOldEntries(new Date(now.getTime() + 30 * 60_000), true);
    await store.purgeOldEntries(new Date(now.getTime() + 2 * 60 * 60_000));
    expect(logEntry.deleteMany).toHaveBeenCalledTimes(3);
  });
});

describe("alert threshold", () => {
  it("does nothing below the threshold", async () => {
    logEntry.groupBy.mockResolvedValue(groups({ physical_file_not_found: 4 }));
    expect(await store.checkAlert(now)).toBe(false);
    expect(logEntry.groupBy).toHaveBeenCalledWith({ by: ["event"], where: { level: "ERROR", createdAt: { gte: minutesAgo(10) } }, _count: { _all: true } });
    expect(logEntry.create).not.toHaveBeenCalled();
  });
  it("records one alert with event names and counts at the threshold", async () => {
    logEntry.groupBy.mockResolvedValue(groups({ file_open_failed: 2, physical_file_not_found: 3 }));
    expect(await store.checkAlert(now)).toBe(true);
    expect(logEntry.create).toHaveBeenCalledWith({
      data: {
        level: "INFO", event: "monitoring_alert_triggered", createdAt: now,
        context: { count: "5", threshold: "5", windowMinutes: "10", events: "physical_file_not_found:3,file_open_failed:2", webhook: "not_configured" },
      },
    });
    expect(logged()).toEqual([expect.objectContaining({ event: "monitoring_alert_triggered", level: "info", count: "5" })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("respects the cooldown, so one incident raises one alert", async () => {
    logEntry.groupBy.mockResolvedValue(groups({ physical_file_not_found: 9 }));
    logEntry.findFirst.mockResolvedValue({ id: "alert-1" });
    expect(await store.checkAlert(now)).toBe(false);
    expect(logEntry.findFirst).toHaveBeenCalledWith({ where: { event: "monitoring_alert_triggered", createdAt: { gte: minutesAgo(10) } }, select: { id: true } });
    expect(logEntry.create).not.toHaveBeenCalled();
  });
  it("alerts again once the cooldown has passed", async () => {
    logEntry.groupBy.mockResolvedValue(groups({ physical_file_not_found: 9 }));
    // The previous alert is older than the cooldown, so the lookup finds nothing.
    logEntry.findFirst.mockImplementation(async ({ where }) => (where.createdAt.gte <= minutesAgo(11) ? { id: "old-alert" } : null));
    expect(await store.checkAlert(now)).toBe(true);
  });
  it("shares one check between concurrent errors in the same process", async () => {
    logEntry.groupBy.mockResolvedValue(groups({ physical_file_not_found: 6 }));
    const results = await Promise.all([store.checkAlert(now), store.checkAlert(now), store.checkAlert(now)]);
    expect(results).toEqual([true, true, true]);
    expect(logEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(logEntry.create).toHaveBeenCalledTimes(1);
  });
  it("reads the threshold, window, and cooldown from the environment", async () => {
    vi.stubEnv("ALERT_THRESHOLD", "2");
    vi.stubEnv("ALERT_WINDOW_MINUTES", "1");
    vi.stubEnv("ALERT_COOLDOWN_MINUTES", "30");
    logEntry.groupBy.mockResolvedValue(groups({ upload_failed: 2 }));
    expect(await store.checkAlert(now)).toBe(true);
    expect(logEntry.groupBy.mock.calls[0][0].where.createdAt.gte).toEqual(minutesAgo(1));
    expect(logEntry.findFirst.mock.calls[0][0].where.createdAt.gte).toEqual(minutesAgo(30));
  });
  it("falls back to the defaults for empty or invalid settings", () => {
    vi.stubEnv("ALERT_THRESHOLD", "");
    vi.stubEnv("ALERT_WINDOW_MINUTES", "-3");
    vi.stubEnv("ALERT_COOLDOWN_MINUTES", "soon");
    expect(store.alertConfig()).toEqual({ threshold: 5, windowMinutes: 10, cooldownMinutes: 10, webhookUrl: undefined });
  });
});

const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));

describe("webhook", () => {
  beforeEach(() => logEntry.groupBy.mockResolvedValue(groups({ physical_file_not_found: 5, file_open_failed: 1 })));

  it("posts one Discord message with event names and counts only", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.example/api/webhooks/1/abc");
    await store.checkAlert(now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.example/api/webhooks/1/abc");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toContain("6 errors in the last 10 minutes (threshold 5)");
    expect(body.content).toContain("physical_file_not_found: 5");
    expect(body.content).toContain("file_open_failed: 1");
    expect(logEntry.create.mock.calls[0][0].data.context.webhook).toBe("configured");
  });
  it("puts nothing but event names and counts in the message", () => {
    const message = store.alertMessage(3, 10, 3, [{ event: "upload_failed", count: 3 }]);
    expect(message).toBe("**Upcomer alert:** 3 errors in the last 10 minutes (threshold 3).\n• upload_failed: 3\nDetails: /admin/monitoring");
  });
  it.each(["http://discord.example/hook", "ftp://example.com/hook", "not a url", "javascript:alert(1)"])("ignores the unsafe webhook URL %s", async raw => {
    vi.stubEnv("ALERT_WEBHOOK_URL", raw);
    await store.checkAlert(now);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows plain http to this machine, for local testing", () => {
    expect(store.webhookUrl("http://127.0.0.1:9999/hook")).toBe("http://127.0.0.1:9999/hook");
    expect(store.webhookUrl("http://localhost:9999/hook")).toBe("http://localhost:9999/hook");
  });
  it.each([
    ["rejects", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["answers 500", () => fetchMock.mockResolvedValue({ ok: false, status: 500 })],
  ])("swallows a webhook that %s and warns once without the URL", async (_case, arrange) => {
    arrange();
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.example/api/webhooks/1/secret-part");
    await expect(store.checkAlert(now)).resolves.toBe(true);
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(String(warnings.mock.calls[0][0])).toContain("alert_webhook_failed");
    expect(String(warnings.mock.calls[0][0])).not.toContain("secret-part");
  });
});

describe("reads for the monitoring page", () => {
  it("filters entries by level, event, and range, newest 100 first", async () => {
    logEntry.findMany.mockResolvedValue([{ id: "1", event: "upload_failed", level: "ERROR", createdAt: now, context: { courseId: "course-a" } }]);
    const result = await store.getLogEntries({ level: "error", event: "upload_failed", range: "1h" }, now);
    expect(logEntry.findMany).toHaveBeenCalledWith({ where: { createdAt: { gte: minutesAgo(60) }, level: "ERROR", event: "upload_failed" }, orderBy: { createdAt: "desc" }, take: 100 });
    expect(result).toEqual({ range: "1h", level: "error", event: "upload_failed", entries: [{ id: "1", event: "upload_failed", level: "error", createdAt: now, context: { courseId: "course-a" } }] });
  });
  it("ignores an unknown level or range", async () => {
    const result = await store.getLogEntries({ level: "debug", range: "1y" }, now);
    expect(logEntry.findMany.mock.calls[0][0].where).toEqual({ createdAt: { gte: minutesAgo(24 * 60) } });
    expect(result.range).toBe("24h");
    expect(result.level).toBeUndefined();
  });
  it("summarizes the last 24 hours by event and level", async () => {
    logEntry.groupBy.mockResolvedValue([
      { event: "login_failed", level: "WARN", _count: { _all: 4 } },
      { event: "physical_file_not_found", level: "ERROR", _count: { _all: 2 } },
    ]);
    const summary = await store.getMonitoringSummary(now);
    expect(logEntry.groupBy.mock.calls[0][0].where).toEqual({ createdAt: { gte: minutesAgo(24 * 60) } });
    expect(summary.rows).toEqual([{ event: "physical_file_not_found", level: "error", count: 2 }, { event: "login_failed", level: "warn", count: 4 }]);
    expect(summary.totals).toEqual({ error: 2, warn: 4, info: 0 });
  });
  it.each([
    ["no errors and no recent alert", [], null, false],
    ["errors at the threshold", groups({ upload_failed: 5 }), null, true],
    ["a recent alert", [], { createdAt: minutesAgo(3), context: { count: "7" } }, true],
    ["only an old alert", [], { createdAt: minutesAgo(60), context: { count: "7" } }, false],
  ])("reports the alert status with %s", async (_case, counts, latest, active) => {
    logEntry.groupBy.mockResolvedValue(counts);
    logEntry.findFirst.mockResolvedValue(latest);
    const status = await store.getAlertStatus(now);
    expect(status.active).toBe(active);
    expect(status).toMatchObject({ threshold: 5, windowMinutes: 10, webhookConfigured: false });
  });
});
