"use client";
import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { getEkfAlertLog, getEkfStatus, getSpaceWeather, getSolarActivity, getTimelines, refreshSpaceWeather, getStations } from "@/lib/api";
import ClickableMetricGrid from "@/components/spaceWeather/ClickableMetricGrid";
import IndexScaleReference from "@/components/spaceWeather/IndexScaleReference";
import AiRecommendationPanel from "@/components/layout/AiRecommendationPanel";
import HomeStormAlertBanner from "@/components/layout/HomeStormAlertBanner";
import LineChart from "@/components/charts/LineChart";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { countLiveStationStatuses, connectedStreamCount, type LiveStationCounts } from "@/lib/liveStationStatus";
import type { EkfAlert, EkfStatus, SpaceWeatherCurrent, SolarActivityFull, SpaceWeatherTimelines, TimelinePoint } from "@/lib/types";
import {
  FLARE_SCALE,
  donkiCmeCountColor,
  donkiFlareCountColor,
  donkiStormCountColor,
  flareClassColor,
} from "@/lib/solarEventColors";
import { DashboardHeaderClocks } from "@/components/dashboard/DashboardClocks";

// ── Solar Cycle 25 reference ──────────────────────────────────────────────────
const SC25_START = new Date("2019-12-01").getTime();
const SC25_END_EST = new Date("2031-03-01").getTime();
function getSC25Progress(): number {
  return Math.min(100, Math.round(((Date.now() - SC25_START) / (SC25_END_EST - SC25_START)) * 100));
}

// ── Flare class scale (colours from solarEventColors) ───────────────────────────
function displayText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function displayFlux(flux: unknown): string | null {
  const n = typeof flux === "number" ? flux : Number(flux);
  if (!Number.isFinite(n)) return null;
  return `${n.toExponential(2)} W/m²`;
}

function safePoints(points: TimelinePoint[] | undefined) {
  return Array.isArray(points) ? points : [];
}

function currentPoint(value: number | null | undefined, timestamp: string | null | undefined): TimelinePoint[] {
  return value == null || !Number.isFinite(value)
    ? []
    : [{ t: timestamp ?? new Date().toISOString(), v: value }];
}

function riskScore(risk: string | null | undefined): number | null {
  const key = (risk ?? "").toLowerCase();
  if (key === "low") return 0;
  if (key === "moderate") return 1;
  if (key === "high") return 2;
  if (key === "critical") return 3;
  return null;
}

function withCurrentFallback(points: TimelinePoint[], fallback: TimelinePoint[]) {
  return points.length > 0 ? points : fallback;
}

function snapshotTimelines(sw: SpaceWeatherCurrent): SpaceWeatherTimelines {
  const t = sw.updated_utc ?? new Date().toISOString();
  return {
    kp: currentPoint(sw.kp, t),
    dst: currentPoint(sw.dst, t),
    f107: currentPoint(sw.f107, t),
    solar_wind: currentPoint(sw.plasma_speed, t),
    s4: currentPoint(sw.s4, t),
    gnss_risk: currentPoint(riskScore(sw.gnss_risk), t),
    stations_online: currentPoint(sw.stations_online, t),
    mean_vtec: currentPoint(sw.mean_vtec, t),
    gic: [],
  };
}

// ── KP scale bands ────────────────────────────────────────────────────────────
const KP_BANDS = [
  { range: "0–2", label: "Quiet",          color: "#22c55e" },
  { range: "3",   label: "Unsettled",      color: "#84cc16" },
  { range: "4",   label: "Active",         color: "#eab308" },
  { range: "5",   label: "Minor Storm G1", color: "#f97316" },
  { range: "6",   label: "Moderate G2",    color: "#ef4444" },
  { range: "7",   label: "Strong G3",      color: "#dc2626" },
  { range: "8",   label: "Severe G4",      color: "#991b1b" },
  { range: "9",   label: "Extreme G5",     color: "#a855f7" },
];

type SolarInfoKey =
  | "summary"
  | "flare"
  | "xray"
  | "wind"
  | "alerts"
  | "flareEvents"
  | "cme"
  | "storms"
  | "impact";

type SolarInfo = {
  title: string;
  summary: string;
  detail: string;
};

