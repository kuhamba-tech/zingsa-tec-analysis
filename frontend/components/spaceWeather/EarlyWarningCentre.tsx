"use client";

import { useMemo, useState } from "react";
import styles from "./EarlyWarningCentre.module.css";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import {
  AUTHORITY_LABELS,
  CATEGORY_LABELS,
  type EarlyWarningAlert,
  type EarlyWarningSnapshot,
} from "@/lib/earlyWarningTypes";
import OperationalAlerts from "@/components/spaceWeather/OperationalAlerts";
import ZimbabweIndexAlerts from "@/components/spaceWeather/ZimbabweIndexAlerts";
import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import StormWatchSummary from "@/components/spaceWeather/StormWatchSummary";
import type { EkfAlert, EkfStatus, StormAlertStatus } from "@/lib/types";

type TabId = "active" | "watches" | "history" | "settings";

const SECTIONS = [
  {
    id: "solar_activity",
    title: "Solar activity",
    blurb: "Flares, CMEs and coronal-hole streams from verified catalogues.",
  },
  {
    id: "solar_wind_imf",
    title: "Solar wind and IMF",
    blurb: "ZINGSA sustained L1 thresholds for speed and southward Bz.",
  },
  {
    id: "geomagnetic",
    title: "Geomagnetic activity",
    blurb: "Observed Kp, G-scale mapping, and supporting Dst / SYM-H.",
  },
  {
    id: "zimbabwe_gnss",
    title: "Zimbabwe GNSS impact",
    blurb: "Measured CORS VTEC and S4 for Zimbabwe — not inferred from L1 alone.",
  },
] as const;

function severityTone(severity: string): string {
  if (severity === "severe") return "#ef4444";
  if (severity === "warning") return "#f97316";
  if (severity === "watch") return "#eab308";
  return "#38bdf8";
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function AlertCard({ alert }: { alert: EarlyWarningAlert }) {
  return (
    <article
      className={`card ${styles.alertCard}`}
      style={{
        margin: 0,
        borderColor: severityTone(String(alert.severity)),
        display: "flex",
        flexDirection: "column",
        gap: "0.45rem",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: severityTone(String(alert.severity)) }}>
          {String(alert.severity).toUpperCase()}
        </span>
        <span className="sw-supporting-text" style={{ margin: 0 }}>
          {AUTHORITY_LABELS[alert.authority] ?? alert.authority}
        </span>
        <span className="sw-supporting-text" style={{ margin: 0 }}>
          {CATEGORY_LABELS[alert.category] ?? alert.category}
        </span>
      </div>
      <h3 className="metric-label" style={{ margin: 0, whiteSpace: "normal" }}>
        {alert.title}
      </h3>
      <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45 }}>{alert.message}</p>
      <div className="sw-supporting-text" style={{ margin: 0, display: "grid", gap: "0.2rem" }}>
        {alert.observed_value != null && (
          <span>
            Observed: {alert.observed_value}
            {alert.unit ? ` ${alert.unit}` : ""}
            {alert.threshold != null ? ` · threshold ${alert.threshold}${alert.unit ? ` ${alert.unit}` : ""}` : ""}
            {alert.duration_minutes != null ? ` · sustained ${alert.duration_minutes} min` : ""}
          </span>
        )}
        <span>Observation: {formatWhen(alert.observation_time)}</span>
        <span>
          Data age: {alert.data_age_minutes == null ? "unavailable" : `${alert.data_age_minutes} min`} · Source:{" "}
          {alert.source}
        </span>
        <span>
          First detected {formatWhen(alert.first_detected)} · Updated {formatWhen(alert.last_updated)}
          {alert.resolved_at ? ` · Resolved ${formatWhen(alert.resolved_at)}` : ""}
        </span>
      </div>
    </article>
  );
}

