"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  getSpaceWeather,
  getTimelines,
  refreshSpaceWeather,
  getSpaceWeatherLogStatus,
  getStationStatusLog,
  getEkfStatus,
  getEkfStatusWithRetry,
  getStations,
  getGicLiveModel,
  getGicSeries,
  getGicStatus,
} from "@/lib/api";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekStations, subscribeStations } from "@/lib/stationsStore";
import ClickableMetricGrid from "@/components/spaceWeather/ClickableMetricGrid";
import IndexScaleReference from "@/components/spaceWeather/IndexScaleReference";
import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import { DashboardHeaderClocks } from "@/components/dashboard/DashboardClocks";
import type { GicTimelineBundle } from "@/components/dashboard/GicLiveTimelinePanel";
import StormWarningAlarm from "@/components/dashboard/StormWarningAlarm";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { connectedStreamCount, countSpiderLiveStationStatuses, type LiveStationCounts } from "@/lib/liveStationStatus";
import { alignEkfToPoints } from "@/lib/ekfAlign";
import { conditionsForSeries } from "@/lib/spaceWeatherMetrics";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import {
  analyzeF107Timeline,
  analyzeGnssRiskTimeline,
  analyzeKpDstTimeline,
  analyzeS4Timeline,
  analyzeSolarWindTimeline,
  analyzeStationsOnlineTimeline,
  analyzeTecTimeline,
} from "@/lib/dashboardChartAnalysis";
import type {
  EkfPoint,
  EkfStatus,
  SpaceWeatherCurrent,
  SpaceWeatherTimelines,
  TimelinePoint,
  SpaceWeatherLogStatus,
  StationStatusLogStatus,
} from "@/lib/types";

const LineChart = dynamic(() => import("@/components/charts/LineChart"));
const ChartAnalysisBox = dynamic(() => import("@/components/dashboard/ChartAnalysisBox"));
const GicLiveTimelinePanel = dynamic(() => import("@/components/dashboard/GicLiveTimelinePanel"));
const NetworkUptimePanel = dynamic(() => import("@/components/dashboard/NetworkUptimePanel"));
const SpaceWeatherReportsPanel = dynamic(() => import("@/components/dashboard/SpaceWeatherReportsPanel"));

function timelineLabels(points: TimelinePoint[]) {
  return points.map((point) => point.t.slice(0, 16));
}

