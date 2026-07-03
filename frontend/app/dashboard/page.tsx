"use client";
import { useEffect, useState, useCallback } from "react";
import { getSpaceWeather, getTimelines, refreshSpaceWeather, getSpaceWeatherLogStatus, getStationStatusLog, getStationStatusEvents, getStationUptime, getEkfStatus } from "@/lib/api";
import ClickableMetricGrid from "@/components/spaceWeather/ClickableMetricGrid";
import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import { DashboardHeaderClocks } from "@/components/dashboard/DashboardClocks";
import GicLiveTimelinePanel from "@/components/dashboard/GicLiveTimelinePanel";
import SpaceWeatherReportsPanel from "@/components/dashboard/SpaceWeatherReportsPanel";
import StormWarningAlarm from "@/components/dashboard/StormWarningAlarm";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import Link from "next/link";
import LineChart from "@/components/charts/LineChart";
import StationStatusBarChart from "@/components/charts/StationStatusBarChart";
import type { SpaceWeatherCurrent, SpaceWeatherTimelines, TimelinePoint, SpaceWeatherLogStatus, StationStatusLogStatus, StationStatusEvent, StationUptimeRow, EkfStatus, EkfPoint } from "@/lib/types";

function alignEkfToPoints(points: TimelinePoint[], ekfPoints: EkfPoint[] | undefined) {
  const byT = new Map<string, EkfPoint>();
  (ekfPoints ?? []).forEach((p) => byT.set(p.t, p));
  const data: (number | null)[] = [];
  const meta: ({ error?: number | null; confidence?: number | null } | null)[] = [];
  for (const pt of points) {
    const m = byT.get(pt.t);
    data.push(m?.predicted ?? null);
    meta.push(m ? { error: m.error, confidence: m.confidence } : null);
  }
  return { data, meta };
}