export default function EarlyWarningCentre({
  snapshot,
  loading,
  sw,
  solar,
  solarError,
  now,
  stormStatus,
  ekf,
  ekfAlerts,
  onEkfAlertsChange,
}: {
  snapshot: EarlyWarningSnapshot | null;
  loading: boolean;
  sw: SpaceWeatherCurrent | null;
  solar: SolarActivityFull | null;
  solarError: boolean;
  now: number;
  stormStatus: StormAlertStatus | null;
  ekf: EkfStatus | null;
  ekfAlerts: EkfAlert[];
  onEkfAlertsChange: (alerts: EkfAlert[]) => void;
}) {
  const [tab, setTab] = useState<TabId>("active");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const active = snapshot?.active ?? [];
  const history = snapshot?.history ?? [];
  const summary = snapshot?.summary;
  const legend = snapshot?.authority_legend ?? {};

  const watches = useMemo(
    () => active.filter((alert) => alert.status === "watch" || alert.severity === "watch" || alert.severity === "advisory"),
    [active],
  );
  const resolved = useMemo(
    () => history.filter((alert) => alert.status === "resolved"),
    [history],
  );

  const byCategory = useMemo(() => {
    const map: Record<string, EarlyWarningAlert[]> = {
      solar_activity: [],
      solar_wind_imf: [],
      geomagnetic: [],
      zimbabwe_gnss: [],
    };
    for (const alert of active) {
      const key = String(alert.category);
      if (!map[key]) map[key] = [];
      map[key].push(alert);
    }
    return map;
  }, [active]);

  const tabRows =
    tab === "active"
      ? active.filter((alert) => alert.status === "active" || alert.severity === "warning" || alert.severity === "severe")
      : tab === "watches"
        ? watches
        : tab === "history"
          ? history
          : [];

  const filteredRows = tabRows.filter((alert) =>
    (category === "all" || alert.category === category) &&
    `${alert.title} ${alert.message} ${alert.source}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const unavailable = !snapshot && !loading;
  const count = (value: number) => loading && !snapshot ? "..." : snapshot ? value : "\u2014";

  return (
    <div className={styles.centre}>
      <section className={styles.overview} aria-labelledby="operations-heading">
        <div className={styles.overviewHeading}>
          <div><span className={styles.eyebrow}>National monitoring / Zimbabwe</span>
            <h2 id="operations-heading">Your operational overview</h2>
            <p>Follow observed conditions, developing watches and local GNSS impacts.</p>
          </div>
          <span className={styles.feedStatus} role="status"><span />{loading ? "Updating feeds" : unavailable ? "Feed unavailable" : "Snapshot available"}</span>
        </div>
        <div className={styles.stats}>
          <article className={styles.stat}><span>Current alerts</span><strong>{count(summary?.active_count ?? active.length)}</strong><small>{snapshot ? `Highest severity: ${summary?.highest_severity ?? "unavailable"}` : "Awaiting alert data"}</small></article>
          <article className={styles.stat}><span>Developing watches</span><strong>{count(watches.length)}</strong><small>Early signals and advisories</small></article>
          <article className={styles.stat}><span>Zimbabwe GNSS</span><strong>{count(summary?.by_authority?.zimbabwe_gnss ?? 0)}</strong><small>Locally measured impact alerts</small></article>
          <article className={styles.stat}><span>Resolved events</span><strong>{count(resolved.length)}</strong><small>Within the last 7 days</small></article>
        </div>
      </section>

      <ZimbabweIndexAlerts sw={sw} solar={solar} now={now} />

      <section aria-labelledby="domains-heading">
        <div className={styles.sectionHeading}><h2 id="domains-heading">Monitoring domains</h2><span>Four connected perspectives</span></div>
        <div className={styles.domains}>
          {SECTIONS.map((section, index) => {
            const rows = byCategory[section.id] ?? [];
            return <button key={section.id} type="button" className={`${styles.domain} ${category === section.id ? styles.selectedDomain : ""}`}
              aria-pressed={category === section.id} onClick={() => { setCategory(category === section.id ? "all" : section.id); setTab(rows.some(alert => alert.status === "active" || alert.severity === "warning" || alert.severity === "severe") ? "active" : "watches"); }}>
              <span className={styles.domainTop}><span className={styles.domainIcon}>{["\u2600", "\u224b", "\u25ce", "\u2316"][index]}</span><span className={styles.domainCount}>{count(rows.length)} alerts</span></span>
              <strong>{section.title}</strong><span>{section.blurb}</span>
              <small>{loading ? "Evaluating conditions..." : unavailable ? "Status unavailable" : rows.length ? "View related alerts" : "No alerts in this snapshot"}</small>
            </button>;
          })}
        </div>
      </section>

      <section className={styles.workspace} aria-labelledby="alerts-heading">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Alert management</span><h2 id="alerts-heading">Alerts & activity</h2></div><span>7-day event window / UTC</span></div>
        <div className={styles.tabs} aria-label="Alert views">
          {([["active", "Active", tab === "active" ? tabRows.length : active.filter(a => a.status === "active" || a.severity === "warning" || a.severity === "severe").length], ["watches", "Watches", watches.length], ["history", "History", history.length], ["settings", "Notifications", null]] as const).map(([id, label, total]) => (
            <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? styles.activeTab : ""} onClick={() => setTab(id)}>{label}{total !== null && <span>{count(total)}</span>}</button>
          ))}
        </div>
        {tab === "settings" ? (
          <div className={styles.settings}>
            <h3>Notification channels</h3><p>{snapshot?.notification_settings?.note ?? "Channel configuration is unavailable until the alert feed loads."}</p>
            {([['Dashboard', snapshot?.notification_settings?.dashboard], ['Email', snapshot?.notification_settings?.email], ['WhatsApp / messaging', snapshot?.notification_settings?.whatsapp]] as const).map(([label, enabled]) => <div key={label}><strong>{label}</strong><span>{enabled == null ? "Unknown" : enabled ? "Enabled" : "Off"}</span></div>)}
          </div>
        ) : <>
          <div className={styles.filters}>
            <label><span>Search alerts</span><input type="search" placeholder="Search title, source or message..." value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label><span>Monitoring domain</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All domains</option>{SECTIONS.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>
          </div>
          <div className={styles.results} aria-live="polite" aria-busy={loading}>
            {loading && !snapshot ? <div className={styles.empty}><span className={styles.emptyIcon}>{"\u25ce"}</span><h3>Checking monitoring feeds</h3><p>Alerts will appear here when the latest snapshot is ready.</p></div>
              : unavailable ? <div className={styles.empty}><span className={styles.emptyIcon}>!</span><h3>Alert status is unavailable</h3><p>We cannot verify current conditions. The feed retries automatically.</p></div>
              : filteredRows.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}>{"\u25ce"}</span><h3>{query || category !== "all" ? "No matching alerts" : `No ${tab === "history" ? "historical" : tab} alerts`}</h3><p>{query || category !== "all" ? "Try another search or view all monitoring domains." : "Events in this view will appear here as conditions change."}</p>{(query || category !== "all") && <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</button>}</div>
              : <><p className={styles.resultCount}>{filteredRows.length} {filteredRows.length === 1 ? "event" : "events"} shown</p>{filteredRows.map(alert => <AlertCard key={`${tab}-${alert.alert_id}`} alert={alert} />)}</>}
          </div>
        </>}
      </section>

      <details className={styles.explainer}><summary>How to interpret the alert streams</summary><div className={styles.streams}>{(["zimbabwe_gnss", "zingsa_experimental", "official_noaa"] as const).map(key => <div key={key}><h3>{AUTHORITY_LABELS[key]}</h3><p>{legend[key] || "Source context will appear when the feed is available."}</p></div>)}</div><p>Fast solar wind or southward Bz raises driver risk. A geomagnetic storm is declared from observed Kp. Zimbabwe GNSS impact requires measured CORS TEC or S4.</p></details>
      <OperationalAlerts solar={solar} now={now} refreshFailed={solarError} />
      <details className={styles.explainer}><summary>Storm diagnostics & detection log</summary><div className={styles.diagnostics}><StormWatchSummary sw={sw} stormStatus={stormStatus} ekf={ekf} loading={loading} /><StormWatchLog alerts={ekfAlerts} onAlertsChange={onEkfAlertsChange} hours={168} /></div></details>
    </div>
  );
}
