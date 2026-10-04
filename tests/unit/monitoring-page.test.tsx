import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getCurrentUser, getAlertStatus, getMonitoringSummary, getLogEntries, purgeOldEntries, getCatalogAdminData } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getCurrentUser: vi.fn(), getAlertStatus: vi.fn(), getMonitoringSummary: vi.fn(), getLogEntries: vi.fn(), purgeOldEntries: vi.fn(),
  getCatalogAdminData: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin, getCurrentUser }));
vi.mock("@/lib/auth-actions", () => ({ logOutAction: vi.fn() }));
vi.mock("@/lib/catalog-admin", () => ({ getCatalogAdminData }));
vi.mock("@/lib/log-store", () => ({
  getAlertStatus, getMonitoringSummary, getLogEntries, purgeOldEntries,
  ALERT_EVENT: "monitoring_alert_triggered", LEVELS: ["error", "warn", "info"], RANGES: { "1h": 60, "24h": 1440, "7d": 10080, "30d": 43200 },
}));
import MonitoringPage from "@/app/admin/monitoring/page";
import CatalogAdminPage from "@/app/admin/catalog/page";
import RootLayout from "@/app/layout";

const query = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const at = new Date("2026-10-07T12:00:00Z");
const quiet = { threshold: 5, windowMinutes: 10, cooldownMinutes: 10, webhookConfigured: false, errorsInWindow: 1, active: false, latestAlert: null };
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await MonitoringPage(query(params)));

beforeEach(() => {
  for (const mock of [requireAdmin, getCurrentUser, getAlertStatus, getMonitoringSummary, getLogEntries, purgeOldEntries, getCatalogAdminData]) mock.mockReset();
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  getAlertStatus.mockResolvedValue(quiet);
  getMonitoringSummary.mockResolvedValue({
    rows: [{ event: "physical_file_not_found", level: "error", count: 3 }, { event: "login_failed", level: "warn", count: 2 }],
    totals: { error: 3, warn: 2, info: 0 },
  });
  getLogEntries.mockResolvedValue({
    range: "24h", level: undefined, event: undefined,
    entries: [{ id: "e1", event: "physical_file_not_found", level: "error", createdAt: at, context: { fileId: "file-missing" } }],
  });
  getCatalogAdminData.mockResolvedValue({ faculties: [], courses: [], professors: [], terms: [] });
});

describe("monitoring page", () => {
  it("shows the 24-hour summary and recent entries", async () => {
    const html = await render();
    expect(html).toContain("Monitoring");
    expect(html).toContain("3 error · 2 warn · 0 info");
    expect(html).toContain('href="/admin/monitoring?event=physical_file_not_found&amp;range=24h"');
    expect(html).toContain('<span class="level level-warn">warn</span>');
    expect(html).toContain("2026-10-07 12:00:00 UTC");
    expect(html).toContain("fileId=file-missing");
  });
  it("passes the filters through and keeps them selected", async () => {
    getLogEntries.mockResolvedValue({ range: "1h", level: "error", event: "upload_failed", entries: [] });
    const html = await render({ level: "error", event: "upload_failed", range: "1h" });
    expect(getLogEntries).toHaveBeenCalledWith({ level: "error", event: "upload_failed", range: "1h" }, expect.any(Date));
    expect(html).toContain('<option value="error" selected="">error</option>');
    expect(html).toContain('<option value="upload_failed" selected="">upload_failed</option>');
    expect(html).toContain('<option value="1h" selected="">Last hour</option>');
    expect(html).toContain("No entries match these filters.");
  });
  it("offers every known event in the filter", async () => {
    const html = await render();
    for (const event of ["login_failed", "physical_file_not_found", "upload_failed", "monitoring_alert_triggered"]) expect(html).toContain(`<option value="${event}">`);
  });
  it("shows no alert banner while things are quiet", async () => {
    const html = await render();
    expect(html).not.toContain('data-testid="monitoring-alert"');
    expect(html).toContain("No alert. 1 error in the last 10 minutes; an alert is raised at 5.");
  });
  it("shows the alert banner when errors reach the threshold", async () => {
    getAlertStatus.mockResolvedValue({ ...quiet, errorsInWindow: 6, active: true, latestAlert: { createdAt: at, context: { count: "5", windowMinutes: "10", events: "physical_file_not_found:5" } } });
    const html = await render();
    expect(html).toContain('data-testid="monitoring-alert"');
    expect(html).toContain("Alert: 6 errors in the last 10 minutes (threshold 5).");
    expect(html).toContain("Latest alert: 2026-10-07 12:00:00 UTC (physical_file_not_found:5).");
    expect(html).toContain("No webhook configured");
  });
  it("keeps the banner during the cooldown after an alert, and says when a webhook is set", async () => {
    getAlertStatus.mockResolvedValue({ ...quiet, errorsInWindow: 2, active: true, webhookConfigured: true, latestAlert: { createdAt: at, context: { count: "7", windowMinutes: "10", events: "upload_failed:7" } } });
    const html = await render();
    expect(html).toContain("Alert raised at 2026-10-07 12:00:00 UTC: 7 errors in 10 minutes.");
    expect(html).toContain("Alerts are posted to the configured webhook.");
  });
  it("runs retention when the page loads", async () => {
    await render();
    expect(purgeOldEntries).toHaveBeenCalledTimes(1);
  });
  it("lets a retrieval failure reach the error page", async () => {
    getMonitoringSummary.mockRejectedValue(new Error("database down"));
    await expect(MonitoringPage(query())).rejects.toThrow("database down");
  });
});

describe("monitoring access", () => {
  it("checks for an admin before reading anything", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(MonitoringPage(query())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireAdmin).toHaveBeenCalledWith("/admin/monitoring");
    for (const read of [getAlertStatus, getMonitoringSummary, getLogEntries, purgeOldEntries]) expect(read).not.toHaveBeenCalled();
  });
  it("sends a visitor to log in", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fadmin%2Fmonitoring"));
    await expect(MonitoringPage(query())).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fadmin%2Fmonitoring");
  });
  it("is linked from the catalog overview", async () => {
    const html = renderToStaticMarkup(await CatalogAdminPage());
    expect(html).toContain('href="/admin/monitoring"');
    expect(html).toContain("Open monitoring");
  });
  it("is linked in the header for admins only", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).toContain('<a href="/admin/monitoring">Monitoring</a>');
    getCurrentUser.mockResolvedValue({ id: "user-1", role: "STUDENT" });
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).not.toContain("/admin/monitoring");
    getCurrentUser.mockResolvedValue(null);
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).not.toContain("/admin/monitoring");
  });
});
