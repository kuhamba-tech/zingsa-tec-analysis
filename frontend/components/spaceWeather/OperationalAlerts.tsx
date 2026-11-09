"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SolarActivityFull } from "@/lib/types";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import { zimbabweBulletinNote, type SwpcBulletin } from "@/lib/swpcBulletin";
import SwSectionBanner from "./SwSectionBanner";

const INITIAL_VISIBLE = 6;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bulletinOf(alert: Record<string, unknown>): SwpcBulletin {
  const raw = alert.bulletin;
  return raw && typeof raw === "object" ? (raw as SwpcBulletin) : {};
}

function bulletinKind(bulletin: SwpcBulletin, headline: string): string {
  const raw = (bulletin.kind || headline.split(":")[0] || "").trim().toUpperCase();
  if (raw.includes("CANCEL")) return "CANCEL";
  if (raw.includes("ALERT") || raw.startsWith("ALT")) return "ALERT";
  if (raw.includes("WARNING") || raw.startsWith("WAR")) return "WARNING";
  if (raw.includes("WATCH") || raw.startsWith("WAT")) return "WATCH";
  if (raw.includes("SUMMARY") || raw.startsWith("SUM")) return "SUMMARY";
  const code = (bulletin.code || "").toUpperCase();
  if (code.startsWith("ALT")) return "ALERT";
  if (code.startsWith("WAR")) return "WARNING";
  if (code.startsWith("WAT")) return "WATCH";
  if (code.startsWith("SUM")) return "SUMMARY";
  return "BULLETIN";
}

function kindTone(kind: string): { color: string; className: string } {
  if (kind === "ALERT") return { color: "#ef4444", className: "is-alert" };
  if (kind === "WARNING") return { color: "#f97316", className: "is-warning" };
  if (kind === "WATCH") return { color: "#eab308", className: "is-watch" };
  if (kind === "CANCEL") return { color: "#94a3b8", className: "is-cancel" };
  if (kind === "SUMMARY") return { color: "#38bdf8", className: "is-summary" };
  return { color: "#94a3b8", className: "is-bulletin" };
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
  const [expanded, setExpanded] = useState(false);
  const feed = solar?.feed_status?.swpc_alerts;
  const status = monitoringFreshness(
    solar?.updated,
    now,
    Boolean(feed?.reachable),
    refreshFailed || solar?.mode === "stale",
  );
  const alerts = useMemo(
    () =>
      [...(solar?.alerts ?? [])].sort(
        (a, b) =>
          (observationEpoch(text(b.issue_datetime)) ?? 0) -
          (observationEpoch(text(a.issue_datetime)) ?? 0),
      ),
    [solar?.alerts],
  );
  const latest = alerts[0];
  const latestBulletin = latest ? bulletinOf(latest) : {};
  const latestHeadline =
    text(latestBulletin.headline) ?? text(latest?.message) ?? text(latest?.product_id) ?? null;
  const latestKind = bulletinKind(latestBulletin, latestHeadline ?? "");
  const latestTone = kindTone(latestKind);
  const loading = !solar && !refreshFailed;
  const tone = status === "LIVE" ? "ok" : status === "DELAYED" ? "warn" : "off";
  const statusLabel =
    status === "LIVE" ? "Feed current" : status === "DELAYED" ? "Partial feed" : "Feed unavailable";
  const visible = expanded ? alerts : alerts.slice(0, INITIAL_VISIBLE);
  const hiddenCount = Math.max(0, alerts.length - INITIAL_VISIBLE);

  return (
    <section className="card sw-operational-alerts" aria-labelledby="operational-alerts-title">
      <SwSectionBanner
        icon="🔔"
        title="International reference bulletins"
        titleId="operational-alerts-title"
        tone={tone}
        meta={
          <span>
            {statusLabel}
            {alerts.length ? ` · ${alerts.length}` : ""}
          </span>
        }
      />

      <div className="sw-alerts-watch-card">
        {latestHeadline ? (
          <>
            <div className="sw-alerts-watch-issued">
              <span className={`sw-alerts-kind-chip ${latestTone.className}`}>{latestKind}</span>
              <span>
                {text(latestBulletin.code) ?? text(latest?.product_id) ?? "Bulletin"}
                {latestBulletin.serial ? ` #${latestBulletin.serial}` : ""}
                {" · "}
                Issued {observationTime(text(latest?.issue_datetime) ?? text(latestBulletin.issue_time))}
              </span>
            </div>
            <p className="sw-alerts-watch-message">{latestHeadline}</p>
            <p className="sw-supporting-text" style={{ margin: 0 }}>
              {zimbabweBulletinNote(text(latestBulletin.code) ?? text(latest?.product_id))}
            </p>
          </>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            {loading
              ? "Loading international bulletins…"
              : status === "LIVE"
                ? "No current bulletins in the international reference feed."
                : "International bulletin status is unavailable. Retrying automatically."}
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
          <p className="sw-supporting-text sw-alerts-bulletin-note">
            NOAA SWPC reference feed for context beside ZINGSA operating alerts. Issue time alone does
            not confirm a warning remains in force.
          </p>
          <div className="sw-alerts-bulletin-scroll" role="list">
            {visible.map((alert, index) => {
              const message = text(alert.message) ?? "Bulletin text unavailable.";
              const bulletin = bulletinOf(alert);
              const code = text(bulletin.code) ?? text(alert.product_id) ?? "Bulletin";
              const headline = text(bulletin.headline) ?? code;
              const kind = bulletinKind(bulletin, headline);
              const kindStyle = kindTone(kind);
              const scale = text(bulletin.noaa_scale);
              const validTo = text(bulletin.valid_to);
              const validFrom = text(bulletin.valid_from);
              const serialNote = [
                bulletin.continuation_of ? `continues serial ${bulletin.continuation_of}` : "",
                bulletin.extension_to ? `extends serial ${bulletin.extension_to}` : "",
              ]
                .filter(Boolean)
                .join("; ");
              return (
                <details
                  className={`sw-alert-bulletin ${kindStyle.className}`}
                  key={`${code}-${text(bulletin.serial) ?? text(alert.issue_datetime) ?? index}`}
                  style={{ ["--bulletin-accent" as string]: kindStyle.color }}
                  role="listitem"
                >
                  <summary>
                    <span className={`sw-alerts-kind-chip ${kindStyle.className}`}>{kind}</span>
                    <span className="sw-alert-bulletin-code">
                      {code}
                      {bulletin.serial ? ` #${bulletin.serial}` : ""}
                    </span>
                    <span className="sw-alert-bulletin-headline">{headline}</span>
                  </summary>
                  <div className="sw-alert-bulletin-body">
                    <p>
                      {scale ? `Scale: ${scale}. ` : ""}
                      {validFrom ? `Valid from ${validFrom}. ` : ""}
                      {validTo ? `Valid to ${validTo}. ` : ""}
                      {bulletin.condition ? `${bulletin.condition}. ` : ""}
                      {serialNote}
                    </p>
                    <p>{zimbabweBulletinNote(code)}</p>
                    {text(bulletin.impacts) && <p>{bulletin.impacts}</p>}
                    <pre>{message}</pre>
                  </div>
                </details>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="sw-alerts-show-more"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Show fewer bulletins" : `Show ${hiddenCount} more bulletin${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}
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
