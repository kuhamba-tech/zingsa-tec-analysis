"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import GicGauge from "./GicGauge";
import { getEkfAlertLog, getGicLiveModel, getGicSeries, getSpaceWeather } from "@/lib/api";
import { peekSpaceWeather } from "@/lib/spaceWeatherStore";
import type {
  EkfAlert,
  GicLiveModel,
  GicNetwork,
  GicSeriesResponse,
  GicStationStatus,
  SpaceWeatherCurrent,
} from "@/lib/types";

type ChartMeta = ({ error?: number | null; confidence?: number | null } | null)[];

interface ChartDataset {
  label: string;
  data: (number | null)[];
  color: string;
  dashed?: boolean;
  meta?: ChartMeta;
}

const SEVERITY_COLOR: Record<string, string> = {
  Low: "#00ff88",
  Moderate: "#ffcc00",
  High: "#ff7a00",
  Severe: "#ff2e2e",
};

interface Props {
  stationId: string;
  stationStatus: GicStationStatus | null;
  network: GicNetwork | null;
  /** When set, parent owns the 24 h series fetch (avoids duplicate polling). */
  series?: GicSeriesResponse | null;
}

/** Live operations dashboard for one GIC station (station overview, real-time
 *  chart/gauge, space-weather summary, risk assessment, latest readings and
 *  recent alerts). Everything is computed from real ingested data — panels
 *  show N/A until field measurements arrive. */