const SCALE_ROWS = [
  {
    label: "Kp Scale Reference",
    items: [
      { range: "0-2", text: "Quiet", color: "#00ff88" },
      { range: "3", text: "Unsettled", color: "#52e34f" },
      { range: "4", text: "Active", color: "#c8f018" },
      { range: "5", text: "Minor Storm G1", color: "#ffb000" },
      { range: "6", text: "Moderate G2", color: "#ff7a00" },
      { range: "7", text: "Strong G3", color: "#ff2e2e" },
      { range: "8", text: "Severe G4", color: "#ff0080" },
      { range: "9", text: "Extreme G5", color: "#b000ff" },
    ],
  },
  {
    label: "Geomagnetic Condition Scale",
    items: [
      { range: "Quiet", text: "Kp 0-2", color: "#00ff88" },
      { range: "Unsettled", text: "Kp 3", color: "#52e34f" },
      { range: "Active", text: "Kp 4", color: "#c8f018" },
      { range: "Minor Storm G1", text: "Kp 5", color: "#ffb000" },
      { range: "Moderate G2", text: "Kp 6", color: "#ff7a00" },
      { range: "Strong G3", text: "Kp 7", color: "#ff2e2e" },
      { range: "Severe G4", text: "Kp 8", color: "#ff0080" },
      { range: "Extreme G5", text: "Kp 9", color: "#b000ff" },
    ],
  },
  {
    label: "Dst Index Scale (nT)",
    items: [
      { range: "0 to -20", text: "Quiet", color: "#00ff88" },
      { range: "-20 to -30", text: "Weak", color: "#52e34f" },
      { range: "-30 to -50", text: "Moderate", color: "#c8f018" },
      { range: "-50 to -100", text: "Intense", color: "#ffb000" },
      { range: "-100 to -200", text: "Severe", color: "#ff7a00" },
      { range: "-200 to -350", text: "Extreme", color: "#ff2e2e" },
      { range: "< -350", text: "Super Storm", color: "#b000ff" },
    ],
  },
  {
    label: "S4 Scintillation Index Scale",
    items: [
      { range: "0.0-0.1", text: "None", color: "#00ff88" },
      { range: "0.1-0.2", text: "Negligible", color: "#52e34f" },
      { range: "0.2-0.3", text: "Weak", color: "#c8f018" },
      { range: "0.3-0.5", text: "Moderate", color: "#ffcc00" },
      { range: "0.5-0.7", text: "Strong", color: "#ff7a00" },
      { range: "0.7-0.9", text: "Severe", color: "#ff2e2e" },
      { range: "0.9-1.0", text: "Full Outage", color: "#b000ff" },
    ],
  },
  {
    label: "TEC Scale (TECU)",
    items: [
      { range: "0-10", text: "Very Low", color: "#168bd2" },
      { range: "10-25", text: "Low", color: "#00ff88" },
      { range: "25-40", text: "Moderate", color: "#a8f000" },
      { range: "40-60", text: "High", color: "#ffcc00" },
      { range: "60-80", text: "Very High", color: "#ff7a00" },
      { range: "80-100", text: "Extreme", color: "#ff2e2e" },
      { range: "> 100", text: "Severe Storm", color: "#b000ff" },
    ],
  },
  {
    label: "Solar Flux F10.7 Scale (sfu)",
    items: [
      { range: "65-80", text: "Solar Min.", color: "#00c8c8" },
      { range: "80-100", text: "Low", color: "#2edb85" },
      { range: "100-130", text: "Below Avg.", color: "#a8f000" },
      { range: "130-170", text: "Moderate", color: "#ffcc00" },
      { range: "170-220", text: "High", color: "#ff7a00" },
      { range: "220-270", text: "Very High", color: "#ff2e2e" },
      { range: "> 270", text: "Extreme", color: "#b000ff" },
    ],
  },
  {
    label: "Solar Wind Speed Scale (km/s)",
    items: [
      { range: "250-350", text: "Slow", color: "#00c8c8" },
      { range: "350-450", text: "Typical", color: "#2edb85" },
      { range: "450-550", text: "Fast", color: "#a8f000" },
      { range: "550-650", text: "Very Fast", color: "#ffcc00" },
      { range: "650-750", text: "Storm Wind", color: "#ff7a00" },
      { range: "750-850", text: "Major CME", color: "#ff2e2e" },
      { range: "> 850", text: "Extreme", color: "#b000ff" },
    ],
  },
];

function timelineLabels(points: TimelinePoint[]) {
  return points.map((point) => point.t.slice(0, 16));
}

function timelineValues(points: TimelinePoint[]) {
  return points.map((point) => point.v ?? 0);
}

function safePoints(points: TimelinePoint[] | undefined) {
  return Array.isArray(points) ? points : [];
}

function liveSource(source: string, points: TimelinePoint[]) {
  const latest = points.at(-1)?.t;
  return latest ? `${source} ${points.length} API points. Latest sample: ${latest} UTC.` : source;
}

function TimelinePanel({
  title,
  points,
  color,
  yLabel,
  source,
  empty,
  ekfPoints,
}: {
  title: string;
  points: TimelinePoint[];
  color: string;
  yLabel: string;
  source: string;
  empty: string;
  ekfPoints?: EkfPoint[];
}) {
  const hasData = points.length > 0;
  const ekf = alignEkfToPoints(points, ekfPoints);
  const hasEkf = ekf.data.some((v) => v !== null);

  return (
    <div className="card operations-chart-card">
      <div className="operations-chart-title">{title}</div>
      {hasData ? (
        <>
          <LineChart
            labels={timelineLabels(points)}
            datasets={[
              { label: "Observed", data: timelineValues(points), color },
              ...(hasEkf ? [{ label: "EKF Predicted", data: ekf.data, color: "#ffffff", dashed: true, meta: ekf.meta }] : []),
            ]}
            yLabel={yLabel}
            height={230}
          />
          <p className="operations-source">{source}</p>
        </>
      ) : (
        <div className="banner banner-warn">{empty}</div>
      )}
    </div>
  );
}

