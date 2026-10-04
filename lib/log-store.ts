import type { LogLevel as DbLogLevel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sanitizeContext, type LogLevel, type LogLine } from "@/lib/logger";

// Persisted logs, retention, and threshold alerting (US-87). Loaded by the logger on the Node runtime only.
// Nothing here calls logError, so a failure while saving a log can never log again.

const DB_LEVEL: Record<LogLevel, DbLogLevel> = { error: "ERROR", warn: "WARN", info: "INFO" };
export const ALERT_EVENT = "monitoring_alert_triggered";
export const RETENTION_DAYS = 30;
const MINUTE = 60_000;
const PURGE_EVERY_MS = 60 * MINUTE;

const positiveInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

// Only https, or plain http to this machine for local testing; anything else is ignored.
export function webhookUrl(raw = process.env.ALERT_WEBHOOK_URL) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
  } catch {
    // Not a URL.
  }
  return undefined;
}

export function alertConfig() {
  const windowMinutes = positiveInt("ALERT_WINDOW_MINUTES", 10);
  return {
    threshold: positiveInt("ALERT_THRESHOLD", 5),
    windowMinutes,
    cooldownMinutes: positiveInt("ALERT_COOLDOWN_MINUTES", windowMinutes),
    webhookUrl: webhookUrl(),
  };
}

export async function saveLogEntry(line: LogLine) {
  const { event, level, timestamp, ...context } = line;
  await db.logEntry.create({ data: { level: DB_LEVEL[level], event, context, createdAt: new Date(timestamp) } });
  await purgeOldEntries();
  if (level === "error") await checkAlert();
}

let lastPurge = 0;
// Deletes entries older than 30 days, at most once an hour per server process unless forced.
export async function purgeOldEntries(now = new Date(), force = false) {
  if (!force && now.getTime() - lastPurge < PURGE_EVERY_MS) return 0;
  lastPurge = now.getTime();
  const { count } = await db.logEntry.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * MINUTE) } } });
  return count;
}

async function errorCounts(since: Date) {
  const groups = await db.logEntry.groupBy({ by: ["event"], where: { level: "ERROR", createdAt: { gte: since } }, _count: { _all: true } });
  const events = groups.map(group => ({ event: group.event, count: group._count._all })).sort((a, b) => b.count - a.count || a.event.localeCompare(b.event));
  return { total: events.reduce((sum, item) => sum + item.count, 0), events };
}

let inFlight: Promise<boolean> | null = null;
// Records one alert, and sends one webhook message, when error events reach the threshold within the window.
// Returns true when an alert was raised. Concurrent errors in this process share one check.
export function checkAlert(now = new Date()) {
  inFlight ??= runAlertCheck(now).finally(() => { inFlight = null; });
  return inFlight;
}

async function runAlertCheck(now: Date) {
  const { threshold, windowMinutes, cooldownMinutes, webhookUrl: url } = alertConfig();
  const { total, events } = await errorCounts(new Date(now.getTime() - windowMinutes * MINUTE));
  if (total < threshold) return false;
  // Cooldown: one incident raises one alert.
  const recent = await db.logEntry.findFirst({ where: { event: ALERT_EVENT, createdAt: { gte: new Date(now.getTime() - cooldownMinutes * MINUTE) } }, select: { id: true } });
  if (recent) return false;

  const context = sanitizeContext({
    count: String(total), threshold: String(threshold), windowMinutes: String(windowMinutes),
    events: events.map(item => `${item.event}:${item.count}`).join(","), webhook: url ? "configured" : "not_configured",
  });
  await db.logEntry.create({ data: { level: "INFO", event: ALERT_EVENT, context, createdAt: now } });
  console.error(JSON.stringify({ event: ALERT_EVENT, level: "info", timestamp: now.toISOString(), ...context }));
  if (url) await sendWebhook(url, alertMessage(total, windowMinutes, threshold, events));
  return true;
}

// Event names and counts only: never IDs, routes, or anything a user typed.
export function alertMessage(total: number, windowMinutes: number, threshold: number, events: { event: string; count: number }[]) {
  return [
    `**Upcomer alert:** ${total} errors in the last ${windowMinutes} minutes (threshold ${threshold}).`,
    ...events.map(item => `• ${item.event}: ${item.count}`),
    "Details: /admin/monitoring",
  ].join("\n");
}

async function sendWebhook(url: string, content: string) {
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      // Discord's format; no mentions can be triggered.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
  } catch (error) {
    // The URL is a secret, so it is never printed.
    console.warn(JSON.stringify({ event: "alert_webhook_failed", level: "warn", timestamp: new Date().toISOString(), errorType: error instanceof Error ? error.name : "Unknown" }));
  }
}

// ---------- Reads for /admin/monitoring ----------

export const RANGES = { "1h": 60, "24h": 24 * 60, "7d": 7 * 24 * 60, "30d": 30 * 24 * 60 } as const;
export type Range = keyof typeof RANGES;
export const LEVELS: LogLevel[] = ["error", "warn", "info"];
const levelFromDb = (level: DbLogLevel) => level.toLowerCase() as LogLevel;

export async function getMonitoringSummary(now = new Date()) {
  const groups = await db.logEntry.groupBy({ by: ["event", "level"], where: { createdAt: { gte: new Date(now.getTime() - RANGES["24h"] * MINUTE) } }, _count: { _all: true } });
  const rows = groups.map(group => ({ event: group.event, level: levelFromDb(group.level), count: group._count._all }))
    .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.count - a.count || a.event.localeCompare(b.event));
  const totals = Object.fromEntries(LEVELS.map(level => [level, rows.filter(row => row.level === level).reduce((sum, row) => sum + row.count, 0)])) as Record<LogLevel, number>;
  return { rows, totals };
}

export async function getLogEntries(filters: { level?: string; event?: string; range?: string }, now = new Date()) {
  const range: Range = filters.range && filters.range in RANGES ? (filters.range as Range) : "24h";
  const level = LEVELS.find(item => item === filters.level);
  const where: Prisma.LogEntryWhereInput = {
    createdAt: { gte: new Date(now.getTime() - RANGES[range] * MINUTE) },
    ...(level ? { level: DB_LEVEL[level] } : {}),
    ...(filters.event ? { event: filters.event } : {}),
  };
  const entries = await db.logEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  return {
    range, level, event: filters.event || undefined,
    entries: entries.map(entry => ({ id: entry.id, event: entry.event, level: levelFromDb(entry.level), createdAt: entry.createdAt, context: (entry.context ?? {}) as Record<string, string> })),
  };
}

export async function getAlertStatus(now = new Date()) {
  const config = alertConfig();
  const [{ total }, latest] = await Promise.all([
    errorCounts(new Date(now.getTime() - config.windowMinutes * MINUTE)),
    db.logEntry.findFirst({ where: { event: ALERT_EVENT }, orderBy: { createdAt: "desc" } }),
  ]);
  const recentAlert = latest && now.getTime() - latest.createdAt.getTime() < config.cooldownMinutes * MINUTE;
  return {
    threshold: config.threshold, windowMinutes: config.windowMinutes, cooldownMinutes: config.cooldownMinutes,
    webhookConfigured: Boolean(config.webhookUrl), errorsInWindow: total,
    active: total >= config.threshold || Boolean(recentAlert),
    latestAlert: latest ? { createdAt: latest.createdAt, context: (latest.context ?? {}) as Record<string, string> } : null,
  };
}
