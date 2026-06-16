"use client";
import { useEffect, useState, useCallback } from "react";
import { getSpaceWeather, getTimelines, refreshSpaceWeather } from "@/lib/api";
import MetricCard from "@/components/cards/MetricCard";
import LineChart from "@/components/charts/LineChart";
import type { SpaceWeatherCurrent, SpaceWeatherTimelines, TimelinePoint } from "@/lib/types";

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

function TimelinePanel({
  title,
  points,
  color,
  yLabel,
  source,
  empty,
}: {
  title: string;
  points: TimelinePoint[];
  color: string;
  yLabel: string;
  source: string;
  empty: string;
}) {
  const hasData = points.length > 0;

  return (
    <div className="card operations-chart-card">
      <div className="operations-chart-title">{title}</div>
      {hasData ? (
        <>
          <LineChart
            labels={timelineLabels(points)}
            datasets={[{ label: yLabel, data: timelineValues(points), color }]}
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

  const load = useCallback(async () => {
    try {
      const [swData, tlData] = await Promise.all([getSpaceWeather(), getTimelines()]);
      setSw(swData);
      setTl(tlData);
      setLastUpdated(new Date().toUTCString().slice(0, 25));
    } catch {
      // The cards keep their empty state if the API is temporarily offline.
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kpColor = sw?.kp_color ?? "#168bd2";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <h1 className="page-title">Space Weather Operations Dashboard</h1>
          <p className="page-subtitle">Real-time monitoring of solar, geomagnetic, ionospheric, and Zimbabwe CORS network conditions.</p>
        </div>
        <button
          className="btn"
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

      {lastUpdated && <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Updated {lastUpdated} UTC</p>}

      <div className="dashboard-metric-grid">
        <MetricCard label="Kp Index" value={sw?.kp?.toFixed(1) ?? null} sub="Planetary activity" color={kpColor} variant="ok" />
        <MetricCard label="Geomagnetic" value={sw?.kp_condition ?? null} sub="Current state" color={kpColor} />
        <MetricCard label="Dst Index" value={sw?.dst !== null && sw?.dst !== undefined ? `${sw.dst} nT` : null} sub="Storm index" />
        <MetricCard label="Solar Flux" value={sw?.f107 ?? null} unit="sfu" sub="F10.7 index" />
        <MetricCard label="Plasma Speed" value={sw?.plasma_speed ?? null} unit="km/s" sub="Solar wind" />
        <MetricCard label="S4 Scintillation" value={sw?.s4 ?? null} sub="Signal quality" />
        <MetricCard
          label="GNSS Risk"
          value={sw?.gnss_risk ?? null}
          color={sw?.gnss_risk_color ?? undefined}
          sub="Impact level"
          variant={sw?.gnss_risk === "High" ? "alert" : sw?.gnss_risk === "Moderate" ? "warn" : "ok"}
        />
        <MetricCard
          label="CORS Network"
          value={sw?.stations_online !== null && sw?.stations_total ? `${sw.stations_online}/${sw.stations_total}` : null}
          sub="Online stations"
          variant="accent"
        />
      </div>

      <ScaleReference />

      {tl && tl.kp.length > 0 && (
        <div className="card operations-chart-card">
          <div className="operations-chart-title">7-Day Index Timelines</div>
          <LineChart
            labels={timelineLabels(tl.kp)}
            datasets={[
              { label: "Kp", data: timelineValues(tl.kp), color: "#168bd2" },
              { label: "Dst (nT)", data: timelineValues(tl.dst), color: "#ff8c00" },
            ]}
            yLabel="Index value"
            height={260}
          />
        </div>
      )}

      <section className="operations-timelines">
        <TimelinePanel
          title="Live NOAA F10.7 Solar Flux Timeline"
          points={tl?.f107 ?? []}
          color="#168bd2"
          yLabel="F10.7 (sfu)"
          source="Source: NOAA SWPC F10.7 cm flux feed."
          empty="Live NOAA F10.7 solar flux feed is unavailable."
        />
        <TimelinePanel
          title="Live NOAA Solar Wind Timeline"
          points={tl?.solar_wind ?? []}
          color="#168bd2"
          yLabel="Speed (km/s)"
          source="Source: NOAA SWPC solar-wind plasma feed."
          empty="Live NOAA solar-wind plasma feed is unavailable."
        />
        <TimelinePanel
          title="Live Scintillation S4 Timeline"
          points={tl?.s4 ?? []}
          color="#168bd2"
          yLabel="S4 Index"
          source="Source: ZINGSA CORS ionosphere archive current observed snapshot."
          empty="Live scintillation S4 telemetry is unavailable."
        />
        <TimelinePanel
          title="Live GNSS Risk Timeline"
          points={tl?.gnss_risk ?? []}
          color="#168bd2"
          yLabel="Risk Level"
          source="Source: Derived from NOAA Kp feed using ZINGSA GNSS risk thresholds."
          empty="Live GNSS risk timeline is unavailable."
        />
        <TimelinePanel
          title="Live CORS Stations Online Timeline"
          points={tl?.stations_online ?? []}
          color="#00ff88"
          yLabel="Stations Online"
          source="Source: Live ZINGSA CORS telemetry station-count feed."
          empty="Live CORS telemetry is unavailable - no station count timeline."
        />
      </section>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading live data...</p>}
    </div>
  );
}