// ── GNSS Impact ───────────────────────────────────────────────────────────────
function getGnssImpact(kp: number | null, s4: number | null, flare: string, level: string) {
  const k = kp ?? 0;
  const s = s4 ?? 0;
  const fl = (flare || "A")[0].toUpperCase();
  let rtk = "Nominal";
  let ppp = "Normal";
  let iono = "Nominal";
  let hf = "Excellent";
  const scint = s >= 0.5 ? "Severe" : s >= 0.3 ? "Moderate" : s >= 0.1 ? "Weak" : "Low";
  if (k >= 7 || fl === "X") {
    rtk = "Severely degraded"; ppp = "Major delay"; iono = "Major delay"; hf = "Blackout possible";
  } else if (k >= 5 || fl === "M") {
    rtk = "Degraded"; ppp = "Delayed"; iono = "Elevated"; hf = "Disrupted";
  } else if (k >= 3 || fl === "C") {
    rtk = "Minor impact possible"; ppp = "Slightly delayed"; iono = "Slight elevation"; hf = "Fair";
  }
  const cors = level === "Low" && k < 3
    ? "Nominal — sub-centimetre CORS accuracy achievable across Africa"
    : level === "Moderate"
    ? "Minor GNSS impact possible"
    : "Elevated ionospheric activity — monitor CORS accuracy";
  return { rtk, ppp, iono, scint, hf, cors };
}

function TimelineCard({
  title, pts, color, yLabel, threshold, source, emptyMsg,
}: {
  title: string; pts: TimelinePoint[]; color: string; yLabel: string;
  threshold?: { value: number; label: string }; source: string; emptyMsg?: string;
}) {
  const labels = pts.map((p) => p.t.length >= 16 ? p.t.slice(11, 16) : p.t.slice(0, 13));
  const data = pts.map((p) => p.v ?? 0);
  return (
    <div className="card">
      <div className="metric-label" style={{ marginBottom: "0.6rem" }}>{title}</div>
      {pts.length > 0 ? (
        <>
          <LineChart labels={labels} datasets={[{ label: yLabel, data, color }]} yLabel={yLabel} height={220} threshold={threshold} />
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            {source} · {pts.length} points.
          </div>
        </>
      ) : (
        <div className="banner banner-warn">{emptyMsg ?? "Live data unavailable."}</div>
      )}
    </div>
  );
}

