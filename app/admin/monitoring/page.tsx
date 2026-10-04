import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ALERT_EVENT, getAlertStatus, getLogEntries, getMonitoringSummary, LEVELS, purgeOldEntries, RANGES } from "@/lib/log-store";
import { EVENT_LEVELS } from "@/lib/logger";

export const dynamic = "force-dynamic";

const RANGE_LABELS: Record<keyof typeof RANGES, string> = { "1h": "Last hour", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };
const time = (date: Date) => `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
const details = (context: Record<string, string>) => Object.entries(context).map(([key, value]) => `${key}=${value}`).join(" · ");

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ level?: string; event?: string; range?: string }> }) {
  await requireAdmin("/admin/monitoring");
  const filters = await searchParams;
  const now = new Date();
  // Retention also runs here, so old entries go even when nothing is being logged.
  await purgeOldEntries(now);
  const [status, summary, list] = await Promise.all([getAlertStatus(now), getMonitoringSummary(now), getLogEntries(filters, now)]);
  const events = [...Object.keys(EVENT_LEVELS)].sort();

  return <><Link className="back" href="/admin/catalog">← Back to admin</Link><span className="eyebrow">Admin</span><h1>Monitoring</h1>
    <p className="muted">Errors and warnings logged by every feature. Entries are kept for 30 days.</p>

    {status.active
      ? <div className="notice error" role="alert" data-testid="monitoring-alert">
        <strong>{status.errorsInWindow >= status.threshold
          ? `Alert: ${status.errorsInWindow} errors in the last ${status.windowMinutes} minutes (threshold ${status.threshold}).`
          : `Alert raised at ${time(status.latestAlert!.createdAt)}: ${status.latestAlert!.context.count} errors in ${status.latestAlert!.context.windowMinutes} minutes.`}</strong>
        <p>{status.latestAlert ? `Latest alert: ${time(status.latestAlert.createdAt)} (${status.latestAlert.context.events}). ` : ""}
          {status.webhookConfigured ? "Alerts are posted to the configured webhook." : "No webhook configured: set ALERT_WEBHOOK_URL to be notified."}</p>
      </div>
      : <p className="notice" role="status" data-testid="monitoring-ok">No alert. {status.errorsInWindow} {status.errorsInWindow === 1 ? "error" : "errors"} in the last {status.windowMinutes} minutes; an alert is raised at {status.threshold}.</p>}

    <h2>Last 24 hours</h2>
    <p className="muted">{LEVELS.map(level => `${summary.totals[level]} ${level}`).join(" · ")}</p>
    {summary.rows.length
      ? <table className="log-table"><thead><tr><th>Event</th><th>Level</th><th>Count</th></tr></thead>
        <tbody>{summary.rows.map(row => <tr key={`${row.event}-${row.level}`}>
          <td><Link href={`/admin/monitoring?${new URLSearchParams({ event: row.event, range: "24h" })}`}>{row.event}</Link></td>
          <td><span className={`level level-${row.level}`}>{row.level}</span></td><td>{row.count}</td>
        </tr>)}</tbody></table>
      : <p className="card muted">Nothing logged in the last 24 hours.</p>}

    <h2>Recent entries</h2>
    <form className="search" action="/admin/monitoring" method="get" role="search">
      <select name="level" defaultValue={list.level ?? ""} aria-label="Level">
        <option value="">All levels</option>
        {LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
      </select>
      <select name="event" defaultValue={list.event ?? ""} aria-label="Event">
        <option value="">All events</option>
        {events.map(event => <option key={event} value={event}>{event}</option>)}
      </select>
      <select name="range" defaultValue={list.range} aria-label="Time range">
        {Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button className="button" type="submit">Filter</button>
    </form>
    {list.entries.length
      ? <table className="log-table" data-testid="log-entries"><thead><tr><th>Time</th><th>Level</th><th>Event</th><th>Details</th></tr></thead>
        <tbody>{list.entries.map(entry => <tr key={entry.id} className={entry.event === ALERT_EVENT ? "log-alert" : undefined}>
          <td>{time(entry.createdAt)}</td><td><span className={`level level-${entry.level}`}>{entry.level}</span></td>
          <td>{entry.event}</td><td className="log-details">{details(entry.context)}</td>
        </tr>)}</tbody></table>
      : <p className="card muted">No entries match these filters.</p>}
    <p className="muted">Showing the newest {list.entries.length} of at most 100 entries.</p>
  </>;
}
