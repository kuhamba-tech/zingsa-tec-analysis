import Link from "next/link";
import type { SolarActivityFull } from "@/lib/types";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import { zimbabweBulletinNote, type SwpcBulletin } from "@/lib/swpcBulletin";
import SwSectionBanner from "./SwSectionBanner";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bulletinOf(alert: Record<string, unknown>): SwpcBulletin {
  const raw = alert.bulletin;
  return raw && typeof raw === "object" ? (raw as SwpcBulletin) : {};
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
  const latestBulletin = latest ? bulletinOf(latest) : {};
  const latestHeadline =
    text(latestBulletin.headline) ?? text(latest?.message) ?? text(latest?.product_id) ?? null;
  const codes = Array.from(
    new Set(
      alerts
        .map((alert) => text(bulletinOf(alert).code) ?? text(alert.product_id))
        .filter((code): code is string => Boolean(code)),
    ),
  );
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
        {latestHeadline ? (
          <>
            <div className="sw-alerts-watch-issued">
              {text(latestBulletin.code) ?? text(latest?.product_id) ?? "NOAA bulletin"}
              {latestBulletin.serial ? ` · serial ${latestBulletin.serial}` : ""}
              {" · "}
              Issued {observationTime(text(latest?.issue_datetime) ?? text(latestBulletin.issue_time))}
            </div>
            <p className="sw-alerts-watch-message">{latestHeadline}</p>
            <p className="sw-supporting-text" style={{ margin: 0 }}>
              {zimbabweBulletinNote(text(latestBulletin.code) ?? text(latest?.product_id))}
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
            Recent NOAA products in this feed
            {codes.length ? `: ${codes.join(", ")}` : ""}. Issue time does not establish whether a
            warning is still in force. These are the bureau’s bulletins, not messages written here.
          </p>
          {alerts.map((alert, index) => {
            const message = text(alert.message) ?? "Bulletin text unavailable.";
            const bulletin = bulletinOf(alert);
            const code = text(bulletin.code) ?? text(alert.product_id) ?? "NOAA bulletin";
            const headline = text(bulletin.headline) ?? code;
            const scale = text(bulletin.noaa_scale);
            const validTo = text(bulletin.valid_to);
            const validFrom = text(bulletin.valid_from);
            const serialNote = [
              bulletin.continuation_of ? `continues serial ${bulletin.continuation_of}` : "",
              bulletin.extension_to ? `extends serial ${bulletin.extension_to}` : "",
            ].filter(Boolean).join("; ");
            return (
              <details
                className="sw-alert-bulletin"
                key={`${code}-${text(bulletin.serial) ?? text(alert.issue_datetime) ?? index}`}
                open={index === 0}
              >
                <summary>
                  {code}
                  {bulletin.serial ? ` #${bulletin.serial}` : ""} · {headline}
                </summary>
                <p>
                  {scale ? `NOAA scale: ${scale}. ` : ""}
                  {validFrom ? `Valid from ${validFrom}. ` : ""}
                  {validTo ? `Valid to ${validTo}. ` : ""}
                  {bulletin.condition ? `${bulletin.condition}. ` : ""}
                  {serialNote}
                </p>
                <p>{zimbabweBulletinNote(code)}</p>
                {text(bulletin.impacts) && <p>{bulletin.impacts}</p>}
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
