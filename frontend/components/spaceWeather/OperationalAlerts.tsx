import type { SolarActivityFull } from "@/lib/types";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default function OperationalAlerts({ solar, now, refreshFailed }: {
  solar: SolarActivityFull | null;
  now: number;
  refreshFailed: boolean;
}) {
  const feed = solar?.feed_status?.swpc_alerts;
  const status = monitoringFreshness(solar?.updated, now, Boolean(feed?.reachable), refreshFailed || solar?.mode === "stale");
  const alerts = [...(solar?.alerts ?? [])].sort((a, b) =>
    (observationEpoch(text(b.issue_datetime)) ?? 0) - (observationEpoch(text(a.issue_datetime)) ?? 0));

  return (
    <section className="card sw-operational-alerts" aria-labelledby="operational-alerts-title">
      <div className="sw-section-heading">
        <h2 id="operational-alerts-title">NOAA alerts, watches and warnings</h2>
        <span className={`sw-feed-state sw-feed-state-${status.toLowerCase()}`}>{status === "LIVE" ? "Feed current" : status === "DELAYED" ? "Partial feed" : "Feed unavailable"}</span>
      </div>
      <p className="sw-supporting-text">Recent bulletins; issue time does not establish whether an alert is still active. Check the validity and cancellation text in each bulletin.</p>
      {status !== "LIVE" && <p role="status">{alerts.length ? "Saved bulletins are shown below; current alert status could not be verified." : "Current alert status is unavailable. Retrying automatically."}</p>}
      {status === "LIVE" && alerts.length === 0 && <p>No bulletins returned by the current NOAA feed.</p>}
      {alerts.map((alert, index) => {
        const message = text(alert.message) ?? "Bulletin text unavailable.";
        const severity = text(alert.severity) ?? message.match(/\b[GRS][1-5]\s*\([^\n)]+\)/i)?.[0] ?? "Not specified";
        const validity = text(alert.valid_until) ?? text(alert.expiration_time);
        return (
          <details className="sw-alert-bulletin" key={`${text(alert.product_id) ?? "alert"}-${text(alert.issue_datetime) ?? index}`}>
            <summary>{text(alert.product_id) ?? "NOAA bulletin"} · Issued {observationTime(text(alert.issue_datetime))}</summary>
            <p>Severity: {severity} · Validity: {validity ? observationTime(validity) : "See bulletin text"}</p>
            <pre>{message}</pre>
          </details>
        );
      })}
      <a href="https://www.swpc.noaa.gov/products/alerts-watches-and-warnings" target="_blank" rel="noreferrer">Source: NOAA SWPC — full alerts and validity details ↗</a>
    </section>
  );
}
