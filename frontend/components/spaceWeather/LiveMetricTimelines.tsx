"use client";

/**
 * Shared Live Metric graph stack — identical on Home and Space Weather.
 * GOES X-ray → F10.7 → Heliospheric Monitor → Zimbabwe VTEC / CORS / GNSS.
 */

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import {
  getEkfStatus,
  getHeliosphericMonitor,
  getSolarActivity,
  getSpaceWeather,
  getStations,
  getTimelines,
} from "@/lib/api";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import {
  peekSolarActivity,
  publishSolarActivity,
  subscribeSolarActivity,
} from "@/lib/solarActivityStore";
import { peekStations, subscribeStations } from "@/lib/stationsStore";
import { getLoadProfile } from "@/lib/loadBudget";
import { loadLineChart, prefetchLineChart } from "@/lib/loadLineChart";
import { prefetchCauseEffectTimelineStack } from "@/lib/loadCauseEffectTimeline";
import { loadGoesSolarXrayCard } from "@/lib/loadGoesSolarXrayCard";
import {
  alignTimeDomain,
  chronologicalPoints,
  formatKnmiUtcTick,
  ONE_H_MS,
  parseTimelineEpoch,
  sharedTimeDomain,
  SIX_H_MS,
  startOfUtcDay,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";
import { alignEkfToPoints } from "@/lib/ekfAlign";
import { analyzeGoesXrayExplanation } from "@/lib/heliosphericChartAnalysis";
import {
  analyzeF107Timeline,
  analyzeStationsOnlineTimeline,
} from "@/lib/dashboardChartAnalysis";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import type {
  EkfPoint,
  EkfStatus,
  SolarActivityFull,
  SpaceWeatherCurrent,
  SpaceWeatherTimelines,
  Station,
  TimelinePoint,
} from "@/lib/types";
import DeferredMount from "@/components/spaceWeather/DeferredMount";
import HeliosphericMonitorStack from "@/components/spaceWeather/HeliosphericMonitorStack";
import CauseEffectTimelineStack from "@/components/spaceWeather/CauseEffectTimelineStack";

const LineChart = dynamic(() => loadLineChart().then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="banner banner-info" role="status">
      Loading chart…
    </div>
  ),
});
const ChartAnalysisBox = dynamic(() => import("@/components/dashboard/ChartAnalysisBox"), {
  ssr: false,
});
const GoesSolarXrayCard = dynamic(
  () => loadGoesSolarXrayCard().then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="sw-deferred-block" style={{ minHeight: 8 }} />,
  },
);

type PlotPoint = { t: string; v: number; ms: number };

function currentPoint(value: number | null | undefined, timestamp: string | null | undefined): PlotPoint[] {
  if (value == null || !Number.isFinite(value)) return [];
  const ms = parseTimelineEpoch(timestamp ?? "") ?? Date.now();
  return [{ t: new Date(ms).toISOString(), v: value, ms }];
}

function withCurrentFallback(points: PlotPoint[], fallback: PlotPoint[]) {
  return points.length > 0 ? points : fallback;
}

function snapshotTimelines(sw: SpaceWeatherCurrent): SpaceWeatherTimelines {
  const mk = (value: number | null | undefined, ts: string | null | undefined): TimelinePoint[] =>
    currentPoint(value, ts).map((p) => ({ t: p.t, v: p.v }));
  return {
    kp: [],
    dst: [],
    f107: mk(sw.f107, sw.updated_utc),
    solar_wind: [],
    s4: [],
    gnss_risk: [],
    stations_online: mk(sw.stations_online, sw.updated_utc),
    mean_vtec: [],
    gic: [],
  };
}

function connectedStreamCount(counts: { online: number; total: number } | null): number | null {
  if (!counts) return null;
  return counts.online;
}

function countLiveStations(stations: Station[]) {
  const online = stations.filter((s) => s.status === "online" || s.status === "degraded").length;
  return { online, total: stations.length || 25 };
}

