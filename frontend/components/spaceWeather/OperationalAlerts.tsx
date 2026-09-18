import Link from "next/link";
import type { SolarActivityFull } from "@/lib/types";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import SwSectionBanner from "./SwSectionBanner";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default function OperationalAlerts({
  solar,
  now,
  refreshFailed,
}: {
  solar: SolarActivityFull | null;
  now: number;
  refreshFailed: boolean;
}) {
  const feed = solar?.feed_status?.swpc_alerts;
  const status = monitoringFreshness(
    solar?.updated,
    now,
    Boolean(feed?.reachable),
    refreshFailed || solar?.mode === "stale",
  );
  const alerts = [...(solar?.alerts ?? [])].sort(
    (a, b) =>
      (observationEpoch(text(b.issue_datetime)) ?? 0) -
      (observationEpoch(text(a.issue_datetime)) ?? 0),
  );
  const latest = alerts[0];
  const latestMessage = text(latest?.message) ?? text(latest?.product_id) ?? null;
  const loading = !solar && !refreshFailed;
  const tone = status === "LIVE" ? "ok" : status === "DELAYED" ? "warn" : "off";
  const statusLabel =
    status === "LIVE" ? "Feed current" : status === "DELAYED" ? "Partial feed" : "Feed unavailable";

  return (
    <section className="card sw-operational-alerts" aria-labelledby="operational-alerts-title">
      <SwSectionBanner
        icon="🔔"
        title="Alerts / Watches / Warnings"
        titleId="operational-alerts-title"
        tone={tone}
        meta={
          <span>
            {statusLabel}
            {alerts.length ? ` · ${alerts.length} bulletin(s)` : ""}
          </span>
        }
      />

      <div className="sw-alerts-watch-card">
        {latestMessage ? (
          <>
            <div className="sw-alerts-watch-issued">
              Issued {observationTime(text(latest?.issue_datetime))}
            </div>
            <pre className="sw-alerts-watch-message">{latestMessage}</pre>
            <p className="sw-supporting-text" style={{ margin: 0 }}>
              Check bulletin validity; a recent listing does not confirm an active warning.
            </p>
            {alerts.length > 1 && (
              <p className="sw-alerts-watch-more">+{alerts.length - 1} more bulletin(s)</p>
            )}
          </>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            {loading
              ? "Loading NOAA bulletins…"
              : status === "LIVE"
                ? "No bulletins returned by the current NOAA feed."
                : "Current NOAA alert status is unavailable. Retrying automatically."}
          </p>
        )}

        {status !== "LIVE" && alerts.length > 0 && (
          <p role="status" className="sw-supporting-text" style={{ margin: 0 }}>
            Saved bulletins are shown below; current alert status could not be verified.
          </p>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="sw-alerts-bulletin-list">
          <p className="sw-supporting-text">
            Full recent bulletins — issue time does not establish whether an alert is still active.
          </p>
          {alerts.map((alert, index) => {
            const message = text(alert.message) ?? "Bulletin text unavailable.";
            const severity =
              text(alert.severity) ??
              message.match(/\b[GRS][1-5]\s*\([^\n)]+\)/i)?.[0] ??
              "Not specified";
            const validity = text(alert.valid_until) ?? text(alert.expiration_time);
            return (
              <details
                className="sw-alert-bulletin"
                key={`${text(alert.product_id) ?? "alert"}-${text(alert.issue_datetime) ?? index}`}
                open={index === 0}
              >
                <summary>
                  {text(alert.product_id) ?? "NOAA bulletin"} · Issued{" "}
                  {observationTime(text(alert.issue_datetime))}
                </summary>
                <p>
                  Severity: {severity} · Validity:{" "}
                  {validity ? observationTime(validity) : "See bulletin text"}
                </p>
                <pre>{message}</pre>
              </details>
            );
          })}
        </div>
      )}

      <a
        href="https://www.swpc.noaa.gov/products/alerts-watches-and-warnings"
        target="_blank"
        rel="noreferrer"
      >
        Source: NOAA SWPC — full alerts and validity details ↗
      </a>
      <p className="sw-supporting-text" style={{ margin: "0.35rem 0 0" }}>
        Solar and heliospheric indices stay on{" "}
        <Link href="/space-weather/">Live Space Weather</Link>.
      </p>
    </section>
  );
}
