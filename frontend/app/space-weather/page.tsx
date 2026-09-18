"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { getSpaceWeather, getSolarActivity, getTimelines, refreshSpaceWeather, getStations, getEkfStatus } from "@/lib/api";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekSolarActivity, subscribeSolarActivity } from "@/lib/solarActivityStore";
import { peekStations, subscribeStations } from "@/lib/stationsStore";
import ClickableMetricGrid from "@/components/spaceWeather/ClickableMetricGrid";
import IndexScaleReference from "@/components/spaceWeather/IndexScaleReference";
import SolarCycleFullRecordCharts from "@/components/spaceWeather/SolarCycleFullRecordCharts";
import HeliosphericMonitorStack from "@/components/spaceWeather/HeliosphericMonitorStack";
import CauseEffectTimelineStack from "@/components/spaceWeather/CauseEffectTimelineStack";
import { monitoringFreshness, observationTime } from "@/lib/monitoringStatus";
import AdvancedScientificIndices from "@/components/spaceWeather/AdvancedScientificIndices";
import HomeStormAlertBanner from "@/components/layout/HomeStormAlertBanner";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import {
  analyzeDstTimeline,
  analyzeF107Timeline,
  analyzeGnssRiskTimeline,
  analyzeKpTimeline,
  analyzeS4Timeline,
  analyzeSolarWindTimeline,
  analyzeStationsOnlineTimeline,
} from "@/lib/dashboardChartAnalysis";
import { analyzeGoesXrayExplanation } from "@/lib/heliosphericChartAnalysis";
import {
  ONE_H_MS,
  SIX_H_MS,
  chronologicalPoints,
  formatKnmiUtcTick,
  sharedTimeDomain,
} from "@/lib/chartTimeAxis";
import { alignEkfToPoints } from "@/lib/ekfAlign";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { connectedStreamCount, countSpiderLiveStationStatuses, type LiveStationCounts } from "@/lib/liveStationStatus";
import type { EkfPoint, EkfStatus, SpaceWeatherCurrent, SolarActivityFull, SpaceWeatherTimelines, TimelinePoint } from "@/lib/types";
import {
  FLARE_SCALE,
  donkiCmeCountColor,
  donkiFlareCountColor,
  donkiStormCountColor,
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

// Interprets a live GOES flare-class reading (e.g. "B4.3") in plain language:
// the letter is the logarithmic X-ray class (each step ~10x flux), not a
// geomagnetic or GNSS impact rating. Operational radio blackout uses NOAA R-scale separately.
function interpretFlareClass(cls: string): string | null {
  const match = /^([ABCMX])([\d.]+)$/i.exec((cls || "").trim());
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const multiplier = parseFloat(match[2]);
  const band: Record<string, string> = {
    A: "10⁻⁸–10⁻⁷ W/m²",
    B: "10⁻⁷–10⁻⁶ W/m²",
    C: "10⁻⁶–10⁻⁵ W/m²",
    M: "10⁻⁵–10⁻⁴ W/m²",
    X: "≥10⁻⁴ W/m²",
  };
  const range = band[letter];
  if (!range) return null;
  return `Right now: ${cls.toUpperCase()} is a GOES soft X-ray flare class (${range}, 0.1–0.8 nm) with multiplier ${multiplier} within that class. This is not a geomagnetic storm rating — a flare does not necessarily produce a geomagnetic storm.`;
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
function getGnssImpact(kp: number | null, s4: number | null, flare: string) {
  const hasKp = kp !== null && Number.isFinite(kp);
  const hasS4 = s4 !== null && Number.isFinite(s4);
  const hasFlare = /^[ABCMX]\d/i.test(flare);
  return {
    rtk: "Local accuracy not verified",
    ppp: "Convergence not measured",
    iono: "Compare local VTEC with a quiet reference",
    scint: hasS4 ? `S4 ${s4.toFixed(2)} — check observation time` : "S4 unavailable",
    hf: !hasFlare ? "Flare data unavailable" : /^[MX]/i.test(flare) ? "Dayside disruption possible — check NOAA alerts" : "Check NOAA radio-blackout alerts",
    cors: !hasKp ? "Geomagnetic data unavailable; local impact unverified" : kp >= 5
      ? "Global storm conditions — verify local receiver performance"
      : "Below global storm threshold; local accuracy remains unverified",
  };
}

function TimelineCard({
  graphId, title, pts, color, yLabel, threshold, source, analysis, expanded, onToggle, emptyMsg, ekfPoints, ekfColor,
  syncHoverMs = null, onSyncHoverMs, timeDomain,
}: {
  graphId: string; title: string; pts: TimelinePoint[]; color: string; yLabel: string;
  threshold?: { value: number; label: string; color?: string; fillAbove?: boolean }; source: string;
  analysis: ChartAnalysisBlock; expanded: boolean; onToggle: (graphId: string) => void; emptyMsg?: string;
  ekfPoints?: EkfPoint[];
  ekfColor?: string;
  syncHoverMs?: number | null;
  onSyncHoverMs?: (ms: number | null) => void;
  timeDomain?: { min: number; max: number } | null;
}) {
  const chronoAll = chronologicalPoints(pts);
  const chrono = timeDomain
    ? chronoAll.filter((p) => p.ms >= timeDomain.min && p.ms <= timeDomain.max)
    : chronoAll;
  const labels = chrono.map((p) => p.t);
  const epochs = chrono.map((p) => p.ms);
  const data = chrono.map((p) => p.v);
  const ekf = alignEkfToPoints(
    chrono.map((p) => ({ t: p.t, v: p.v })),
    ekfPoints,
  );
  const hasEkf = ekf.data.some((v) => v !== null);
  const domain = timeDomain ?? sharedTimeDomain([epochs]);
  const speedScale = graphId === "solar-wind"
    ? (() => {
        const vals = data.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
        const dMin = vals.length ? Math.min(...vals) : 400;
        const dMax = vals.length ? Math.max(...vals) : 550;
        return {
          ySuggestedMin: Math.max(200, Math.floor(Math.min(dMin, 400) / 20) * 20 - 20),
          ySuggestedMax: Math.ceil(Math.max(dMax, 600, 500) / 20) * 20,
        };
      })()
    : {};
  const toggle = () => pts.length > 0 && onToggle(graphId);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
  return (
    <div
      className="card"
      role={pts.length > 0 ? "button" : undefined}
      tabIndex={pts.length > 0 ? 0 : undefined}
      aria-expanded={pts.length > 0 ? expanded : undefined}
      aria-label={pts.length > 0 ? title : undefined}
      onClick={toggle}
      onKeyDown={onKeyDown}
      style={{ cursor: pts.length > 0 ? "pointer" : "default" }}
    >
      <div className="metric-label" style={{ marginBottom: "0.6rem" }}>{title}</div>
      {chrono.length > 0 && domain ? (
        <>
          <LineChart
            labels={labels}
            datasets={[
              { label: "Observed", data, color },
              ...(hasEkf
                ? [{
                    label: "EKF Predicted",
                    data: ekf.data,
                    color: ekfColor ?? "#ffffff",
                    dashed: true,
                    meta: ekf.meta,
                  }]
                : []),
            ]}
            yLabel={yLabel}
            height={220}
            threshold={threshold}
            xValues={epochs}
            epochMs={epochs}
            xMin={domain.min}
            xMax={domain.max}
            xStepSize={ONE_H_MS}
            xMajorStepMs={SIX_H_MS}
            formatXTick={formatKnmiUtcTick}
            xLabel="UTC"
            syncHoverMs={syncHoverMs}
            onSyncHoverMs={onSyncHoverMs}
            {...speedScale}
          />
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            {source} · {chrono.length} points{hasEkf ? " · EKF overlay" : ""} · synced UTC axis.
          </div>
          {expanded && <ChartAnalysisBox block={analysis} title="Scientific interpretation" />}
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
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

function solarEventFeedLabel(source: string | undefined): string {
  switch (source) {
    case "noaa_swpc":
      return "NOAA SWPC";
    case "nasa_donki":
      return "NASA DONKI";
    case "mixed":
      return "NASA DONKI + NOAA SWPC";
    default:
      return "Solar event feed";
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SpaceWeatherPage() {
  const [sw, setSw]         = useState<SpaceWeatherCurrent | null>(null);
  const [sa, setSa]         = useState<SolarActivityFull | null>(null);
  const [saError, setSaError] = useState<string | null>(null);
  const [saLoading, setSaLoading] = useState(true);
  const [tl, setTl]         = useState<SpaceWeatherTimelines | null>(null);
  const [ekf, setEkf]       = useState<EkfStatus | null>(null);
  const [tab, setTab]       = useState(0);
  const [xrayRange, setXrayRange] = useState<"6H" | "24H">("24H");
  const [refreshing, setRefreshing] = useState(false);
  const [nowCat, setNowCat] = useState("");
  const [now, setNow] = useState(0);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("pending");
  const [liveStationCounts, setLiveStationCounts] = useState<LiveStationCounts | null>(null);
  const [selectedSolarInfo, setSelectedSolarInfo] = useState<SolarInfoKey>("summary");
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [timelineSyncMs, setTimelineSyncMs] = useState<number | null>(null);
  const toggleGraph = (graphId: string) => setSelectedGraph((current) => current === graphId ? null : graphId);

  useEffect(() => {
    const cached = peekSpaceWeather();
    if (cached) {
      setSw(cached);
      setTl(snapshotTimelines(cached));
      setFeedStatus("stale");
    }
    const cachedSa = peekSolarActivity();
    if (cachedSa) {
      setSa(cachedSa);
      setSaLoading(false);
    }
    const cachedStations = peekStations();
    if (cachedStations.length) {
      setLiveStationCounts(countSpiderLiveStationStatuses(cachedStations));
    }
  }, []);

  useEffect(() => subscribeSpaceWeather((next) => {
    setSw(next);
    setTl((prev) => prev ?? snapshotTimelines(next));
    setFeedStatus("ok");
    setLastFetched(new Date().toISOString());
  }), []);

  useEffect(() => subscribeSolarActivity((next) => {
    setSa(next);
    setSaLoading(false);
    setSaError(next?.error ?? null);
  }), []);

  useEffect(() => {
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmt = () => {
      setNow(Date.now());
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

  const fetchAll = useCallback((background = false) => {
    if (!background && !peekSpaceWeather()) {
      setFeedStatus("pending");
    }

    // Kick off every feed immediately so the page fills as each API returns.
    getSpaceWeather(true)
      .then((s) => {
        setSw(s);
        setTl((prev) => prev ?? snapshotTimelines(s));
        setFeedStatus("ok");
        setLastFetched(new Date().toISOString());
      })
      .catch(() => {
        const cached = peekSpaceWeather();
        if (cached) {
          setSw(cached);
          setTl((prev) => prev ?? snapshotTimelines(cached));
          setFeedStatus("stale");
        } else {
          setFeedStatus("down");
        }
      });

    getStations(false)
      .then((stations) => setLiveStationCounts(countSpiderLiveStationStatuses(stations)))
      .catch(() => null);

    if (!background) setSaLoading((prev) => (peekSolarActivity() ? false : prev || true));
    getSolarActivity(false, true)
      .then((payload) => {
        setSa(payload);
        setSaError(payload?.error ?? null);
      })
      .catch((error: unknown) => {
        // Keep any previous payload so the monitor doesn't blank out on a transient failure.
        setSaError(error instanceof Error ? error.message : "Solar monitor API unreachable");
      })
      .finally(() => setSaLoading(false));

    getTimelines()
      .then(setTl)
      .catch(() => null);

    getEkfStatus()
      .then(setEkf)
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetchAll(false);
    const id = window.setInterval(() => fetchAll(true), 45_000);
    return () => window.clearInterval(id);
  }, [fetchAll]);

  useEffect(() => subscribeStations((next) => {
    if (next.length) setLiveStationCounts(countSpiderLiveStationStatuses(next));
  }), []);

  const freshnessMsg = useFeedFreshness("space-weather", feedStatus);
  // Never claim “figures show N/A” while we already have live/cached values on screen.
  const showUnavailableBanner = Boolean(freshnessMsg) && !sw;

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

  const timelineAnalyses = useMemo(() => ({
    kp: analyzeKpTimeline(kpPoints),
    dst: analyzeDstTimeline(dstPoints),
    f107: analyzeF107Timeline(f107Points),
    solarWind: analyzeSolarWindTimeline(solarWindPoints),
    s4: analyzeS4Timeline(s4Points),
    gnss: analyzeGnssRiskTimeline(gnssPoints),
    stations: analyzeStationsOnlineTimeline(stationsOnlinePoints),
  }), [kpPoints, dstPoints, f107Points, solarWindPoints, s4Points, gnssPoints, stationsOnlinePoints]);

  /** Prefer solar-wind UTC span so Kp/Dst share the same live window as L1 graphs. */
  const liveMetricTimeDomain = useMemo(() => {
    const windEpochs = chronologicalPoints(solarWindPoints).map((p) => p.ms);
    if (windEpochs.length > 1) return sharedTimeDomain([windEpochs]);
    const lists = [kpPoints, dstPoints, f107Points, solarWindPoints, s4Points, gnssPoints, stationsOnlinePoints]
      .map((pts) => chronologicalPoints(pts).map((p) => p.ms))
      .filter((epochs) => epochs.length > 0);
    return sharedTimeDomain(lists);
  }, [kpPoints, dstPoints, f107Points, solarWindPoints, s4Points, gnssPoints, stationsOnlinePoints]);

  const liveMetricSync = {
    syncHoverMs: timelineSyncMs,
    onSyncHoverMs: setTimelineSyncMs,
    timeDomain: liveMetricTimeDomain,
  };

  const snapshotStatus = monitoringFreshness(sw?.updated_utc, now, Boolean(sw), feedStatus !== "ok");
  const solarStatus = monitoringFreshness(sa?.updated, now, Boolean(sa && sa.mode !== "unavailable"), Boolean(saError) || sa?.mode !== "live");
  const overallStatus = snapshotStatus === "LIVE" && solarStatus === "LIVE" ? "LIVE"
    : snapshotStatus === "UNAVAILABLE" && solarStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "DELAYED";
  const solarFeedLive = solarStatus === "LIVE";
  const solarFeedLabel = saLoading && !sa
    ? "Loading solar data…"
    : solarFeedLive
      ? "Live Data"
      : sa?.mode === "stale"
        ? "Cached — live refresh failed"
        : sa?.mode === "partial"
          ? "Partial feeds"
      : saError
        ? "Connection issue"
        : "Feed unavailable";
  const flareClassRaw = sa?.flare_class?.trim();
  const flareClass = saLoading && !sa
    ? "Loading…"
    : !flareClassRaw || flareClassRaw.toUpperCase() === "N/A"
      ? "Unavailable"
      : flareClassRaw;
  const actLabel     = sa?.activity_label ?? "Unavailable";
  const alerts       = Array.isArray(sa?.alerts) ? sa.alerts : [];
  const donkiFlares  = Array.isArray(sa?.donki_flares) ? sa.donki_flares : [];
  const donkiCmes    = Array.isArray(sa?.donki_cmes) ? sa.donki_cmes : [];
  const donkiStorms  = Array.isArray(sa?.donki_storms) ? sa.donki_storms : [];
  const alertCount   = alerts.length;
  const donkiLive = sa?.donki_status === "live";
  const eventFeedSource = sa?.event_feed_source;
  const eventFeedName = solarEventFeedLabel(eventFeedSource);
  const eventFeedUnavailableMsg =
    sa?.donki_note || saError || `${eventFeedName} unavailable. Retrying automatically.`;

  const flareCountColor = donkiFlareCountColor(donkiFlares.length, donkiFlares);
  const cmeCountColor = donkiCmeCountColor(donkiCmes.length, donkiCmes);
  const stormCountColor = donkiStormCountColor(donkiStorms.length, donkiStorms);

  const conditionLabel   = kp === null ? "Geomagnetic data unavailable" : kp >= 5 ? "Storm Active" : kp !== null && kp >= 3 ? "Disturbed" : "Quiet";
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
  const xrayAnalysis = useMemo<ChartAnalysisBlock>(() => {
    if (!xraySlice.length) {
      return analyzeGoesXrayExplanation({ flareClass });
    }
    const peak = Math.max(...xraySlice);
    const latest = xraySlice[xraySlice.length - 1];
    return analyzeGoesXrayExplanation({
      flareClass,
      sampleCount: xraySlice.length,
      latest,
      peak,
    });
  }, [xraySlice, flareClass]);
  const xrayExplanationOpen = selectedGraph === "xray";

  // ── GNSS Impact ───────────────────────────────────────────────────────────
  const impact = getGnssImpact(kp, s4, flareClass);

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
  const fluxLabel = displayFlux(sa?.flux);
  const solarInfo: Record<SolarInfoKey, SolarInfo> = {
    summary: {
      title: "Solar Activity",
      summary: `Current solar activity level: ${actLabel}. Current flare class: ${flareClass}. SWPC bulletins: ${sa?.feed_status?.swpc_alerts?.reachable ? alertCount : "unavailable"}.`,
      detail: [
        "This card summarises the Sun's present activity for GNSS operations. \"Low\" means background flare levels (A/B class) and a quiet solar wind; \"Moderate\" means C-class flares or elevated solar wind are present; \"High\"/\"Severe\" mean M/X-class flares or active geomagnetic conditions that can raise TEC, scintillation, and radio disturbance risk.",
        `Right now the level is "${actLabel}", driven by a ${flareClass} flare class${alertCount > 0 ? ` and ${alertCount} active NOAA alert(s)` : ""}.`,
      ].join(" "),
    },
    flare: {
      title: "Solar Flare - GOES X-Ray",
      summary: `Current flare class: ${flareClass}${fluxLabel ? `, flux ${fluxLabel}` : ""}.`,
      detail: [
        "GOES X-ray class describes flare strength on a logarithmic scale: A and B are background, C is moderate, M is major, and X is extreme — each letter step is roughly 10× the peak X-ray flux of the one before it. The number after the letter (e.g. the \"4.3\" in B4.3) is a linear multiplier within that class, not a separate scale, so B4.3 sits about 43% of the way through the B range. Strong (M/X) flares can disturb HF radio and may affect GNSS signal tracking on the sunlit side of Earth.",
        interpretFlareClass(flareClass),
      ].filter(Boolean).join(" "),
    },
    xray: {
      title: "GOES X-Ray Flux",
      summary: xraySlice.length > 0 ? `${xraySlice.length} recent X-ray samples are loaded.` : "X-ray flux data is unavailable.",
      detail: "The X-ray chart shows short-term solar flare energy from NOAA GOES in the 0.1–0.8 nm band, scaled ×10⁻⁷ W/m² for readability (so a chart value of \"4.3\" is the same B4.3 flux shown in the flare card). Rising spikes indicate flare activity; flat low values (below ~1, i.e. A-class) mean the flare environment is quiet.",
    },
    wind: {
      title: "Solar Wind",
      summary: `Speed: ${sa?.solar_wind?.speed != null ? `${sa.solar_wind.speed.toFixed(0)} km/s` : "feed unavailable"}; IMF Bz: ${sa?.solar_wind?.bz != null ? `${sa.solar_wind.bz.toFixed(1)} nT` : "feed unavailable"}.`,
      detail: [
        "Solar wind carries charged particles from the Sun to Earth. Typical quiet-time speed is 300-500 km/s; above ~500 km/s is considered fast (often from a coronal hole or CME). IMF Bz is the north-south component of the interplanetary magnetic field: negative (southward) Bz links up with Earth's own field and drives geomagnetic activity, raising Kp and disturbing GNSS positioning, while positive (northward) Bz is generally quiet.",
        sa?.solar_wind?.speed != null && sa?.solar_wind?.bz != null
          ? `Right now: speed ${sa.solar_wind.speed.toFixed(0)} km/s (${sa.solar_wind.speed >= 500 ? "fast" : "typical"}), IMF Bz ${sa.solar_wind.bz.toFixed(1)} nT (${sa.solar_wind.bz < 0 ? "southward — more geoeffective" : "northward — quiet"}).`
          : null,
      ].filter(Boolean).join(" "),
    },
    alerts: {
      title: "NOAA Alerts / Watches / Warnings",
      summary: alertMsg ? `Latest alert: ${alertMsg.length > 120 ? `${alertMsg.slice(0, 120)}...` : alertMsg}` : sa?.feed_status?.swpc_alerts?.reachable ? "No bulletins returned by NOAA." : "NOAA alert status unavailable.",
      detail: "NOAA SWPC alerts are operational warnings for solar radiation storms (S-scale), radio blackouts (R-scale), and geomagnetic storms (G-scale) — each scale runs 1 (minor) to 5 (extreme). These warnings help decide when to monitor GNSS quality more closely; an \"Electron flux exceeded\" alert like the one shown is a radiation-belt enhancement watch, not itself a confirmed storm.",
    },
    flareEvents: {
      title: "Solar Flares",
      summary: `${donkiFlares.length} flare event(s) in the selected 7-day window.`,
      detail: `This count comes from DONKI flare events over the past 7 days. A higher count means more recent solar eruptive activity, but storm impact at Earth still depends on direction, timing, and associated CME or solar-wind conditions. ${donkiFlares.length === 0 ? "Zero here means no cataloged flare events in this window — a calm period." : "Check each event's class (A-X) for how strong it was."}`,
    },
    cme: {
      title: "Coronal Mass Ejections",
      summary: `${donkiCmes.length} CME event(s) in the selected 7-day window.`,
      detail: `A CME is a large eruption of solar plasma and magnetic field. If Earth-directed, it can arrive 1-3 days later and cause a geomagnetic storm affecting GNSS, power grids, and HF radio. ${donkiCmes.length === 0 ? "Zero here means no cataloged eruptions in this window." : "Not every CME is Earth-directed — only halo/partial-halo events aimed at Earth typically matter operationally."}`,
    },
    storms: {
      title: "Geomagnetic Storms",
      summary: `${donkiStorms.length} geomagnetic storm event(s) in the selected 7-day window.`,
      detail: `Geomagnetic storm events show Earth-side magnetic disturbance (measured via Kp/Dst), and are more directly linked to GNSS degradation than solar flare or CME counts alone. ${donkiStorms.length === 0 ? "Zero here means Earth's magnetic field has stayed quiet over this window." : "Higher Kp during these events means larger positioning error and possible RTK/PPP convergence delay."}`,
    },
    impact: {
      title: "Estimated operational context (provisional)",
      summary: `GNSS/CORS: ${impact.rtk}; HF radio: ${impact.hf}.`,
      detail: "Space-weather indicators provide context for monitoring. RTK accuracy, PPP convergence, satellite operations and power-grid effects require local measurements. These estimates do not establish an outage or confirm normal service.",
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
    <div className="page-stack space-weather-page">

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

      <div className="sw-monitor-status" role="status">
        <span className={`sw-feed-state sw-feed-state-${overallStatus.toLowerCase()}`}>
          {feedStatus === "pending" && !sw && !sa ? "Connecting" : overallStatus === "LIVE" ? "Feeds current" : overallStatus === "DELAYED" ? "Partial feeds" : "Feeds unavailable"}
          </span>
        <span>Indices: {snapshotStatus === "DELAYED" ? "partial" : snapshotStatus.toLowerCase()} · Solar: {solarStatus === "DELAYED" ? "partial" : solarStatus.toLowerCase()}</span>
        <span>Snapshot: {observationTime(sw?.updated_utc)}</span>
        {lastFetched && <span>Last successful fetch: {observationTime(lastFetched)}</span>}
      </div>
      <p className="sw-supporting-text">Refresh checks run every 45 seconds. Snapshot time is separate from each source’s observation time; check the timestamp on each reading.</p>
      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}
      <HomeStormAlertBanner sw={sw} />

      <ClickableMetricGrid
        sw={sw}
        updatedUtc={sw?.updated_utc}
        liveStationCounts={liveStationCounts}
        solar={sa}
        solarLoading={saLoading}
        now={now}
        refreshFailed={feedStatus !== "ok"}
        solarRefreshFailed={Boolean(saError)}
        loading={feedStatus === "pending" && !sw}
      />
      {/* ── Solar Activity Monitor section ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "0.7rem 1.1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>⚡</span>
            <span style={{ fontWeight: 800, fontSize: "0.85rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>Solar Activity Monitor</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <span className={`dot ${solarFeedLive ? "dot-ok" : "dot-warn"}`} style={{ width: "7px", height: "7px" }} />
            <span>{solarFeedLabel} · NOAA SWPC · {nowCat}</span>
          </div>
        </div>

        {saError && !solarFeedLive && (
          <div className="banner banner-warn" style={{ fontSize: "0.85rem" }} role="status">
            Some solar feeds are unavailable. Available observations remain visible; retrying automatically.
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.85rem", color: "var(--text-muted)", paddingLeft: "0.2rem" }}>
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Real-time solar conditions for GNSS, satellites and CORS networks</span>
        </div>

        {/* Row 1: GOES X-Ray chart (Solar Activity + Flare cards live in the metric grid above) */}
        <div>
          {/* GOES X-Ray Flux chart */}
          <div className="card" {...solarCardClickProps("xray", { display: "flex", flexDirection: "column", gap: "0.5rem" })}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>GOES X-Ray Flux — Last Day</div>
            {xraySlice.length > 0 ? (
              <>
                <LineChart
                  labels={xrayLabels}
                  datasets={[{ label: "X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#f97316" }]}
                  yLabel="Flux ×10⁻⁷"
                  height={150}
                />
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  0.1–0.8 nm band · Source: NOAA SWPC GOES primary · Current class {flareClass}
                  {fluxLabel ? ` · ${fluxLabel}` : ""}
                </div>
              </>
            ) : (
              <div className="banner banner-info" style={{ fontSize: "0.85rem" }}>X-ray flux data unavailable.</div>
            )}
          </div>
        </div>

        {/* Row 2: Solar Wind | Alerts | Flares count */}
        <div className="sw-triple-grid">

          {/* Solar Wind */}
          <div className="card" {...solarCardClickProps("wind")}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.8rem" }}>Solar Wind</div>
            {[
              { icon: "🌀", label: "Speed",       val: sa?.solar_wind?.speed,       unit: "km/s",   fmt: (v: number) => v.toFixed(0) },
              { icon: "🔵", label: "Density",     val: sa?.solar_wind?.density,     unit: "p/cm³",  fmt: (v: number) => v.toFixed(1) },
              { icon: "🌡️", label: "Proton Temp.", val: sa?.solar_wind?.temperature, unit: "K",      fmt: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
              { icon: "↕️", label: "IMF Bz",      val: sa?.solar_wind?.bz,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
              { icon: "🔵", label: "IMF Bt",      val: sa?.solar_wind?.bt,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
            ].map(({ icon, label, val, unit, fmt }) => {
              const display = typeof val === "number" && Number.isFinite(val) ? fmt(val) : null;
              const missingLabel = sa ? "Feed unavailable" : "Loading…";
              return (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0", borderBottom: "1px solid #1a2a3a", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{icon} {label}</span>
                  <span style={{ fontWeight: 700 }}>
                    {display !== null ? `${display} ${unit}` : missingLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div className="metric-label">Alerts / Watches / Warnings</div>
            {alertMsg ? (
              <>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Issued {observationTime(displayText(latestAlert?.issue_datetime))}
                </div>
                <div style={{ fontSize: "0.85rem", lineHeight: 1.5, overflowY: "auto", maxHeight: "180px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {alertMsg}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Check bulletin validity; a recent listing does not confirm an active warning.
                </div>
                {alertCount > 1 && <div style={{ fontSize: "0.85rem" }}>+{alertCount - 1} more bulletin(s)</div>}
              </>
            ) : (
              <p>{saLoading && !sa ? "Loading NOAA bulletins…" : sa?.feed_status?.swpc_alerts?.reachable && solarFeedLive ? "No bulletins returned by the current NOAA feed." : "Current NOAA alert status unavailable."}</p>
            )}
            <a href="#operational-alerts-title" style={{ marginTop: "auto", fontSize: "0.85rem" }}>Source: NOAA SWPC · View all bulletins ↓</a>
          </div>

          {/* Solar Flares count */}
          <div className="card" {...solarCardClickProps("flareEvents", { textAlign: "center" })}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Solar Flares</div>
            <div style={{ fontSize: donkiLive ? "3rem" : "1.1rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: donkiLive ? flareCountColor : "var(--text-muted)" }}>
              {saLoading && !sa ? "Loading…" : donkiLive ? donkiFlares.length : "Feed unavailable"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {!donkiLive
                ? sa?.donki_note || saError || "NASA DONKI flare feed is unavailable."
                : donkiFlares.length === 0
                ? `No flare events in the selected 7-day window.`
                : `Flare event(s) detected.`}
            </div>
            {dateRange && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>FLR: {dateRange}</div>}
          </div>
        </div>

        {/* Row 3: CME | Geomagnetic Storms | GNSS Impact */}
        <div className="sw-triple-grid">

          {/* CME count */}
          <div className="card" {...solarCardClickProps("cme", { textAlign: "center" })}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Coronal Mass Ejections</div>
            <div style={{ fontSize: donkiLive ? "3rem" : "1.1rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: donkiLive ? cmeCountColor : "var(--text-muted)" }}>
              {saLoading && !sa ? "Loading…" : donkiLive ? donkiCmes.length : "Feed unavailable"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {!donkiLive
                ? sa?.donki_note || saError || "NASA DONKI CME feed is unavailable."
                : donkiCmes.length === 0 ? "No CME events in the selected 7-day window." : "CME event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>CME event history · {dateRange}</div>}
          </div>

          {/* Geomagnetic Storms count */}
          <div className="card" {...solarCardClickProps("storms", { textAlign: "center" })}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Geomagnetic Storms</div>
            <div style={{ fontSize: donkiLive ? "3rem" : "1.1rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", color: donkiLive ? stormCountColor : "var(--text-muted)" }}>
              {saLoading && !sa ? "Loading…" : donkiLive ? donkiStorms.length : "Feed unavailable"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {!donkiLive
                ? sa?.donki_note || saError || "NASA DONKI storm feed is unavailable."
                : donkiStorms.length === 0 ? "No geomagnetic storm events in the selected 7-day window." : "Storm event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>GST event history · {dateRange}</div>}
          </div>

          {/* Impact on GNSS & CORS Networks (compact) */}
          <div className="card" {...solarCardClickProps("impact")}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.7rem" }}>Estimated operational context — provisional</div>
            <div className="sw-double-grid">
              {[
                { label: "GNSS / CORS",  val: impact.rtk },
                { label: "HF Radio",     val: impact.hf },
                { label: "Satellites",   val: "Impact not verified" },
                { label: "Power Grids",  val: "Check local GIC measurements" },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "6px", padding: "0.4rem 0.6rem" }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Condition banner ── */}
      <div className={`banner banner-${conditionVariant}`}>
        <strong>{selectedInfo.title}: {selectedInfo.summary}</strong>
        <div style={{ marginTop: "0.35rem", fontSize: "0.85rem", lineHeight: 1.45 }}>
          {selectedInfo.detail}
        </div>
        <div style={{ marginTop: "0.35rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Current condition: {conditionLabel}
        </div>
        {risk && risk !== "Low" && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
            Estimated GNSS risk: {risk} (provisional). Local positioning impact has not been verified.
          </div>
        )}
        {!(liveStationCounts?.online || sw?.stations_online) && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
            No live CORS connection count is available here. Check the station observations and network status before drawing conclusions about service availability.
          </div>
        )}
      </div>

      {/* NOAA bulletins live on Alerts (/storm-watch); keep a short pointer here. */}
      <section className="card" aria-label="NOAA alerts shortcut">
        <div className="sw-section-heading">
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>NOAA alerts, watches and warnings</h2>
        </div>
        <p className="sw-supporting-text" style={{ marginBottom: "0.65rem" }}>
          Recent SWPC bulletins and feed status are listed on the Alerts page with storm watches.
        </p>
        <Link href="/storm-watch/" style={{ fontSize: "0.88rem", fontWeight: 600 }}>
          Open Alerts for NOAA bulletins →
        </Link>
      </section>
      <CauseEffectTimelineStack />
      <IndexScaleReference />
      <AdvancedScientificIndices sw={sw} solar={sa} />

      {/* ── Tabs ── */}
      <div className="tabs">
        {["Live Metric Timelines", "Solar Activity", "Kp Scale"].map((t, i) => (
          <button key={t} className={`tab${tab === i ? " active" : ""}`} onClick={() => { setTab(i); setSelectedGraph(null); }}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: Timelines ── */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Live NOAA feeds and derived indices — shared UTC axis with solar wind (synced crosshair)
          </p>

          <TimelineCard graphId="kp" title="Live NOAA Kp Timeline"
            pts={kpPoints} color="#168bd2" yLabel="Kp Index"
            threshold={{ value: 5, label: "Storm threshold (5)" }}
            source="NOAA SWPC Planetary K-index 1-minute feed"
            analysis={timelineAnalyses.kp}
            expanded={selectedGraph === "kp"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.kp?.points}
            ekfColor="#7dd3fc"
            emptyMsg="Live NOAA Kp feed unavailable."
            {...liveMetricSync} />

          <TimelineCard graphId="dst" title="Live NOAA Dst Timeline"
            pts={dstPoints} color="#a78bfa" yLabel="Dst (nT)"
            threshold={{ value: -50, label: "Storm threshold (−50 nT)" }}
            source="NOAA SWPC Kyoto Dst index (hourly)"
            analysis={timelineAnalyses.dst}
            expanded={selectedGraph === "dst"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.dst?.points}
            ekfColor="#d8b4fe"
            emptyMsg="Live NOAA Dst feed unavailable."
            {...liveMetricSync} />

          <TimelineCard graphId="f107" title="Live NOAA F10.7 Solar Flux Timeline"
            pts={f107Points} color="#ffcc00" yLabel="F10.7 (sfu)"
            threshold={{ value: 150, label: "High activity (150 sfu)" }}
            source="NOAA SWPC F10.7 cm flux feed"
            analysis={timelineAnalyses.f107}
            expanded={selectedGraph === "f107"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.f107?.points}
            ekfColor="#fde68a"
            emptyMsg="Live NOAA F10.7 feed unavailable."
            {...liveMetricSync} />

          <TimelineCard graphId="solar-wind" title="Live NOAA Solar Wind Timeline"
            pts={solarWindPoints} color="#00cc88" yLabel="Speed (km/s)"
            threshold={{ value: 500, label: "Fast stream (500 km/s)", color: "#ff8c00", fillAbove: true }}
            source="NOAA SWPC solar-wind plasma 1-day feed"
            analysis={timelineAnalyses.solarWind}
            expanded={selectedGraph === "solar-wind"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.solar_wind?.points}
            ekfColor="#86efac"
            emptyMsg="Live solar wind feed unavailable."
            {...liveMetricSync} />

          <TimelineCard graphId="s4" title="Archived Scintillation S4 Timeline"
            pts={s4Points} color="#ff8c00" yLabel="S4 Index"
            threshold={{ value: 0.5, label: "Severe scintillation (0.5)" }}
            source="ZINGSA CORS ionosphere archive"
            analysis={timelineAnalyses.s4}
            expanded={selectedGraph === "s4"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.s4?.points}
            ekfColor="#fdba74"
            emptyMsg="No observed S4 archive value is available for the timeline."
            {...liveMetricSync} />

          <TimelineCard graphId="gnss-risk" title="Estimated GNSS Risk Timeline (provisional)"
            pts={gnssPoints} color="#168bd2" yLabel="Risk level"
            threshold={{ value: 2, label: "High risk (2)" }}
            source="Derived from NOAA Kp — ZINGSA GNSS risk thresholds"
            analysis={timelineAnalyses.gnss}
            expanded={selectedGraph === "gnss-risk"} onToggle={toggleGraph}
            ekfPoints={ekf?.series.gnss_risk?.points}
            ekfColor="#7dd3fc"
            emptyMsg="GNSS risk timeline unavailable."
            {...liveMetricSync} />

          {stationsOnlinePoints.length > 0 ? (
            <TimelineCard graphId="cors-online" title="Live CORS Stations Online Timeline"
              pts={stationsOnlinePoints} color="#00ff88" yLabel="Stations online"
              source="ZINGSA CORS station-health — current live count"
              analysis={timelineAnalyses.stations}
              expanded={selectedGraph === "cors-online"} onToggle={toggleGraph}
              ekfPoints={ekf?.series.stations_online?.points}
              ekfColor="#86efac"
              emptyMsg="Live CORS telemetry unavailable."
              {...liveMetricSync} />
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.8rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
            <span className={`dot ${solarFeedLive ? "dot-ok" : "dot-warn"}`} style={{ width: "7px", height: "7px" }} />
            <span>NOAA SWPC · {solarFeedLabel}</span>
          </div>

          {/* GOES X-Ray Flux chart */}
          <div
            className="card"
            role={xraySlice.length > 0 ? "button" : undefined}
            tabIndex={xraySlice.length > 0 ? 0 : undefined}
            aria-expanded={xraySlice.length > 0 ? xrayExplanationOpen : undefined}
            aria-label={xraySlice.length > 0 ? "GOES X-ray flux graph" : undefined}
            onClick={() => xraySlice.length > 0 && toggleGraph("xray")}
            onKeyDown={(event) => {
              if (xraySlice.length > 0 && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                toggleGraph("xray");
              }
            }}
            style={{ cursor: xraySlice.length > 0 ? "pointer" : "default" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.7rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div className="metric-label">SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {(["6H", "24H"] as const).map((r) => (
                  <button key={r} onClick={(event) => { event.stopPropagation(); setXrayRange(r); }}
                    style={{ padding: "0.2rem 0.7rem", fontSize: "0.85rem", fontWeight: 700, borderRadius: "5px", border: `1px solid ${xrayRange === r ? "var(--accent)" : "var(--border)"}`, background: xrayRange === r ? "var(--accent)" : "var(--surface)", color: "#fff", cursor: "pointer" }}>
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
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.6rem", fontSize: "0.85rem" }}>
                  {FLARE_SCALE.map((f) => (
                    <span key={f.cls} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ display: "inline-block", width: "10px", height: "3px", background: f.color, borderRadius: "2px" }} />
                      {f.label}
                    </span>
                  ))}
                </div>
                {xrayExplanationOpen && <ChartAnalysisBox block={xrayAnalysis} title="Scientific interpretation" />}
              </>
            ) : (
              <div className="banner banner-info">GOES X-ray flux data unavailable — NOAA SWPC feed offline or rate-limited.</div>
            )}
          </div>

          {/* KNMI-style heliospheric stack: protons, IMF, solar wind, Kp forecast */}
          <HeliosphericMonitorStack />

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
                emptyMsg={donkiLive ? "No flare regions in the last 7 days." : eventFeedUnavailableMsg}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                  {eventFeedName} flares · {dateRange}
                </div>
              )}
            </div>

            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Coronal Mass Ejections (CME)</div>
              <DataTable
                headers={["DATE (UTC)", "SPEED (KM/S)", "WIDTH", "HALO", "IMPACT"]}
                rows={cmeTableRows}
                emptyMsg={donkiLive ? "No CME events in the last 7 days." : eventFeedUnavailableMsg}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                  {eventFeedName} CME · {dateRange}
                </div>
              )}
            </div>
          </div>

          {/* Solar Radio Bursts */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Radio Bursts (Last 24H)</div>
            <DataTable
              headers={["TIME (UTC)", "TYPE", "FREQUENCY", "INTENSITY", "LOCATION"]}
              rows={radioBurstRows}
              emptyMsg={donkiLive ? "No flare-derived radio burst proxies in the last 7 days." : eventFeedUnavailableMsg}
            />
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              NOAA GOES X-ray · proxy from {donkiLive ? eventFeedName : "solar flare events"}
            </div>
          </div>

          {/* F10.7 & Sunspot Number — full multi-cycle record */}
          <SolarCycleFullRecordCharts />

          {/* Solar Cycle Progress */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Solar Cycle Progress</div>
            <div className="sw-double-grid sw-double-grid--center">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Solar Cycle</span>
                  <span style={{ fontWeight: 800 }}>25</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Cycle Progress</span>
                  <span style={{ fontWeight: 800, color: "#f97316" }}>{sc25Progress}%</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: "10px", background: "#1a2a3a", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc25Progress}%`, background: "linear-gradient(90deg, #22c55e, #eab308, #f97316)", borderRadius: "5px", transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Estimated Peak: 2024–2026 (Cycle 25 maximum window)</div>
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                <div>Start: December 2019</div>
                <div>Predicted end: ~2031</div>
                <div style={{ marginTop: "0.4rem", fontStyle: "italic" }}>Reference cycle window; no synthetic observation values are displayed.</div>
              </div>
            </div>
          </div>

          {/* Impact on GNSS & CORS Networks (detailed row) */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Estimated operational context — provisional</div>
            <div className="sw-triple-grid sw-triple-grid--tight">
              {[
                { label: "RTK Accuracy",        val: impact.rtk },
                { label: "PPP Convergence",     val: impact.ppp },
                { label: "Ionospheric Delay",   val: impact.iono },
                { label: "Signal Scintillation",val: impact.scint },
                { label: "HF Communication",    val: impact.hf },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
            {/* Africa CORS spanning full row */}
            <div style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Zimbabwe CORS — provisional context</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{impact.cors}</div>
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
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color }}>{label}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{desc}</div>
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
