"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { getSpaceWeather, getSolarActivity, getTimelines, refreshSpaceWeather, getStations, getEkfStatus } from "@/lib/api";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { absorbInlineBootPayload } from "@/lib/bootSpaceWeather";
import { peekSolarActivity, subscribeSolarActivity } from "@/lib/solarActivityStore";
import { peekStations, subscribeStations } from "@/lib/stationsStore";
import ClickableMetricGrid from "@/components/spaceWeather/ClickableMetricGrid";
import DeferredMount from "@/components/spaceWeather/DeferredMount";
import IndexScaleReference from "@/components/spaceWeather/IndexScaleReference";
import SwSectionBanner from "@/components/spaceWeather/SwSectionBanner";
import { monitoringFreshness, observationTime } from "@/lib/monitoringStatus";
import AdvancedScientificIndices from "@/components/spaceWeather/AdvancedScientificIndices";
import HomeStormAlertBanner from "@/components/layout/HomeStormAlertBanner";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import {
  analyzeF107Timeline,
  analyzeStationsOnlineTimeline,
} from "@/lib/dashboardChartAnalysis";
import { analyzeGoesXrayExplanation } from "@/lib/heliosphericChartAnalysis";
import {
  ONE_H_MS,
  SIX_H_MS,
  alignTimeDomain,
  chronologicalPoints,
  formatKnmiUtcTick,
  parseTimelineEpoch,
  sharedTimeDomain,
  startOfUtcDay,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";
import { alignEkfToPoints } from "@/lib/ekfAlign";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { connectedStreamCount, countSpiderLiveStationStatuses, type LiveStationCounts } from "@/lib/liveStationStatus";
import type { EkfPoint, EkfStatus, SpaceWeatherCurrent, SolarActivityFull, SpaceWeatherTimelines, TimelinePoint } from "@/lib/types";
import { DashboardHeaderClocks } from "@/components/dashboard/DashboardClocks";

const sectionFallback = (
  <div className="banner banner-info" role="status" style={{ margin: "0.75rem 0" }}>
    Loading section…
  </div>
);

const CauseEffectTimelineStack = dynamic(
  () => import("@/components/spaceWeather/CauseEffectTimelineStack"),
  { ssr: false, loading: () => sectionFallback },
);
const HeliosphericMonitorStack = dynamic(
  () => import("@/components/spaceWeather/HeliosphericMonitorStack"),
  { ssr: false, loading: () => sectionFallback },
);
const GoesSolarXrayCard = dynamic(
  () => import("@/components/spaceWeather/GoesSolarXrayCard"),
  { ssr: false, loading: () => sectionFallback },
);
const SolarCycleFullRecordCharts = dynamic(
  () => import("@/components/spaceWeather/SolarCycleFullRecordCharts"),
  { ssr: false, loading: () => sectionFallback },
);
const ZimbabweTecTeachingLab = dynamic(
  () => import("@/components/spaceWeather/ZimbabweTecTeachingLab"),
  { ssr: false, loading: () => sectionFallback },
);
const TecMethodComparisonLab = dynamic(
  () => import("@/components/spaceWeather/TecMethodComparisonLab"),
  { ssr: false, loading: () => sectionFallback },
);
const LineChart = dynamic(() => import("@/components/charts/LineChart"), {
  ssr: false,
  loading: () => <div className="banner banner-info" role="status">Loading chart…</div>,
});
const ChartAnalysisBox = dynamic(() => import("@/components/dashboard/ChartAnalysisBox"), {
  ssr: false,
});
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
  { range: "5",   label: "Minor Storm",    color: "#f97316" },
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
  // If a shared domain clipped everything (e.g. timelines still loading), fall
  // back to the raw series so we never flash "feed unavailable" with live points.
  const plot = chrono.length > 0 ? chrono : chronoAll;
  const labels = plot.map((p) => p.t);
  const epochs = plot.map((p) => p.ms);
  const data = plot.map((p) => p.v);
  const ekf = alignEkfToPoints(
    plot.map((p) => ({ t: p.t, v: p.v })),
    ekfPoints,
  );
  const hasEkf = ekf.data.some((v) => v !== null);
  const domain =
    (chrono.length > 0 ? timeDomain : null) ??
    sharedTimeDomain([epochs]) ??
    (epochs.length
      ? alignTimeDomain(epochs[0] - ONE_H_MS, epochs[epochs.length - 1] + ONE_H_MS)
      : null);
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
      {plot.length > 0 && domain ? (
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
            {source} · {plot.length} points{hasEkf ? " · EKF overlay" : ""} · synced UTC axis.
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
  const [now, setNow] = useState(0);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("pending");
  const [liveStationCounts, setLiveStationCounts] = useState<LiveStationCounts | null>(null);
  const [selectedSolarInfo, setSelectedSolarInfo] = useState<SolarInfoKey>("summary");
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [timelineSyncMs, setTimelineSyncMs] = useState<number | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const toggleGraph = (graphId: string) => setSelectedGraph((current) => current === graphId ? null : graphId);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    // Seed after mount (not in useState) so SSR HTML matches the first client render.
    const cached = absorbInlineBootPayload() ?? peekSpaceWeather();
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
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = useCallback((background = false) => {
    if (!background && !peekSpaceWeather()) {
      setFeedStatus("pending");
    }

    // Critical path: paint metric cards + warm the shared Spider stations store
    // so the CORS map can draw markers without waiting on heatmap / idle work.
    getSpaceWeather(false)
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

    // Timelines power the default Live Metric Timelines tab — fetch with the
    // critical path so charts are not stuck on "feed unavailable".
    getTimelines()
      .then(setTl)
      .catch(() => null);

    if (!background) setSaLoading((prev) => (peekSolarActivity() ? false : prev || true));
    getSolarActivity(false, false)
      .then((payload) => {
        setSa(payload);
        setSaError(payload?.error ?? null);
      })
      .catch((error: unknown) => {
        setSaError(error instanceof Error ? error.message : "Solar monitor API unreachable");
      })
      .finally(() => setSaLoading(false));

    // Secondary feed after first paint.
    const runSecondary = () => {
      getEkfStatus()
        .then(setEkf)
        .catch(() => null);
    };
    if (background) {
      runSecondary();
    } else if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => runSecondary(), { timeout: 1500 });
    } else {
      globalThis.setTimeout(runSecondary, 120);
    }
  }, []);

  useEffect(() => {
    fetchAll(false);
    const id = window.setInterval(() => fetchAll(true), 45_000);
    // Leave "Connecting" within 12s even if a fetch is stuck — show unavailable
    // rather than an infinite Updating… grid (aligned with SW_FAST + retry budget).
    const watchdog = window.setTimeout(() => {
      setFeedStatus((prev) => {
        if (prev !== "pending") return prev;
        return peekSpaceWeather() ? "stale" : "down";
      });
      setSaLoading(false);
    }, 12_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(watchdog);
    };
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
  const f107  = sw?.f107 ?? null;
  const s4    = sw?.s4 ?? null;
  const risk  = sw?.gnss_risk ?? null;
  const currentTimestamp = sw?.updated_utc ?? null;

  const f107Points = withCurrentFallback(safePoints(tl?.f107), currentPoint(f107, currentTimestamp));
  const streamCount = liveStationCounts
    ? connectedStreamCount(liveStationCounts)
    : sw?.stations_online ?? null;
  const stationsOnlinePoints = withCurrentFallback(
    safePoints(tl?.stations_online),
    currentPoint(streamCount, currentTimestamp),
  );

  const timelineAnalyses = useMemo(() => ({
    f107: analyzeF107Timeline(f107Points),
    stations: analyzeStationsOnlineTimeline(stationsOnlinePoints),
  }), [f107Points, stationsOnlinePoints]);

  /** Shared UTC span for secondary Live Metric cards (driver/local stack has its own sync). */
  const liveMetricTimeDomain = useMemo(() => {
    const lists = [f107Points, stationsOnlinePoints]
      .map((pts) => chronologicalPoints(pts).map((p) => p.ms))
      .filter((epochs) => epochs.length > 0);
    return sharedTimeDomain(lists);
  }, [f107Points, stationsOnlinePoints]);

  const liveMetricSync = {
    syncHoverMs: timelineSyncMs,
    onSyncHoverMs: setTimelineSyncMs,
    timeDomain: liveMetricTimeDomain,
  };

  const snapshotStatus = monitoringFreshness(sw?.updated_utc, now, Boolean(sw), feedStatus === "down");
  const solarStatus = monitoringFreshness(
    sa?.updated,
    now,
    Boolean(sa && sa.mode !== "unavailable"),
    Boolean(saError) || sa?.mode === "unavailable",
  );
  const overallStatus = snapshotStatus === "LIVE" && solarStatus === "LIVE" ? "LIVE"
    : snapshotStatus === "UNAVAILABLE" && solarStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "DELAYED";
  const hasSolarPayload = Boolean(sa && (sa.xray_series?.length || sa.flare_class || sa.solar_wind));
  const solarFeedLive = solarStatus === "LIVE" || (hasSolarPayload && !saError && sa?.mode !== "unavailable");
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
        : hasSolarPayload
          ? "Partial feeds"
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

  const conditionLabel   = kp === null ? "Geomagnetic data unavailable" : kp >= 5 ? "Storm Active" : kp !== null && kp >= 3 ? "Disturbed" : "Quiet";
  const conditionVariant = kp !== null && kp >= 5 ? "alert" : kp !== null && kp >= 3 ? "warn" : "info";

  // ── X-Ray series for charts ───────────────────────────────────────────────
  const xrayRaw = sa?.xray_series ?? [];
  // Scale ×10⁻⁷ and round so Chart.js never prints 2.9000000000000004
  const xrayScaledAll = xrayRaw.map((v) => Math.round(v * 1e7 * 1000) / 1000);
  const xraySampleStepMs = 40 * 60 * 1000;
  const xrayEndMs = parseTimelineEpoch(sa?.updated ?? "") ?? Date.now();
  const xrayEpochsAll = xrayScaledAll.map(
    (_, i) => xrayEndMs - (xrayScaledAll.length - 1 - i) * xraySampleStepMs,
  );
  const xrayWindow = useMemo(() => {
    if (xrayRange === "6H") {
      const end = xrayEndMs;
      const start = end - 6 * ONE_H_MS;
      return { start, end, majorHours: 1 as const };
    }
    // 24H = UTC calendar day of the latest sample, 00:00 → 24:00
    const start = startOfUtcDay(xrayEndMs);
    return { start, end: start + 24 * ONE_H_MS, majorHours: 4 as const };
  }, [xrayRange, xrayEndMs]);
  const xrayPairs = xrayEpochsAll
    .map((ms, i) => ({ ms, v: xrayScaledAll[i] }))
    .filter((p) => p.ms >= xrayWindow.start && p.ms <= xrayWindow.end);
  const xraySlice = xrayPairs.map((p) => p.v);
  const xrayEpochs = xrayPairs.map((p) => p.ms);
  const xrayLabels = xrayEpochs.map((ms) => new Date(ms).toISOString());
  const xrayDomain = { min: xrayWindow.start, max: xrayWindow.end };
  const xrayAxis = utcTimeAxisProps(xrayDomain, {
    rangeHours: xrayRange === "6H" ? 6 : 24,
    majorHours: xrayWindow.majorHours,
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
        <span
          className={`sw-feed-state sw-feed-state-${!hasMounted ? "unavailable" : overallStatus.toLowerCase()}`}
          suppressHydrationWarning
        >
          {!hasMounted || (feedStatus === "pending" && !sw && !sa)
            ? "Connecting"
            : overallStatus === "LIVE"
              ? "Feeds current"
              : overallStatus === "DELAYED"
                ? "Partial feeds"
                : "Feeds unavailable"}
        </span>
        <span suppressHydrationWarning>
          Indices: {!hasMounted ? "unavailable" : snapshotStatus === "DELAYED" ? "partial" : snapshotStatus.toLowerCase()}
          {" · "}
          Solar: {!hasMounted ? "unavailable" : solarStatus === "DELAYED" ? "partial" : solarStatus.toLowerCase()}
        </span>
        <span suppressHydrationWarning>Snapshot: {!hasMounted ? "Time unavailable" : observationTime(sw?.updated_utc)}</span>
        {hasMounted && lastFetched && <span>Last successful fetch: {observationTime(lastFetched)}</span>}
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
        refreshFailed={feedStatus === "down"}
        solarRefreshFailed={Boolean(saError)}
        loading={feedStatus === "pending" && !sw}
      />

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
        <SwSectionBanner
          icon="🔔"
          title="NOAA alerts, watches and warnings"
          meta={<Link href="/storm-watch/">Open Alerts →</Link>}
        />
        <p className="sw-supporting-text" style={{ margin: "0.75rem 0 0" }}>
          Recent SWPC bulletins and feed status are listed on the Alerts page with storm watches.
        </p>
      </section>
      <DeferredMount
        className="sw-deferred-block"
        minHeight={320}
        rootMargin="180px 0px"
        fallback={sectionFallback}
      >
        {/* Timelines live under Live Metric; keep station readings + CORS map here. */}
        <CauseEffectTimelineStack variant="overview" />
      </DeferredMount>
      <DeferredMount
        className="sw-deferred-block"
        minHeight={120}
        rootMargin="160px 0px"
        fallback={sectionFallback}
      >
        <IndexScaleReference />
        <AdvancedScientificIndices sw={sw} solar={sa} />
      </DeferredMount>

      {/* ── Tabs ── */}
      <div className="tabs">
        {["Live Metric Timelines", "Solar Activity", "Kp Scale", "Zimbabwe Ionospheric Response"].map((t, i) => (
          <button key={t} className={`tab${tab === i ? " active" : ""}`} onClick={() => { setTab(i); setSelectedGraph(null); }}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: Timelines ── */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Chronological Sun→Earth→Zimbabwe order using the Solar Activity GOES X-ray and Heliospheric Monitor graphs, then local VTEC / CORS / GNSS
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.8rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
            <span className={`dot ${solarFeedLive ? "dot-ok" : "dot-warn"}`} style={{ width: "7px", height: "7px" }} />
            <span>solar monitor-live data</span>
          </div>

          <GoesSolarXrayCard
            title="1 · SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm"
            xraySlice={xraySlice}
            xrayLabels={xrayLabels}
            xrayEpochs={xrayEpochs}
            xrayAxis={xrayAxis}
            xrayRange={xrayRange}
            onRangeChange={setXrayRange}
            explanationOpen={xrayExplanationOpen}
            onToggle={() => toggleGraph("xray")}
            analysis={xrayAnalysis}
          />

          <TimelineCard
            graphId="f107"
            title="2 · Live NOAA F10.7 Solar Flux Timeline"
            pts={f107Points}
            color="#ffcc00"
            yLabel="F10.7 (sfu)"
            threshold={{ value: 150, label: "High activity (150 sfu)" }}
            source="NOAA SWPC F10.7 cm flux feed"
            analysis={timelineAnalyses.f107}
            expanded={selectedGraph === "f107"}
            onToggle={toggleGraph}
            ekfPoints={ekf?.series.f107?.points}
            ekfColor="#fde68a"
            emptyMsg="Live NOAA F10.7 feed unavailable."
            {...liveMetricSync}
          />

          <DeferredMount
            className="sw-deferred-block"
            minHeight={280}
            rootMargin="120px 0px"
            fallback={sectionFallback}
          >
            <HeliosphericMonitorStack />
          </DeferredMount>

          <CauseEffectTimelineStack
            variant="local"
            localStartNumber={4}
            afterVtec={
              stationsOnlinePoints.length > 0 ? (
                <TimelineCard
                  graphId="cors-online"
                  title="5 · Live CORS Stations Online Timeline"
                  pts={stationsOnlinePoints}
                  color="#00ff88"
                  yLabel="Stations online"
                  source="ZINGSA CORS station-health — current live count"
                  analysis={timelineAnalyses.stations}
                  expanded={selectedGraph === "cors-online"}
                  onToggle={toggleGraph}
                  ekfPoints={ekf?.series.stations_online?.points}
                  ekfColor="#86efac"
                  emptyMsg="Live CORS telemetry unavailable."
                  {...liveMetricSync}
                />
              ) : (
                <div className="card">
                  <div className="metric-label" style={{ marginBottom: "0.6rem" }}>5 · Live CORS Stations Online Timeline</div>
                  <div className="banner banner-info">Live CORS telemetry is unavailable — no station count timeline.</div>
                </div>
              )
            }
          />
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

          <GoesSolarXrayCard
            xraySlice={xraySlice}
            xrayLabels={xrayLabels}
            xrayEpochs={xrayEpochs}
            xrayAxis={xrayAxis}
            xrayRange={xrayRange}
            onRangeChange={setXrayRange}
            explanationOpen={xrayExplanationOpen}
            onToggle={() => toggleGraph("xray")}
            analysis={xrayAnalysis}
          />

          {/* KNMI-style heliospheric stack: protons, IMF, solar wind, Kp forecast */}
          <DeferredMount
            className="sw-deferred-block"
            minHeight={280}
            rootMargin="200px 0px"
            fallback={sectionFallback}
          >
            <HeliosphericMonitorStack />
          </DeferredMount>

          {/* Zimbabwe response continues the Sun→Earth chain after Kp */}
          <DeferredMount
            className="sw-deferred-block"
            minHeight={280}
            rootMargin="200px 0px"
            fallback={sectionFallback}
          >
            <CauseEffectTimelineStack variant="local" />
          </DeferredMount>

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
          <DeferredMount
            className="sw-deferred-block"
            minHeight={240}
            rootMargin="200px 0px"
            fallback={sectionFallback}
          >
            <SolarCycleFullRecordCharts />
          </DeferredMount>

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

      {/* ── Tab 3: Zimbabwe Ionospheric Response ── */}
      {tab === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Local ionospheric response after Sun→Earth drivers — live Zimbabwe CORS VTEC graphs and scintillation / GNSS risk context
          </p>
          <CauseEffectTimelineStack
            variant="local"
            afterVtec={
              stationsOnlinePoints.length > 0 ? (
                <TimelineCard
                  graphId="cors-online-zw"
                  title="2 · Live CORS Stations Online Timeline"
                  pts={stationsOnlinePoints}
                  color="#00ff88"
                  yLabel="Stations online"
                  source="ZINGSA CORS station-health — current live count"
                  analysis={timelineAnalyses.stations}
                  expanded={selectedGraph === "cors-online-zw"}
                  onToggle={toggleGraph}
                  ekfPoints={ekf?.series.stations_online?.points}
                  ekfColor="#86efac"
                  emptyMsg="Live CORS telemetry unavailable."
                  {...liveMetricSync}
                />
              ) : (
                <div className="card">
                  <div className="metric-label" style={{ marginBottom: "0.6rem" }}>2 · Live CORS Stations Online Timeline</div>
                  <div className="banner banner-info">Live CORS telemetry is unavailable — no station count timeline.</div>
                </div>
              )
            }
          />
          <ZimbabweTecTeachingLab />
          <TecMethodComparisonLab />
        </div>
      )}

    </div>
  );
}