function DataTable({ headers, rows, emptyMsg }: { headers: string[]; rows: string[][]; emptyMsg?: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #1a2a3a" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "0.35rem 0.6rem", verticalAlign: "top" }}>{cell}</td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} style={{ padding: "0.8rem 0.6rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                {emptyMsg ?? "No data."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SpaceWeatherPage() {
  const [sw, setSw]         = useState<SpaceWeatherCurrent | null>(null);
  const [sa, setSa]         = useState<SolarActivityFull | null>(null);
  const [tl, setTl]         = useState<SpaceWeatherTimelines | null>(null);
  const [tab, setTab]       = useState(0);
  const [xrayRange, setXrayRange] = useState<"6H" | "24H">("24H");
  const [refreshing, setRefreshing] = useState(false);
  const [nowCat, setNowCat] = useState("");
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("pending");
  const [liveStationCounts, setLiveStationCounts] = useState<LiveStationCounts | null>(null);
  const [ekf, setEkf] = useState<EkfStatus | null>(null);
  const [pendingAlerts, setPendingAlerts] = useState<EkfAlert[]>([]);
  const [selectedSolarInfo, setSelectedSolarInfo] = useState<SolarInfoKey>("summary");

  useEffect(() => {
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmt = () => {
      const cat = new Date(Date.now() + 2 * 3600 * 1000);
      const d   = cat.getUTCDate();
      const mon = MONTHS[cat.getUTCMonth()];
      const yr  = cat.getUTCFullYear();
      const hh  = String(cat.getUTCHours()).padStart(2, "0");
      const mm  = String(cat.getUTCMinutes()).padStart(2, "0");
      setNowCat(`${d} ${mon} ${yr}, ${hh}:${mm} CAT (UTC+2)`);
    };
    fmt();
    const id = setInterval(fmt, 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = useCallback(() => {
    getSpaceWeather()
      .then((s) => {
        setSw(s);
        setTl((prev) => prev ?? snapshotTimelines(s));
        setFeedStatus("ok");
      })
      .catch(() => setFeedStatus("down"));
    getSolarActivity()
      .then(setSa)
      .catch(() => null);
    getTimelines()
      .then(setTl)
      .catch(() => null);
    getStations(false)
      .then((stations) => setLiveStationCounts(countLiveStationStatuses(stations)))
      .catch(() => null);
    getStations(true)
      .then((stations) => setLiveStationCounts(countLiveStationStatuses(stations)))
      .catch(() => null);
    getEkfStatus()
      .then(setEkf)
      .catch(() => setEkf(null));
    getEkfAlertLog(24)
      .then((rows) => setPendingAlerts(rows.filter((a) => !a.acknowledged_status)))
      .catch(() => setPendingAlerts([]));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const freshnessMsg = useFeedFreshness("space-weather", feedStatus);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshSpaceWeather(); } catch { /* ignore */ }
    fetchAll();
    setRefreshing(false);
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const kp    = sw?.kp ?? null;
  const dst   = sw?.dst ?? null;
  const f107  = sw?.f107 ?? null;
  const wind  = sw?.plasma_speed ?? sa?.solar_wind?.speed ?? null;
  const s4    = sw?.s4 ?? null;
  const risk  = sw?.gnss_risk ?? null;
  const currentTimestamp = sw?.updated_utc ?? null;

  const kpPoints = withCurrentFallback(safePoints(tl?.kp), currentPoint(kp, currentTimestamp));
  const dstPoints = withCurrentFallback(safePoints(tl?.dst), currentPoint(dst, currentTimestamp));
  const f107Points = withCurrentFallback(safePoints(tl?.f107), currentPoint(f107, currentTimestamp));
  const solarWindPoints = withCurrentFallback(safePoints(tl?.solar_wind), currentPoint(wind, currentTimestamp));
  const s4Points = withCurrentFallback(safePoints(tl?.s4), currentPoint(s4, currentTimestamp));
  const gnssPoints = withCurrentFallback(safePoints(tl?.gnss_risk), currentPoint(riskScore(risk), currentTimestamp));
  const streamCount = liveStationCounts
    ? connectedStreamCount(liveStationCounts)
    : sw?.stations_online ?? null;
  const stationsOnlinePoints = withCurrentFallback(
    safePoints(tl?.stations_online),
    currentPoint(streamCount, currentTimestamp),
  );

  const flareClass   = sa?.flare_class ?? "N/A";
  const actLabel     = sa?.activity_label ?? "Low";
  const actColor     = sa?.activity_color ?? "#22c55e";
  const alerts       = Array.isArray(sa?.alerts) ? sa.alerts : [];
  const donkiFlares  = Array.isArray(sa?.donki_flares) ? sa.donki_flares : [];
  const donkiCmes    = Array.isArray(sa?.donki_cmes) ? sa.donki_cmes : [];
  const donkiStorms  = Array.isArray(sa?.donki_storms) ? sa.donki_storms : [];
  const alertCount   = alerts.length;

  const flareCountColor = donkiFlareCountColor(donkiFlares.length, donkiFlares);
  const cmeCountColor = donkiCmeCountColor(donkiCmes.length, donkiCmes);
  const stormCountColor = donkiStormCountColor(donkiStorms.length, donkiStorms);

  const conditionLabel   = kp !== null && kp >= 5 ? "Storm Active" : kp !== null && kp >= 3 ? "Disturbed" : "Quiet";
  const conditionVariant = kp !== null && kp >= 5 ? "alert" : kp !== null && kp >= 3 ? "warn" : "info";

  // ── X-Ray series for charts ───────────────────────────────────────────────
  const xrayRaw = sa?.xray_series ?? [];
  // multiply by 1e7 for readability (so "0" becomes 0.00 not "5e-8")
  const xrayScaled = xrayRaw.map((v) => parseFloat((v * 1e7).toFixed(3)));
  const xraySlice = xrayRange === "6H" ? xrayScaled.slice(-9) : xrayScaled;
  const xrayLabelCount = xraySlice.length;
  const xrayLabels = Array.from({ length: xrayLabelCount }, (_, i) => {
    const minsAgo = (xrayLabelCount - 1 - i) * (xrayRange === "6H" ? 40 : 40);
    return minsAgo === 0 ? "now" : `-${Math.round(minsAgo / 60)}h`;
  });

  // ── GNSS Impact ───────────────────────────────────────────────────────────
  const impact = getGnssImpact(kp, s4, flareClass, actLabel);

  // ── Solar Cycle 25 ────────────────────────────────────────────────────────
  const sc25Progress = getSC25Progress();

  // ── Pre-processed table rows ──────────────────────────────────────────────
  const activeRegionRows = (Array.isArray(sa?.active_regions) ? sa.active_regions : []).map((r) => [
    String(r.id ?? "—"), String(r.cls ?? "—"), String(r.mag ?? "—"), String(r.spots ?? "0"),
  ]);
  const cmeTableRows = (Array.isArray(sa?.cme_rows) ? sa.cme_rows : []).map((r) => [
    String(r.date ?? "—"), String(r.speed ?? "—"), String(r.width ?? "—"),
    String(r.halo ?? "—"), String(r.impact ?? "—"),
  ]);
  const radioBurstRows = (Array.isArray(sa?.radio_burst_rows) ? sa.radio_burst_rows : []).map((r) => [
    String(r.time ?? "—"), String(r.type ?? "—"), String(r.freq ?? "—"),
    String(r.intensity ?? "—"), String(r.loc ?? "—"),
  ]);

  const dateRange = sa?.donki_date_start && sa?.donki_date_end
    ? `${sa.donki_date_start} – ${sa.donki_date_end}`
    : "";

  // ── Alert text ────────────────────────────────────────────────────────────
  const latestAlert = alerts[0] as Record<string, unknown> | undefined;
  const alertMsg =
    displayText(latestAlert?.message) ??
    displayText(latestAlert?.product_id) ??
    null;
  const alertTime = displayText(latestAlert?.issue_datetime);
  const fluxLabel = displayFlux(sa?.flux);
  const solarInfo: Record<SolarInfoKey, SolarInfo> = {
    summary: {
      title: "Solar Activity",
      summary: `Current solar activity level: ${actLabel}. Current flare class: ${flareClass}. SWPC alerts: ${alertCount > 0 ? alertCount : "none"}.`,
      detail: "This card summarises the Sun's present activity for GNSS operations. Low or quiet activity usually means normal ionospheric background conditions; higher activity can increase TEC, scintillation, and radio disturbance risk.",
    },
    flare: {
      title: "Solar Flare - GOES X-Ray",
      summary: `Current flare class: ${flareClass}${fluxLabel ? `, flux ${fluxLabel}` : ""}.`,
      detail: "GOES X-ray class describes flare strength. A/B are background, C is moderate, M is major, and X is extreme. Strong flares can disturb HF radio and may affect GNSS signal tracking on the sunlit side of Earth.",
    },
    xray: {
      title: "GOES X-Ray Flux",
      summary: xraySlice.length > 0 ? `${xraySlice.length} recent X-ray samples are loaded.` : "X-ray flux data is unavailable.",
      detail: "The X-ray chart shows short-term solar flare energy from NOAA GOES. Rising spikes indicate flare activity; flat low values mean the flare environment is quiet.",
    },
    wind: {
      title: "Solar Wind",
      summary: `Speed: ${sa?.solar_wind?.speed ? `${sa.solar_wind.speed.toFixed(0)} km/s` : "N/A"}; IMF Bz: ${sa?.solar_wind?.bz != null ? `${sa.solar_wind.bz.toFixed(1)} nT` : "N/A"}.`,
      detail: "Solar wind carries charged particles from the Sun to Earth. Fast wind and southward IMF Bz can drive geomagnetic activity, increasing Kp and disturbing GNSS positioning.",
    },
    alerts: {
      title: "NOAA Alerts / Watches / Warnings",
      summary: alertMsg ? `Latest alert: ${alertMsg.length > 120 ? `${alertMsg.slice(0, 120)}...` : alertMsg}` : "No current NOAA SWPC alerts.",
      detail: "NOAA SWPC alerts are operational warnings for solar radiation, radio blackout, and geomagnetic storm conditions. These warnings help decide when to monitor GNSS quality more closely.",
    },
    flareEvents: {
      title: "Solar Flares",
      summary: `${donkiFlares.length} flare event(s) in the selected 7-day window.`,
      detail: "This count comes from DONKI flare events. A higher count means more recent solar eruptive activity, but storm impact at Earth still depends on direction, timing, and associated CME or solar-wind conditions.",
    },
    cme: {
      title: "Coronal Mass Ejections",
      summary: `${donkiCmes.length} CME event(s) in the selected 7-day window.`,
      detail: "A CME is a large solar plasma eruption. If Earth-directed, it can arrive hours to days later and cause geomagnetic storms that affect GNSS, power grids, and HF radio.",
    },
    storms: {
      title: "Geomagnetic Storms",
      summary: `${donkiStorms.length} geomagnetic storm event(s) in the selected 7-day window.`,
      detail: "Geomagnetic storm events show Earth-side magnetic disturbance. They are more directly linked to GNSS degradation than solar flare counts alone.",
    },
    impact: {
      title: "Impact on GNSS & CORS Networks",
      summary: `GNSS/CORS: ${impact.rtk}; HF radio: ${impact.hf}; power grids: ${kp !== null && kp >= 7 ? "GIC risk" : "minimal GIC"}.`,
      detail: "This card translates solar and geomagnetic measurements into operational effects for positioning, radio, satellites, and power systems. It is the practical impact view for Zimbabwe CORS users.",
    },
  };
  const selectedInfo = solarInfo[selectedSolarInfo];

  const solarCardClickProps = (key: SolarInfoKey, style: CSSProperties = {}) => ({
    role: "button",
    tabIndex: 0,
    onClick: () => setSelectedSolarInfo(key),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedSolarInfo(key);
      }
    },
    style: {
      cursor: "pointer",
      outline: selectedSolarInfo === key ? "2px solid var(--accent)" : "none",
      outlineOffset: "2px",
      ...style,
    },
  });

  return (
    <div className="page-stack">

      {/* ── Title ── */}
      <div className="dashboard-header">
        <div className="dashboard-header-copy">
          <h1 className="page-title">☀️ Space Weather Monitoring</h1>
          <p className="page-subtitle">Real-time monitoring of solar, geomagnetic, ionospheric, and Zimbabwe CORS network conditions.</p>
        </div>
        <div className="dashboard-header-aside">
          <div className="page-header-clocks" aria-label="Live clocks">
            <DashboardHeaderClocks />
          </div>
          <button
            className="btn dashboard-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", flexWrap: "wrap" }}>
        <span className="dot dot-ok" />
        <span>Live Space Weather</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span>Zimbabwe CORS Network</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span className="dot dot-ok" />
        <span>Live</span>
        {sw?.updated_utc && (
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.72rem" }}>
            Updated {sw.updated_utc.slice(0, 16).replace("T", " ")} UTC
          </span>
        )}
      </div>

      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}

      <HomeStormAlertBanner sw={sw} ekf={ekf} pendingAlerts={pendingAlerts} />

      <ClickableMetricGrid sw={sw} updatedUtc={sw?.updated_utc} liveStationCounts={liveStationCounts} />
      <IndexScaleReference />
      <AiRecommendationPanel sw={sw} indicesLoading={feedStatus === "pending"} />

      {/* ── Solar Activity Monitor section ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "0.7rem 1.1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>⚡</span>
            <span style={{ fontWeight: 800, fontSize: "0.85rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>Solar Activity Monitor</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", color: "var(--text-muted)" }}>
            <span className="dot dot-ok" style={{ width: "7px", height: "7px" }} />
            <span>Live Data · NOAA SWPC · {nowCat}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.72rem", color: "var(--text-muted)", paddingLeft: "0.2rem" }}>
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Real-time solar conditions for GNSS, satellites and CORS networks</span>
        </div>

        {/* Row 1: Solar Summary | Flare card | X-Ray chart */}
        <div className="grid-3">

          {/* Solar Activity Summary */}
          <div className="card" {...solarCardClickProps("summary", { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.7rem" })}>
            {/* Sun SVG */}
            <div style={{ position: "relative", width: "70px", height: "70px", marginTop: "0.2rem" }}>
              <svg viewBox="0 0 70 70" style={{ width: "70px", height: "70px" }}>
                {/* Rays */}
                {Array.from({ length: 8 }, (_, i) => {
                  const angle = (i * 45 * Math.PI) / 180;
                  const x1 = 35 + 26 * Math.cos(angle);
                  const y1 = 35 + 26 * Math.sin(angle);
                  const x2 = 35 + 32 * Math.cos(angle);
                  const y2 = 35 + 32 * Math.sin(angle);
                  return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffcc00" strokeWidth="2.5" strokeLinecap="round" />;
                })}
                <circle cx="35" cy="35" r="20" fill="#ffcc00" opacity="0.95" />
              </svg>
            </div>
            <div style={{ width: "100%" }}>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Solar Activity</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: actColor }}>{actLabel}</div>
            </div>
            <div style={{ width: "100%", borderTop: "1px solid var(--border)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Current Flare</span>
                <span style={{ fontWeight: 700, color: flareClassColor(flareClass) }}>{flareClass}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>SWPC Alerts</span>
                <span style={{ fontWeight: 700 }}>{alertCount > 0 ? alertCount : "None"}</span>
              </div>
            </div>
          </div>

          {/* Solar Flare (GOES X-Ray) */}
          <div className="card" {...solarCardClickProps("flare", { display: "flex", flexDirection: "column", gap: "0.5rem" })}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Solar Flare (GOES X-Ray)</div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Current class:</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1, color: flareClassColor(flareClass), marginBottom: "0.3rem" }}>
              {flareClass}
            </div>
            {fluxLabel && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                Flux: {fluxLabel}
              </div>
            )}
            {/* Flare class scale */}
            <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {FLARE_SCALE.map((f) => (
                  <div key={f.cls} style={{ flex: 1, minWidth: "40px", textAlign: "center" }}>
                    <div style={{ width: "100%", height: "3px", background: f.color, borderRadius: "2px", marginBottom: "3px" }} />
                    <div style={{ fontSize: "0.6rem", fontWeight: 700, color: f.color }}>{f.label.split("-")[0]}-</div>
                    <div style={{ fontSize: "0.58rem", color: "var(--text-muted)" }}>{f.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* GOES X-Ray Flux chart */}
          <div className="card" {...solarCardClickProps("xray", { display: "flex", flexDirection: "column", gap: "0.5rem" })}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>GOES X-Ray Flux — Last Day</div>
            {xraySlice.length > 0 ? (
              <>
                <LineChart
                  labels={xrayLabels}
                  datasets={[{ label: "X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#f97316" }]}
                  yLabel="Flux ×10⁻⁷"
                  height={150}
                />
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  0.1–0.8 nm band · Source: NOAA SWPC GOES primary
                </div>
              </>
            ) : (
              <div className="banner banner-info" style={{ fontSize: "0.75rem" }}>X-ray flux data unavailable.</div>
            )}
          </div>
        </div>

        {/* Row 2: Solar Wind | Alerts | Flares count */}
        <div className="sw-triple-grid">

          {/* Solar Wind */}
          <div className="card" {...solarCardClickProps("wind")}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.8rem" }}>Solar Wind</div>
            {[
              { icon: "🌀", label: "Speed",       val: sa?.solar_wind?.speed,       unit: "km/s",   fmt: (v: number) => v.toFixed(0) },
              { icon: "🔵", label: "Density",     val: sa?.solar_wind?.density,     unit: "p/cm³",  fmt: (v: number) => v.toFixed(1) },
              { icon: "🌡️", label: "Proton Temp.", val: sa?.solar_wind?.temperature, unit: "K",      fmt: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
              { icon: "↕️", label: "IMF Bz",      val: sa?.solar_wind?.bz,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
              { icon: "🔵", label: "IMF Bt",      val: sa?.solar_wind?.bt,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
            ].map(({ icon, label, val, unit, fmt }) => {
              const display = val !== null && val !== undefined && val !== 0 ? fmt(val as number) : null;
              return (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0", borderBottom: "1px solid #1a2a3a", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{icon} {label}</span>
                  <span style={{ fontWeight: 700 }}>
                    {display ? `${display} ${unit}` : "N/A"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Alerts / Watches / Warnings */}
          <div className="card" {...solarCardClickProps("alerts", { display: "flex", flexDirection: "column", gap: "0.5rem" })}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
              <span className="dot dot-ok" style={{ width: "7px", height: "7px", flexShrink: 0 }} />
              <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Alerts / Watches / Warnings
              </span>
            </div>
            {alertMsg ? (
              <>
                {alertTime && (
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{alertTime.slice(0, 16).replace("T", " ")} UTC</div>
                )}
                <div style={{ fontSize: "0.75rem", lineHeight: 1.5, overflowY: "auto", maxHeight: "140px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {alertMsg.length > 400 ? alertMsg.slice(0, 400) + "…" : alertMsg}
                </div>
                {alertCount > 1 && (
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>+{alertCount - 1} more alert(s)</div>
                )}
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "auto" }}>Source: NOAA SWPC alerts.json</div>
              </>
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                {sa?.mode === "unavailable" ? "NOAA alerts feed unavailable." : "No current NOAA SWPC alerts."}
              </div>
            )}
          </div>

          {/* Solar Flares count */}
          <div className="card" {...solarCardClickProps("flareEvents", { textAlign: "center" })}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Solar Flares</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: sa ? flareCountColor : "var(--text-muted)" }}>{sa ? donkiFlares.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiFlares.length === 0
                ? `No flare events in the selected 7-day window.`
                : `Flare event(s) detected.`}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>FLR: {dateRange}</div>}
          </div>
        </div>

        {/* Row 3: CME | Geomagnetic Storms | GNSS Impact */}
        <div className="sw-triple-grid">

          {/* CME count */}
          <div className="card" {...solarCardClickProps("cme", { textAlign: "center" })}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Coronal Mass Ejections</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: sa ? cmeCountColor : "var(--text-muted)" }}>{sa ? donkiCmes.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiCmes.length === 0 ? "No CME events in the selected 7-day window." : "CME event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>CME event history · {dateRange}</div>}
          </div>

          {/* Geomagnetic Storms count */}
          <div className="card" {...solarCardClickProps("storms", { textAlign: "center" })}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Geomagnetic Storms</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: sa ? stormCountColor : "var(--text-muted)" }}>{sa ? donkiStorms.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiStorms.length === 0 ? "No geomagnetic storm events in the selected 7-day window." : "Storm event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>GST event history · {dateRange}</div>}
          </div>

          {/* Impact on GNSS & CORS Networks (compact) */}
          <div className="card" {...solarCardClickProps("impact")}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.7rem" }}>Impact on GNSS &amp; CORS Networks</div>
            <div className="sw-double-grid">
              {[
                { label: "GNSS / CORS",  val: impact.rtk },
                { label: "HF Radio",     val: impact.hf },
                { label: "Satellites",   val: "Routine ops" },
                { label: "Power Grids",  val: kp !== null && kp >= 7 ? "GIC risk" : "Minimal GIC" },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "6px", padding: "0.4rem 0.6rem" }}>
                  <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Condition banner ── */}
      <div className={`banner banner-${conditionVariant}`}>
        <strong>{selectedInfo.title}: {selectedInfo.summary}</strong>
        <div style={{ marginTop: "0.35rem", fontSize: "0.8rem", lineHeight: 1.45 }}>
          {selectedInfo.detail}
        </div>
        <div style={{ marginTop: "0.35rem", fontSize: "0.76rem", color: "var(--text-muted)" }}>
          Current condition: {conditionLabel}
        </div>
        {risk && risk !== "Low" && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
            GNSS risk is {risk} — ionospheric conditions may affect positioning accuracy over Zimbabwe.
          </div>
        )}
        {!(liveStationCounts?.online || sw?.stations_online) && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
            Production CORS API reports zero live telemetry; archive/catalog statuses are not presented as live station availability.
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        {["Live Metric Timelines", "Solar Activity", "Kp Scale"].map((t, i) => (
          <button key={t} className={`tab${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: Timelines ── */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Real-time NOAA feeds and derived indices — last 6 hours (UTC)</p>

          <TimelineCard title="Live NOAA Kp Timeline"
            pts={kpPoints} color="#168bd2" yLabel="Kp Index"
            threshold={{ value: 5, label: "Storm threshold (5)" }}
            source="NOAA SWPC Planetary K-index 1-minute feed"
            emptyMsg="Live NOAA Kp feed unavailable." />

          <TimelineCard title="Live NOAA Dst Timeline"
            pts={dstPoints} color="#a78bfa" yLabel="Dst (nT)"
            threshold={{ value: -50, label: "Storm threshold (−50 nT)" }}
            source="NOAA SWPC Kyoto Dst index (hourly)"
            emptyMsg="Live NOAA Dst feed unavailable." />

          <TimelineCard title="Live NOAA F10.7 Solar Flux Timeline"
            pts={f107Points} color="#ffcc00" yLabel="F10.7 (sfu)"
            threshold={{ value: 150, label: "High activity (150 sfu)" }}
            source="NOAA SWPC F10.7 cm flux feed"
            emptyMsg="Live NOAA F10.7 feed unavailable." />

          <TimelineCard title="Live NOAA Solar Wind Timeline"
            pts={solarWindPoints} color="#00cc88" yLabel="Speed (km/s)"
            threshold={{ value: 500, label: "Fast stream (500 km/s)" }}
            source="NOAA SWPC solar-wind plasma 1-day feed"
            emptyMsg="Live solar wind feed unavailable." />

          <TimelineCard title="Live Scintillation S4 Timeline"
            pts={s4Points} color="#ff8c00" yLabel="S4 Index"
            threshold={{ value: 0.5, label: "Severe scintillation (0.5)" }}
            source="ZINGSA CORS ionosphere archive"
            emptyMsg="No observed S4 archive value is available for the timeline." />

          <TimelineCard title="GNSS Risk Level Timeline"
            pts={gnssPoints} color="#168bd2" yLabel="Risk level"
            threshold={{ value: 2, label: "High risk (2)" }}
            source="Derived from NOAA Kp — ZINGSA GNSS risk thresholds"
            emptyMsg="GNSS risk timeline unavailable." />

          {stationsOnlinePoints.length > 0 ? (
            <TimelineCard title="Live CORS Stations Online Timeline"
              pts={stationsOnlinePoints} color="#00ff88" yLabel="Stations online"
              source="ZINGSA CORS station-health — current live count"
              emptyMsg="Live CORS telemetry unavailable." />
          ) : (
            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Live CORS Stations Online Timeline</div>
              <div className="banner banner-info">Live CORS telemetry is unavailable — no station count timeline.</div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 1: Solar Activity (detailed) ── */}
      {tab === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* NOAA SWPC status bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.8rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
            <span className="dot dot-ok" style={{ width: "7px", height: "7px" }} />
            <span>NOAA SWPC Live</span>
          </div>

          {/* GOES X-Ray Flux chart */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.7rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div className="metric-label">SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {(["6H", "24H"] as const).map((r) => (
                  <button key={r} onClick={() => setXrayRange(r)}
                    style={{ padding: "0.2rem 0.7rem", fontSize: "0.72rem", fontWeight: 700, borderRadius: "5px", border: `1px solid ${xrayRange === r ? "var(--accent)" : "var(--border)"}`, background: xrayRange === r ? "var(--accent)" : "var(--surface)", color: "#fff", cursor: "pointer" }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {xraySlice.length > 0 ? (
              <>
                <LineChart
                  labels={xrayLabels}
                  datasets={[{ label: "0.1–0.8 nm X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#60a5fa" }]}
                  yLabel="Flux ×10⁻⁷ W/m²"
                  height={240}
                />
                {/* Flare class reference lines */}
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.6rem", fontSize: "0.65rem" }}>
                  {FLARE_SCALE.map((f) => (
                    <span key={f.cls} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ display: "inline-block", width: "10px", height: "3px", background: f.color, borderRadius: "2px" }} />
                      {f.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="banner banner-info">GOES X-ray flux data unavailable — NOAA SWPC feed offline or rate-limited.</div>
            )}
          </div>

          {/* Active Regions + CME table side by side */}
          <div className="sw-double-grid">
            <div className="card">
              <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginBottom: "0.7rem" }}>
                {/* Mini sun icon */}
                <svg viewBox="0 0 32 32" width="28" height="28" style={{ flexShrink: 0 }}>
                  {Array.from({ length: 8 }, (_, i) => {
                    const a = (i * 45 * Math.PI) / 180;
                    return <line key={i} x1={16 + 11 * Math.cos(a)} y1={16 + 11 * Math.sin(a)} x2={16 + 14 * Math.cos(a)} y2={16 + 14 * Math.sin(a)} stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" />;
                  })}
                  <circle cx="16" cy="16" r="8" fill="#f97316" />
                </svg>
                <div className="metric-label">Active Regions</div>
              </div>
              <DataTable
                headers={["REGION", "CLASS", "MAG.TYPE", "SPOTS"]}
                rows={activeRegionRows}
                emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No DONKI flare regions in the last 7 days."}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NASA DONKI Flares · {dateRange}</div>
              )}
            </div>

            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Coronal Mass Ejections (CME)</div>
              <DataTable
                headers={["DATE (UTC)", "SPEED (KM/S)", "WIDTH", "HALO", "IMPACT"]}
                rows={cmeTableRows}
                emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No DONKI CME events in the last 7 days."}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NASA DONKI CME · {dateRange}</div>
              )}
            </div>
          </div>

          {/* Solar Radio Bursts */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Radio Bursts (Last 24H)</div>
            <DataTable
              headers={["TIME (UTC)", "TYPE", "FREQUENCY", "INTENSITY", "LOCATION"]}
              rows={radioBurstRows}
              emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No flare-derived radio burst proxies in the last 7 days."}
            />
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NOAA GOES X-ray · Proxy from DONKI FLR events</div>
          </div>

          {/* Solar Cycle Progress */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Solar Cycle Progress</div>
            <div className="sw-double-grid sw-double-grid--center">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Solar Cycle</span>
                  <span style={{ fontWeight: 800 }}>25</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Cycle Progress</span>
                  <span style={{ fontWeight: 800, color: "#f97316" }}>{sc25Progress}%</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: "10px", background: "#1a2a3a", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc25Progress}%`, background: "linear-gradient(90deg, #22c55e, #eab308, #f97316)", borderRadius: "5px", transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Estimated Peak: 2024–2026 (Cycle 25 maximum window)</div>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                <div>Start: December 2019</div>
                <div>Predicted end: ~2031</div>
                <div style={{ marginTop: "0.4rem", fontStyle: "italic" }}>Reference cycle window; no synthetic observation values are displayed.</div>
              </div>
            </div>
          </div>

          {/* Impact on GNSS & CORS Networks (detailed row) */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Impact on GNSS &amp; CORS Networks</div>
            <div className="sw-triple-grid sw-triple-grid--tight">
              {[
                { label: "RTK Accuracy",        val: impact.rtk },
                { label: "PPP Convergence",     val: impact.ppp },
                { label: "Ionospheric Delay",   val: impact.iono },
                { label: "Signal Scintillation",val: impact.scint },
                { label: "HF Communication",    val: impact.hf },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
                  <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
            {/* Africa CORS spanning full row */}
            <div style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Africa CORS (ZINGSA API)</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{impact.cors}</div>
            </div>
          </div>

          {/* Solar Activity Levels legend */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Activity Levels</div>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              {[
                { label: "Low",      color: "#22c55e", desc: "Minimal impact" },
                { label: "Moderate", color: "#eab308", desc: "Minor impact" },
                { label: "High",     color: "#f97316", desc: "Strong impact" },
                { label: "Severe",   color: "#ef4444", desc: "Major impact" },
                { label: "Extreme",  color: "#a855f7", desc: "Extreme impact" },
              ].map(({ label, color, desc }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#0a1929", borderRadius: "8px", padding: "0.45rem 0.8rem", flex: "1 1 100px" }}>
                  <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{label}</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Tab 2: Kp Scale ── */}
      {tab === 2 && (
        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Kp Geomagnetic Scale Reference</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {KP_BANDS.map(({ range, label, color }) => (
              <div key={range} style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                <div style={{ width: "60px", height: "24px", background: color, borderRadius: "4px", flexShrink: 0 }} />
                <span style={{ fontWeight: 700, width: "40px", flexShrink: 0 }}>{range}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