function TimelineCard({
  graphId,
  title,
  pts,
  color,
  yLabel,
  threshold,
  source,
  analysis,
  expanded,
  onToggle,
  emptyMsg,
  ekfPoints,
  ekfColor,
  syncHoverMs = null,
  onSyncHoverMs,
  timeDomain,
}: {
  graphId: string;
  title: string;
  pts: PlotPoint[];
  color: string;
  yLabel: string;
  threshold?: { value: number; label: string; color?: string; fillAbove?: boolean };
  source: string;
  analysis: ChartAnalysisBlock;
  expanded: boolean;
  onToggle: (graphId: string) => void;
  emptyMsg?: string;
  ekfPoints?: EkfPoint[];
  ekfColor?: string;
  syncHoverMs?: number | null;
  onSyncHoverMs?: (ms: number | null) => void;
  timeDomain?: { min: number; max: number } | null;
}) {
  const chronoAll = chronologicalPoints(pts).filter((p): p is typeof p & { v: number } => p.v != null);
  const chrono = timeDomain
    ? chronoAll.filter((p) => p.ms >= timeDomain.min && p.ms <= timeDomain.max)
    : chronoAll;
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
      style={{ cursor: pts.length > 0 ? "pointer" : "default" } satisfies CSSProperties}
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

function normalizeTimelineSeries(raw: TimelinePoint[] | undefined): PlotPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: PlotPoint[] = [];
  for (const row of raw) {
    const t = String(row.t ?? "");
    const v = row.v;
    const ms = parseTimelineEpoch(t);
    if (!t || ms == null || v == null || !Number.isFinite(v)) continue;
    out.push({ t, v, ms });
  }
  return out;
}