function ScaleReference() {
  return (
    <div className="card scale-reference">
      {SCALE_ROWS.map((row) => (
        <div className="scale-row" key={row.label}>
          <div className="scale-row-label">{row.label}</div>
          <div className="scale-items">
            {row.items.map((item) => (
              <div className="scale-item" key={`${row.label}-${item.range}`}>
                <div className="scale-range">{item.range}</div>
                <div className="scale-text">{item.text}</div>
                <div className="scale-bar" style={{ backgroundColor: item.color }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);
  const [tl, setTl] = useState<SpaceWeatherTimelines | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [apiStatus, setApiStatus] = useState<"Live" | "Offline">("Live");
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("pending");
  const [logStatus, setLogStatus] = useState<SpaceWeatherLogStatus | null>(null);
  const [stationLog, setStationLog] = useState<StationStatusLogStatus | null>(null);
  const [stationEvents, setStationEvents] = useState<StationStatusEvent[]>([]);
  const [stationUptime, setStationUptime] = useState<StationUptimeRow[]>([]);
  const [ekf, setEkf] = useState<EkfStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const [swData, tlData, logData, stLog, stEvents, stUptime, ekfData] = await Promise.all([
        getSpaceWeather(),
        getTimelines(),
        getSpaceWeatherLogStatus().catch(() => null),
        getStationStatusLog().catch(() => null),
        getStationStatusEvents(168).catch(() => []),
        getStationUptime(168).catch(() => []),
        getEkfStatus().catch(() => null),
      ]);
      setSw(swData);
      setTl(tlData);
      setLogStatus(logData);
      setStationLog(stLog);
      setStationEvents(stEvents.slice(-12).reverse());
      setStationUptime(stUptime);
      setEkf(ekfData);
      setLastUpdated(new Date().toUTCString().slice(0, 25));
      setApiStatus("Live");
      setFeedStatus("ok");
    } catch {
      // The cards keep their empty state if the API is temporarily offline.
      setApiStatus("Offline");
      setFeedStatus("down");
    }
    setLoading(false);
  }, []);

  const freshnessMsg = useFeedFreshness("dashboard-space-weather", feedStatus);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);


  const kpPoints = safePoints(tl?.kp);
  const dstPoints = safePoints(tl?.dst);
  const f107Points = safePoints(tl?.f107);
  const solarWindPoints = safePoints(tl?.solar_wind);
  const s4Points = safePoints(tl?.s4);
  const stationsOnlinePoints = safePoints(tl?.stations_online);

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
            await load();
          }}
          disabled={loading}
        >
          Refresh
        </button>
        </div>
      </div>

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

      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}

      <StormWarningAlarm ekf={ekf} sw={sw} />

      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
        Operational snapshot of every index — for solar flare, CME, and NOAA alert detail see <Link href="/space-weather">Space Weather Monitoring</Link>.
      </p>
      <ClickableMetricGrid sw={sw} updatedUtc={sw?.updated_utc} />

      <ScaleReference />

      <SpaceWeatherReportsPanel />

      {kpPoints.length > 0 && (() => {
        const kpEkf = alignEkfToPoints(kpPoints, ekf?.series.kp?.points);
        const dstEkf = alignEkfToPoints(dstPoints, ekf?.series.dst?.points);
        const hasKpEkf = kpEkf.data.some((v) => v !== null);
        const hasDstEkf = dstEkf.data.some((v) => v !== null);
        return (
          <div className="card operations-chart-card" id="dashboard-timelines">
            <div className="operations-chart-title">7-Day Index Timelines</div>
            <LineChart
              labels={timelineLabels(kpPoints)}
              datasets={[
                { label: "Kp (Observed)", data: timelineValues(kpPoints), color: "#168bd2" },
                { label: "Dst (Observed, nT)", data: timelineValues(dstPoints), color: "#ff8c00" },
                ...(hasKpEkf ? [{ label: "Kp (EKF Predicted)", data: kpEkf.data, color: "#168bd2", dashed: true, meta: kpEkf.meta }] : []),
                ...(hasDstEkf ? [{ label: "Dst (EKF Predicted)", data: dstEkf.data, color: "#ff8c00", dashed: true, meta: dstEkf.meta }] : []),
              ]}
              yLabel="Index value"
              height={260}
            />
            <p className="operations-source">{liveSource("Source: /space-weather/timelines Kp and Dst API feed.", kpPoints)}</p>
          </div>
        );
      })()}

      <section className="operations-timelines">
        <TimelinePanel
          title="Live NOAA F10.7 Solar Flux Timeline"
          points={f107Points}
          color="#168bd2"
          yLabel="F10.7 (sfu)"
          source={liveSource("Source: /space-weather/timelines NOAA SWPC F10.7 cm flux API feed.", f107Points)}
          empty="Live NOAA F10.7 solar flux feed is unavailable."
          ekfPoints={ekf?.series.f107?.points}
        />
        <TimelinePanel
          title="Live NOAA Solar Wind Timeline"
          points={solarWindPoints}
          color="#168bd2"
          yLabel="Speed (km/s)"
          source={liveSource("Source: /space-weather/timelines NOAA SWPC solar-wind plasma API feed.", solarWindPoints)}
          empty="Live NOAA solar-wind plasma feed is unavailable."
          ekfPoints={ekf?.series.solar_wind?.points}
        />
        <GicLiveTimelinePanel />
        <TimelinePanel
          title="Live Scintillation S4 Timeline"
          points={s4Points}
          color="#168bd2"
          yLabel="S4 Index"
          source={liveSource("Source: /space-weather/timelines ZINGSA CORS S4 live/backfilled API feed.", s4Points)}
          empty="Live scintillation S4 telemetry is unavailable."
          ekfPoints={ekf?.series.s4?.points}
        />
        <TimelinePanel
          title="Live CORS Stations Online Timeline"
          points={stationsOnlinePoints}
          color="#00ff88"
          yLabel="Stations Online"
          source={liveSource("Source: /space-weather/timelines live ZINGSA CORS station-count API feed.", stationsOnlinePoints)}
          empty="Live CORS telemetry is unavailable - no station count timeline."
          ekfPoints={ekf?.series.stations_online?.points}
        />
      </section>

      {(stationEvents.length > 0 || stationUptime.length > 0) && (
        <div className="card card-accent">
          <div className="operations-chart-title">
            CORS Station Status Archive (last 7 days)
            {stationUptime.length > 0 ? ` · ${stationUptime.length} stations` : ""}
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            Online, degraded, and offline transitions are logged when station-health is polled for all 24 Zimbabwe CORS sites. If the CORS API connection is cut off, stations are marked unknown and a connection_lost event is recorded.
          </p>
          {stationUptime.length > 0 && (
            <StationStatusBarChart rows={stationUptime} height={440} />
          )}
          {stationEvents.length > 0 && (
            <>
              <div
                className="operations-chart-title"
                style={{ marginTop: stationUptime.length > 0 ? "1.25rem" : 0 }}
              >
                Recent station status events
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                Latest logged transitions when a CORS site changes between online, degraded, offline, or unknown (NTRIP pipeline poll).
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Time (UTC)</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Station</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Event</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {stationEvents.map((ev, i) => (
                  <tr key={`${ev.time}-${ev.station_code ?? "net"}-${i}`} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap" }}>{ev.time.replace("T", " ").slice(0, 19)}</td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{ev.station_code?.toUpperCase() ?? "—"}</td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{ev.event_type.replace(/_/g, " ")}</td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{ev.message ?? `${ev.previous_status ?? "?"} → ${ev.status}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </div>
      )}

      <StormWatchLog />

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading live data...</p>}
    </div>
  );
}