export default function GicLiveDashboard({ stationId, stationStatus, network, series: externalSeries }: Props) {
  const [internalSeries, setInternalSeries] = useState<GicSeriesResponse | null>(null);
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(() => peekSpaceWeather());
  const [alerts, setAlerts] = useState<EkfAlert[]>([]);
  const [liveModel, setLiveModel] = useState<GicLiveModel | null>(null);

  const series = externalSeries !== undefined ? externalSeries : internalSeries;
  const parentOwnsSeries = externalSeries !== undefined;

  const load = useCallback(async () => {
    const tasks: Promise<void>[] = [
      getSpaceWeather().then(setSw).catch(() => undefined),
      getEkfAlertLog(24).then(setAlerts).catch(() => setAlerts([])),
      getGicLiveModel(24).then(setLiveModel).catch(() => setLiveModel(null)),
    ];
    if (!parentOwnsSeries && stationId) {
      tasks.push(
        getGicSeries(stationId, 24)
          .then(setInternalSeries)
          .catch(() => setInternalSeries(null)),
      );
    }
    await Promise.all(tasks);
  }, [stationId, parentOwnsSeries]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const substation = useMemo(() => {
    if (!network || !stationStatus?.substation) return null;
    return network.substations.find((s) => s.code === stationStatus.substation) ?? null;
  }, [network, stationStatus]);

  const observedPoints = useMemo(
    () => (series?.points ?? []).filter((p) => p.observed != null),
    [series],
  );

  const latest = observedPoints.length > 0 ? observedPoints[observedPoints.length - 1] : null;
  const latestAbs = latest?.observed != null ? Math.abs(latest.observed) : null;

  const hasEkf = useMemo(
    () => false,
    [series],
  );

  const chart = useMemo(() => {
    if (!series || series.points.length === 0) return null;
    return {
      labels: series.points.map((p) => p.t.replace("T", " ").slice(11, 16)),
      observed: series.points.map((p) => p.observed),
      predicted: series.points.map((p) => p.predicted),
      meta: series.points.map((p) =>
        p.error != null || p.confidence != null ? { error: p.error, confidence: p.confidence } : null,
      ),
    };
  }, [series]);

  const effectiveAbs = latestAbs;
  const currentBands = series?.monitoring_bands ?? network?.risk_bands ?? [];
  const gaugeMax = Math.max(50, ...currentBands.map(b => b.min_abs_a), latestAbs ?? 0);
  const currentCategory = latestAbs == null ? "No field observation" : [...currentBands].reverse().find(b => latestAbs >= b.min_abs_a)?.level ?? "Unclassified";


  const gicAlerts = useMemo(() => {
    const fromSeries = (series?.alerts ?? []).filter((a) => a.parameter === "gic");
    if (fromSeries.length > 0) return fromSeries;
    return alerts.filter((a) => a.parameter === "gic");
  }, [series, alerts]);

  const latestRows = useMemo(() => observedPoints.slice(-5).reverse(), [observedPoints]);

  const lastUpdate = latest ? latest.t.replace("T", " ").slice(0, 19) + " UTC" : null;

  const chartDatasets = useMemo(() => {
    if (!chart) return [];
    const ds: ChartDataset[] = [
      { label: "Measured GIC (A)", data: chart.observed, color: "#00ff88" },
    ];
    return ds;
  }, [chart, hasEkf]);

  const cellHead: React.CSSProperties = {
    fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "var(--accent)", marginBottom: "0.5rem",
  };
  const kvRow: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", gap: "0.6rem",
    fontSize: "0.78rem", padding: "0.18rem 0",
  };
  const kvKey: React.CSSProperties = { color: "var(--text-muted)" };

  return (
    <div className="card card-accent">
      <div className="operations-chart-title">Live Station Dashboard — {stationId || "N/A"}</div>

      <div className="gic-dash-row1" style={{ marginTop: "0.6rem", alignItems: "stretch" }}>
        <div className="card" style={{ margin: 0 }}>
          <div style={cellHead}>Station Overview</div>
          <div style={kvRow}><span style={kvKey}>Station ID</span><b>{stationId || "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Location</span><b>{stationStatus?.name ?? "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Latitude</span><b>{substation ? substation.lat.toFixed(4) : "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Longitude</span><b>{substation ? substation.lon.toFixed(4) : "N/A"}</b></div>
          <div style={kvRow}>
            <span style={kvKey}>Status</span>
            <b style={{ color: stationStatus?.reporting ? "#00ff88" : "#ff8c00" }}>
              {stationStatus?.reporting ? "● Reporting" : "● No data"}
            </b>
          </div>
          <div style={kvRow}><span style={kvKey}>Last Update</span><b>{lastUpdate ?? "—"}</b></div>
        </div>

        <div className="card gic-dash-chart" style={{ margin: 0 }}>
          <div style={cellHead}>Real-Time GIC Current (Amperes) — last 24 h</div>
          {chart ? (
            <>
              <LineChart
                labels={chart.labels}
                datasets={chartDatasets}
                yLabel="Amps (A)"
                height={190}
                thresholds={(series?.monitoring_bands ?? []).flatMap(b => b.min_abs_a > 0 ? [{ value: b.min_abs_a, label: `${b.level} category`, color: b.color }, { value: -b.min_abs_a, label: `Negative ${b.level}`, color: b.color }] : [])}
              />
              {hasEkf && (
                <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
                  Solid: measured transformer-neutral current. Dashed: EKF one-step-ahead prediction.
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              No measurements in the last 24 h and the live magnetometer feed is unreachable
              {liveModel?.reason ? ` (${liveModel.reason})` : ""} — nothing is simulated.
            </p>
          )}
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div style={cellHead}>Space Weather Summary</div>
          <p style={{fontSize:".7rem"}}>Legacy model: {liveModel?.reason ?? "Research only; local validation required"}</p>
          <div style={kvRow}><span style={kvKey}>Kp Index</span><b>{sw?.kp ?? "N/A"}{sw?.kp_condition ? ` (${sw.kp_condition})` : ""}</b></div>
          <div style={kvRow}><span style={kvKey}>Dst Index</span><b>{sw?.dst != null ? `${sw.dst} nT` : "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Solar Wind Speed</span><b>{sw?.plasma_speed != null ? `${sw.plasma_speed} km/s` : "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Solar Flux F10.7</span><b>{sw?.f107 ?? "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Scintillation S4</span><b>{sw?.s4 ?? "N/A"}</b></div>
          <div style={kvRow}><span style={kvKey}>Last Update</span><b>{sw?.updated_utc ? sw.updated_utc.replace("T", " ").slice(0, 16) : "—"}</b></div>
        </div>
      </div>

      <div className="grid-4" style={{ marginTop: "0.8rem", alignItems: "stretch" }}>
        <div className="card" style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ ...cellHead, alignSelf: "flex-start" }}>Real-Time GIC Current</div>
          <GicGauge
            value={effectiveAbs}
            min={0}
            max={gaugeMax}
            segments={currentBands.map((band, i) => ({ from: band.min_abs_a / gaugeMax, to: (currentBands[i+1]?.min_abs_a ?? gaugeMax) / gaugeMax, color: band.color }))}
            valueText={effectiveAbs != null ? `${effectiveAbs.toFixed(1)} A` : "N/A"}
            label={`${currentCategory} / monitoring category`}
          />
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div style={cellHead}>Latest Readings</div>
          {latestRows.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.3rem" }}>Time (UTC)</th>
                  <th style={{ textAlign: "right", padding: "0.25rem 0.3rem" }}>GIC (A)</th>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.3rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {latestRows.map((p) => {
                  const a = Math.abs(p.observed ?? 0);
                  const color = a >= 25 ? "#ff2e2e" : a >= 10 ? "#ff8c00" : "#00ff88";
                  return (
                    <tr key={p.t} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                      <td style={{ padding: "0.25rem 0.3rem" }}>{p.t.replace("T", " ").slice(5, 16)}</td>
                      <td style={{ padding: "0.25rem 0.3rem", textAlign: "right", fontWeight: 700 }}>{p.observed?.toFixed(2)}</td>
                      <td style={{ padding: "0.25rem 0.3rem", color, fontWeight: 700 }}>
                        {a >= 25 ? "High" : a >= 10 ? "Large" : "OK"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>No readings stored yet.</p>
          )}
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div style={cellHead}>GIC Current (24 hours)</div>
          {chart ? (
            <LineChart
              labels={chart.labels}
              datasets={[
                { label: "Signed GIC (A)", data: chart.observed, color: "#34d399", fill: true },
                ...(hasEkf
                  ? [{ label: "EKF Predicted (A)", data: chart.predicted, color: "#ff8c00", dashed: true }]
                  : []),
              ]}
              yLabel="Amps (A)"
              height={170}
              thresholds={(series?.monitoring_bands ?? []).flatMap(b => b.min_abs_a > 0 ? [{ value: b.min_abs_a, label: `${b.level} category`, color: b.color }, { value: -b.min_abs_a, label: `Negative ${b.level}`, color: b.color }] : [])}
            />
          ) : (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Awaiting field data.</p>
          )}
        </div>

        <div className="card" style={{ margin: 0, display: "flex", flexDirection: "column" }}>
          <div style={cellHead}>Engineering Risk &amp; Historical Residuals</div>
          <p style={{ fontSize: ".8rem", lineHeight: 1.7 }}>Transformer damage probability is not assessed. Site-specific transformer design, grounding, operating state, duration and diagnostics are required. Prediction warnings are disabled.</p>
          <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.4rem" }}>
            {gicAlerts.length > 0 ? (
              gicAlerts.slice(0, 4).map((a) => (
                <div key={a.alert_id} style={{ display: "flex", gap: "0.4rem", fontSize: "0.72rem", padding: "0.15rem 0", alignItems: "baseline" }}>
                  <span style={{ color: SEVERITY_COLOR[a.severity] ?? "var(--text)" }}>⚠</span>
                  <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{a.timestamp.slice(11, 16)}</span>
                  <span>{a.parameter_label} deviation ({a.severity})</span>
                </div>
              ))
            ) : (
              <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", margin: 0 }}>
                No historical GIC residual records in the last 24 h; prediction warnings disabled.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