export default function LiveMetricTimelines({ showIntro = true }: { showIntro?: boolean }) {
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(() => peekSpaceWeather());
  const [sa, setSa] = useState<SolarActivityFull | null>(() => peekSolarActivity());
  const [tl, setTl] = useState<SpaceWeatherTimelines | null>(() => {
    const cached = peekSpaceWeather();
    return cached ? snapshotTimelines(cached) : null;
  });
  const [ekf, setEkf] = useState<EkfStatus | null>(null);
  const [liveCounts, setLiveCounts] = useState<{ online: number; total: number } | null>(null);
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [xrayRange, setXrayRange] = useState<"6H" | "24H">("24H");
  const [timelineSyncMs, setTimelineSyncMs] = useState<number | null>(null);
  const [solarFeedLive, setSolarFeedLive] = useState(Boolean(peekSolarActivity()));

  const toggleGraph = (graphId: string) =>
    setSelectedGraph((current) => (current === graphId ? null : graphId));

  useEffect(() => {
    prefetchLineChart();
    prefetchCauseEffectTimelineStack();
    void loadGoesSolarXrayCard().catch(() => null);
    void getHeliosphericMonitor(false, false).catch(() => null);

    const profile = getLoadProfile();
    getTimelines(profile.timelineMaxPoints).then(setTl).catch(() => null);
    getEkfStatus().then(setEkf).catch(() => null);
    getSpaceWeather(false)
      .then((next) => {
        setSw(next);
        setTl((prev) => prev ?? snapshotTimelines(next));
      })
      .catch(() => null);
    getSolarActivity(false, false)
      .then((payload) => {
        publishSolarActivity(payload);
        setSa(payload);
        setSolarFeedLive(true);
      })
      .catch(() => setSolarFeedLive(false));
    getStations(false)
      .then((stations) => setLiveCounts(countLiveStations(stations)))
      .catch(() => null);
  }, []);

  useEffect(() => subscribeSpaceWeather((next) => {
    setSw(next);
    setTl((prev) => prev ?? snapshotTimelines(next));
  }), []);

  useEffect(() => subscribeSolarActivity((next) => {
    setSa(next);
    setSolarFeedLive(true);
  }), []);

  useEffect(() => subscribeStations((next) => {
    if (next.length) setLiveCounts(countLiveStations(next));
  }), []);

  const f107 = sw?.f107 ?? null;
  const currentTimestamp = sw?.updated_utc ?? null;
  const f107Points = withCurrentFallback(
    normalizeTimelineSeries(tl?.f107),
    currentPoint(f107, currentTimestamp),
  );
  const streamCount = liveCounts
    ? connectedStreamCount(liveCounts)
    : sw?.stations_online ?? null;
  const stationsOnlinePoints = withCurrentFallback(
    normalizeTimelineSeries(tl?.stations_online),
    currentPoint(streamCount, currentTimestamp),
  );

  const timelineAnalyses = useMemo(() => ({
    f107: analyzeF107Timeline(f107Points.map((p) => ({ t: p.t, v: p.v }))),
    stations: analyzeStationsOnlineTimeline(stationsOnlinePoints.map((p) => ({ t: p.t, v: p.v }))),
  }), [f107Points, stationsOnlinePoints]);

  const liveMetricTimeDomain = useMemo(() => {
    const lists = [f107Points, stationsOnlinePoints]
      .map((pts) => chronologicalPoints(pts).map((p) => p.ms))
      .filter((ms) => ms.length > 0);
    return sharedTimeDomain(lists);
  }, [f107Points, stationsOnlinePoints]);

  const liveMetricSync = {
    syncHoverMs: timelineSyncMs,
    onSyncHoverMs: setTimelineSyncMs,
    timeDomain: liveMetricTimeDomain,
  };

  const flareClassRaw = sa?.flare_class?.trim();
  const flareClass = !flareClassRaw || flareClassRaw.toUpperCase() === "N/A"
    ? "Unavailable"
    : flareClassRaw;

  const xrayRaw = sa?.xray_series ?? [];
  const xrayScaledAll = xrayRaw.map((v) => Math.round(v * 1e7 * 1000) / 1000);
  const xraySampleStepMs = 40 * 60 * 1000;
  const xrayEndMs = parseTimelineEpoch(sa?.updated ?? "") ?? Date.now();
  const xrayEpochsAll = xrayScaledAll.map(
    (_, i) => xrayEndMs - (xrayScaledAll.length - 1 - i) * xraySampleStepMs,
  );
  const xrayWindow = useMemo(() => {
    if (xrayRange === "6H") {
      const end = xrayEndMs;
      return { start: end - 6 * ONE_H_MS, end, majorHours: 1 as const };
    }
    const start = startOfUtcDay(xrayEndMs);
    return { start, end: start + 24 * ONE_H_MS, majorHours: 4 as const };
  }, [xrayRange, xrayEndMs]);
  const xrayPairs = xrayEpochsAll
    .map((ms, i) => ({ ms, v: xrayScaledAll[i] }))
    .filter((p) => p.ms >= xrayWindow.start && p.ms <= xrayWindow.end);
  const xraySlice = xrayPairs.map((p) => p.v);
  const xrayEpochs = xrayPairs.map((p) => p.ms);
  const xrayLabels = xrayEpochs.map((ms) => new Date(ms).toISOString());
  const xrayAxis = utcTimeAxisProps(
    { min: xrayWindow.start, max: xrayWindow.end },
    { rangeHours: xrayRange === "6H" ? 6 : 24, majorHours: xrayWindow.majorHours },
  );
  const xrayAnalysis = useMemo<ChartAnalysisBlock>(() => {
    if (!xraySlice.length) return analyzeGoesXrayExplanation({ flareClass });
    return analyzeGoesXrayExplanation({
      flareClass,
      sampleCount: xraySlice.length,
      latest: xraySlice[xraySlice.length - 1],
      peak: Math.max(...xraySlice),
    });
  }, [xraySlice, flareClass]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {showIntro && (
        <>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>
            Chronological Sun→Earth→Zimbabwe order using the Solar Activity GOES X-ray and Heliospheric Monitor graphs, then local VTEC / CORS / GNSS
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.8rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
            <span className={`dot ${solarFeedLive ? "dot-ok" : "dot-warn"}`} style={{ width: "7px", height: "7px" }} />
            <span>solar monitor-live data</span>
          </div>
        </>
      )}

      <GoesSolarXrayCard
        title="1 · SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm"
        xraySlice={xraySlice}
        xrayLabels={xrayLabels}
        xrayEpochs={xrayEpochs}
        xrayAxis={xrayAxis}
        xrayRange={xrayRange}
        onRangeChange={setXrayRange}
        explanationOpen={selectedGraph === "xray"}
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
        minDelayMs={0}
        fallback={<div className="sw-deferred-block" style={{ minHeight: 8 }} />}
      >
        <HeliosphericMonitorStack />
      </DeferredMount>

      <DeferredMount
        className="sw-deferred-block"
        minHeight={320}
        rootMargin="100px 0px"
        minDelayMs={0}
        fallback={<div className="sw-deferred-block" style={{ minHeight: 8 }} />}
      >
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
      </DeferredMount>
    </div>
  );
}