function timelineValues(points: TimelinePoint[]) {
  return points.map((point) => point.v ?? 0);
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

function liveSource(source: string, points: TimelinePoint[]) {
  const latest = points.at(-1)?.t;
  return latest ? `${source} ${points.length} API points. Latest sample: ${latest} UTC.` : source;
}

type ConditionKind = "kp" | "dst" | "tec" | "s4";
type ApiStatus = "Connecting" | "Live" | "Offline";
type SourceState = "pending" | "ok" | "error";
type SourceHealth = {
  current: SourceState;
  timelines: SourceState;
  stations: SourceState;
  ekf: SourceState;
};

function operationalCondition(sw: SpaceWeatherCurrent | null): { label: string; tone: string } {
  if (!sw) return { label: "Connecting", tone: "var(--text-muted)" };
  const risk = (sw.gnss_risk ?? "").toLowerCase();
  if ((sw.kp ?? 0) >= 7 || (sw.dst ?? 0) <= -100 || risk === "critical") {
    return { label: "Critical", tone: "var(--accent-alert)" };
  }
  if ((sw.kp ?? 0) >= 5 || (sw.dst ?? 0) <= -50 || risk === "high") {
    return { label: "Warning", tone: "var(--accent-warn)" };
  }
  if ((sw.kp ?? 0) >= 4 || risk === "moderate") {
    return { label: "Watch", tone: "#ffd166" };
  }
  return { label: "Quiet", tone: "var(--accent-ok)" };
}

function TimelinePanel({
  title,
  points,
  color,
  yLabel,
  source,
  empty,
  ekfPoints,
  conditionKind,
  analysis,
}: {
  title: string;
  points: TimelinePoint[];
  color: string;
  yLabel: string;
  source: string;
  empty: string;
  ekfPoints?: EkfPoint[];
  conditionKind?: ConditionKind;
  analysis?: ChartAnalysisBlock;
}) {
  const hasData = points.length > 0;
  const values = timelineValues(points);
  const ekf = alignEkfToPoints(points, ekfPoints);
  const hasEkf = ekf.data.some((v) => v !== null);
  const tooltipDetails = conditionKind ? conditionsForSeries(values, conditionKind) : undefined;

  return (
    <div className="card operations-chart-card">
      <div className="operations-chart-title">{title}</div>
      {hasData ? (
        <>
          <LineChart
            labels={timelineLabels(points)}
            datasets={[
              { label: "Observed", data: values, color },
              ...(hasEkf
                ? [{ label: "EKF Predicted", data: ekf.data, color: "#ffffff", dashed: true, meta: ekf.meta }]
                : []),
            ]}
            yLabel={yLabel}
            height={230}
            tooltipDetails={tooltipDetails}
            tooltipDetailLabel={
              conditionKind === "tec" ? "Ionospheric condition" : conditionKind === "s4" ? "Scintillation" : "Condition"
            }
          />
          {analysis && <ChartAnalysisBox block={analysis} />}
          <p className="operations-source">{source}</p>
        </>
      ) : (
        <div className="banner banner-warn">{empty}</div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);
  const [tl, setTl] = useState<SpaceWeatherTimelines | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [apiStatus, setApiStatus] = useState<ApiStatus>("Connecting");
  const [apiError, setApiError] = useState("");
  const [sourceHealth, setSourceHealth] = useState<SourceHealth>({
    current: "pending",
    timelines: "pending",
    stations: "pending",
    ekf: "pending",
  });
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("pending");
  const [logStatus, setLogStatus] = useState<SpaceWeatherLogStatus | null>(null);
  const [stationLog, setStationLog] = useState<StationStatusLogStatus | null>(null);
  const [ekf, setEkf] = useState<EkfStatus | null>(null);
  const [liveStationCounts, setLiveStationCounts] = useState<LiveStationCounts | null>(null);
  const [gicBundle, setGicBundle] = useState<GicTimelineBundle | null>(null);

  useEffect(() => {
    const cached = peekSpaceWeather();
    if (cached) {
      setSw(cached);
      setLoading(false);
      setFeedStatus("stale");
    }
    const cachedStations = peekStations();
    if (cachedStations.length) {
      setLiveStationCounts(countSpiderLiveStationStatuses(cachedStations));
    }
  }, []);

  useEffect(() => subscribeSpaceWeather((next) => {
    setSw(next);
    setFeedStatus("ok");
    setApiStatus("Live");
    setLoading(false);
  }), []);

  useEffect(() => subscribeStations((next) => {
    if (next.length) setLiveStationCounts(countSpiderLiveStationStatuses(next));
  }), []);

  const loadGicBundle = useCallback(async (): Promise<GicTimelineBundle | null> => {
    const status = await getGicStatus().catch(() => null);
    const withData = status?.stations.find((s) => s.has_data);
    const sid = (withData ?? status?.stations[0])?.station_id ?? "DEMA_001";
    const [liveModel, series] = await Promise.all([
      getGicLiveModel(24).catch(() => null),
      getGicSeries(sid, 24).catch(() => null),
    ]);
    return {
      stationId: sid,
      liveModel,
      series: series?.points?.length ? series : null,
    };
  }, []);

  const loadSecondary = useCallback(async () => {
    const [
      logR,
      stLogR,
      ekfR,
      stationsR,
      gicR,
    ] = await Promise.allSettled([
      getSpaceWeatherLogStatus(),
      getStationStatusLog(),
      getEkfStatus(),
      getStations(false),
      loadGicBundle(),
    ]);

    if (logR.status === "fulfilled") setLogStatus(logR.value);
    if (stLogR.status === "fulfilled") setStationLog(stLogR.value);
    if (ekfR.status === "fulfilled") setEkf(ekfR.value);
    if (stationsR.status === "fulfilled") setLiveStationCounts(countSpiderLiveStationStatuses(stationsR.value));
    if (gicR.status === "fulfilled" && gicR.value) setGicBundle(gicR.value);
    setSourceHealth((previous) => ({
      ...previous,
      ekf: ekfR.status === "fulfilled" ? "ok" : "error",
      stations: stationsR.status === "fulfilled" ? "ok" : "error",
    }));
  }, [loadGicBundle]);

  const load = useCallback(async (opts?: { refreshEkf?: boolean }) => {
    const cached = peekSpaceWeather();
    if (cached) {
      setSw(cached);
      setTl((prev) => prev ?? snapshotTimelines(cached));
      setFeedStatus("stale");
      setLoading(false);
    }
    setApiError("");
    if (!cached) setApiStatus("Connecting");
    try {
      const swData = await getSpaceWeather();
      setSw(swData);
      setTl((prev) => prev ?? snapshotTimelines(swData));
      setLastUpdated(new Date().toUTCString().slice(0, 25));
      setApiStatus("Live");
      setSourceHealth((previous) => ({ ...previous, current: "ok" }));
      setFeedStatus("ok");
      setLoading(false);
      getTimelines()
        .then((data) => {
          setTl(data);
          setSourceHealth((previous) => ({ ...previous, timelines: "ok" }));
        })
        .catch(() => {
          setSourceHealth((previous) => ({ ...previous, timelines: "error" }));
        });
      void loadSecondary();
      if (opts?.refreshEkf) {
        getEkfStatusWithRetry()
          .then(setEkf)
          .catch(() => null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The live API request failed.";
      setApiError(message);
      setSourceHealth((previous) => ({ ...previous, current: "error" }));
      if (cached) {
        setFeedStatus("stale");
        setApiStatus("Offline");
      } else {
        setApiStatus("Offline");
        setFeedStatus("down");
      }
      setLoading(false);
    }
  }, [loadSecondary]);

  const freshnessMsg = useFeedFreshness("dashboard-space-weather", feedStatus);
  const condition = operationalCondition(sw);
  const sourceStates = Object.values(sourceHealth);
  const sourcesOnline = sourceStates.filter((state) => state === "ok").length;
  const sourceStatusLabel = sourceStates.some((state) => state === "pending")
    ? `${sourcesOnline}/${sourceStates.length} connected · checking`
    : `${sourcesOnline}/${sourceStates.length} connected`;

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const currentTimestamp = sw?.updated_utc ?? null;
  const kpPoints = withCurrentFallback(safePoints(tl?.kp), currentPoint(sw?.kp, currentTimestamp));
  const dstPoints = withCurrentFallback(safePoints(tl?.dst), currentPoint(sw?.dst, currentTimestamp));
  const f107Points = withCurrentFallback(safePoints(tl?.f107), currentPoint(sw?.f107, currentTimestamp));
  const solarWindPoints = withCurrentFallback(safePoints(tl?.solar_wind), currentPoint(sw?.plasma_speed, currentTimestamp));
  const s4Points = withCurrentFallback(safePoints(tl?.s4), currentPoint(sw?.s4, currentTimestamp));
  const tecPoints = withCurrentFallback(safePoints(tl?.mean_vtec), currentPoint(sw?.mean_vtec, currentTimestamp));
  const gnssPoints = withCurrentFallback(safePoints(tl?.gnss_risk), currentPoint(riskScore(sw?.gnss_risk), currentTimestamp));
  const stationsOnlinePoints = withCurrentFallback(
    safePoints(tl?.stations_online),
    currentPoint(
      liveStationCounts ? connectedStreamCount(liveStationCounts) : sw?.stations_online ?? null,
      currentTimestamp,
    ),
  );

  const kpEkfCombined = alignEkfToPoints(kpPoints, ekf?.series.kp?.points);
  const dstEkfCombined = alignEkfToPoints(dstPoints, ekf?.series.dst?.points);
  const hasKpEkf = kpEkfCombined.data.some((v) => v !== null);
  const hasDstEkf = dstEkfCombined.data.some((v) => v !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header">
        <div className="dashboard-header-copy">
          <h1 className="page-title">Space Weather Operations Dashboard</h1>
          <p className="page-subtitle">Real-time monitoring of solar, geomagnetic, ionospheric, and Zimbabwe CORS network conditions.</p>
        </div>
        <div className="dashboard-header-aside">
          <DashboardHeaderClocks />
          <button
            className="btn dashboard-refresh-btn"
            onClick={async () => {
              setLoading(true);
              await refreshSpaceWeather();
              await load({ refreshEkf: true });
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      <section className="operations-summary" aria-label="Operational status summary">
        <div className="operations-summary-item">
          <span>Overall condition</span>
          <strong style={{ color: condition.tone }}>{condition.label}</strong>
        </div>
        <div className="operations-summary-item">
          <span>Live API</span>
          <strong className={`operations-status-${apiStatus.toLowerCase()}`}>{apiStatus}</strong>
        </div>
        <div className="operations-summary-item">
          <span>Core data sources</span>
          <strong>{sourceStatusLabel}</strong>
        </div>
        <div className="operations-summary-item">
          <span>CORS connected</span>
          <strong>{liveStationCounts ? connectedStreamCount(liveStationCounts) : "Checking…"}</strong>
        </div>
        <div className="operations-summary-item">
          <span>Last observation</span>
          <strong>{sw?.updated_utc ? sw.updated_utc.slice(0, 16).replace("T", " ") + " UTC" : "Checking…"}</strong>
        </div>
      </section>

      {apiStatus === "Offline" && (
        <div className="banner banner-warn" role="status">
          <div className="dashboard-error-row">
            <span>
              Live API unavailable{apiError ? `: ${apiError}` : "."} Cached observations may be shown.
            </span>
            <button className="btn" type="button" onClick={() => void load()}>Retry connection</button>
          </div>
        </div>
      )}

      {apiStatus === "Connecting" && (
        <div className="banner banner-info" role="status">Connecting to live space-weather feeds…</div>
      )}

      {apiStatus === "Live" && freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}

      {lastUpdated && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          Updated {lastUpdated} UTC · API status: {apiStatus} · graphs refresh every 60 seconds
          {logStatus ? (
            <> · Archive: {logStatus.record_count.toLocaleString()} samples ({logStatus.db_backend})</>
          ) : null}
          {stationLog ? (
            <> · Station log: {stationLog.event_count.toLocaleString()} events, {stationLog.snapshot_count.toLocaleString()} snapshots
              {stationLog.api_reachable ? "" : " · CORS API unreachable"}</>
          ) : null}
        </p>
      )}

      <StormWarningAlarm sw={sw} />

      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
        Operational snapshot of every index — for solar flare, CME, and NOAA alert detail see{" "}
        <Link href="/space-weather">Space Weather Monitoring</Link>.
      </p>
      <ClickableMetricGrid
        sw={sw}
        updatedUtc={sw?.updated_utc}
        liveStationCounts={liveStationCounts}
        loading={loading || apiStatus === "Connecting"}
      />

      <IndexScaleReference />

      <SpaceWeatherReportsPanel ekf={ekf} />

      {kpPoints.length > 0 && (
        <div className="card operations-chart-card" id="dashboard-timelines">
          <div className="operations-chart-title">7-Day Index Timelines (dual axis)</div>
          <LineChart
            labels={timelineLabels(kpPoints)}
            datasets={[
              { label: "Kp (Observed)", data: timelineValues(kpPoints), color: "#168bd2", yAxisId: "y" },
              { label: "Dst (Observed, nT)", data: timelineValues(dstPoints), color: "#ff8c00", yAxisId: "y2" },
              ...(hasKpEkf
                ? [{ label: "Kp (EKF)", data: kpEkfCombined.data, color: "#168bd2", dashed: true, meta: kpEkfCombined.meta, yAxisId: "y" as const }]
                : []),
              ...(hasDstEkf
                ? [{ label: "Dst (EKF)", data: dstEkfCombined.data, color: "#ffb347", dashed: true, meta: dstEkfCombined.meta, yAxisId: "y2" as const }]
                : []),
            ]}
            yLabel="Kp"
            secondaryYLabel="Dst (nT)"
            height={260}
            tooltipDetails={conditionsForSeries(timelineValues(kpPoints), "kp")}
            tooltipDetailLabel="Geomagnetic (Kp)"
          />
          <ChartAnalysisBox
            block={analyzeKpDstTimeline(kpPoints, dstPoints, hasKpEkf, hasDstEkf)}
          />
          <p className="operations-source">{liveSource("Source: /space-weather/timelines Kp and Dst API feed.", kpPoints)}</p>
        </div>
      )}

      <section className="operations-timelines">
        <TimelinePanel
          title="Live NOAA F10.7 Solar Flux Timeline"
          points={f107Points}
          color="#168bd2"
          yLabel="F10.7 (sfu)"
          source={liveSource("Source: /space-weather/timelines NOAA SWPC F10.7 cm flux API feed.", f107Points)}
          empty="Live NOAA F10.7 solar flux feed is unavailable."
          ekfPoints={ekf?.series.f107?.points}
          analysis={analyzeF107Timeline(f107Points)}
        />
        <TimelinePanel
          title="Live NOAA Solar Wind Timeline"
          points={solarWindPoints}
          color="#168bd2"
          yLabel="Speed (km/s)"
          source={liveSource("Source: /space-weather/timelines NOAA SWPC solar-wind plasma API feed.", solarWindPoints)}
          empty="Live NOAA solar-wind plasma feed is unavailable."
          ekfPoints={ekf?.series.solar_wind?.points}
          analysis={analyzeSolarWindTimeline(solarWindPoints)}
        />
        <TimelinePanel
          title="Network Mean TEC Timeline"
          points={tecPoints}
          color="#00ff88"
          yLabel="TECU"
          source={liveSource("Source: archived network mean VTEC from CORS processing (/space-weather/timelines).", tecPoints)}
          empty="No mean TEC history in the archive yet — requires logged VTEC samples."
          ekfPoints={ekf?.series.mean_vtec?.points}
          conditionKind="tec"
          analysis={analyzeTecTimeline(tecPoints)}
        />
        <GicLiveTimelinePanel data={gicBundle} />
        <TimelinePanel
          title="Live Scintillation S4 Timeline"
          points={s4Points}
          color="#168bd2"
          yLabel="S4 Index"
          source={liveSource("Source: /space-weather/timelines ZINGSA CORS S4 live/backfilled API feed.", s4Points)}
          empty="Live scintillation S4 telemetry is unavailable."
          ekfPoints={ekf?.series.s4?.points}
          conditionKind="s4"
          analysis={analyzeS4Timeline(s4Points)}
        />
        <TimelinePanel
          title="GNSS Risk Score Timeline"
          points={gnssPoints}
          color="#a78bfa"
          yLabel="Risk score"
          source={liveSource("Source: composite GNSS risk score from archived dashboard snapshots.", gnssPoints)}
          empty="GNSS risk timeline unavailable — archive needs more samples."
          ekfPoints={ekf?.series.gnss_risk?.points}
          analysis={analyzeGnssRiskTimeline(gnssPoints)}
        />
        <TimelinePanel
          title="CORS Connected Timeline"
          points={stationsOnlinePoints}
          color="#00ff88"
          yLabel="CORS Connected"
          source={liveSource("Source: /space-weather/timelines live ZINGSA CORS station-count API feed.", stationsOnlinePoints)}
          empty="Live CORS telemetry is unavailable - no station count timeline."
          ekfPoints={ekf?.series.stations_online?.points}
          analysis={analyzeStationsOnlineTimeline(stationsOnlinePoints)}
        />
      </section>

      <NetworkUptimePanel />

      <StormWatchLog compact hours={24} />

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading live data...</p>}
    </div>
  );
}
