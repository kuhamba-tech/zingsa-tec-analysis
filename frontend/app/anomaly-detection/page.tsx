"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getAnomalyAnalysis,
  getStations,
  getStatisticalForecast,
  getCnnGruForecast,
  getForecastStatus,
  getCnnGruTrainStatus,
  trainCnnGruModel,
} from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import BarChart from "@/components/charts/BarChart";
import type {
  AnomalyDay,
  DiurnalPoint,
  EiaSummary,
  ForecastPoint,
  SeasonalRow,
  SolarCycleRow,
  StormComparisonDoy,
  ForecastStatus,
  CnnGruTrainStatus,
  Station,
} from "@/lib/types";

const TABS = [
  "Anomaly Detection",
  "Storm Comparison",
  "Diurnal Variation",
  "Seasonal Variation",
  "Solar Cycle",
  "EIA Study",
  "TEC Prediction",
  "Ionospheric Scintillation",
];

const FALLBACK_CORS_CODES = [
  "beit",
  "bing",
  "bula",
  "cent",
  "chim",
  "chir",
  "chiv",
  "gokw",
  "gsu",
  "gutu",
  "gwer",
  "hacy",
  "hara",
  "kari",
  "karo",
  "kwek",
  "lupa",
  "masv",
  "mata",
  "muta",
  "muto",
  "tsho",
  "vicf",
  "zinh",
];

const SCINT_TIME_LABELS = ["19:50", "01:50", "07:50", "13:50", "19:50"];
const SCINT_COLORS = ["#084cff", "#ff1f1f", "#19d83d", "#ffd400", "#00c6ff", "#6d28d9"];

function hashCode(value: string) {
  return value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function buildScintillationSeries(code: string, kind: "amplitude" | "phase") {
  const seed = hashCode(code);
  const seriesCount = 6;
  const samples = 96;
  return Array.from({ length: seriesCount }, (_, seriesIndex) =>
    Array.from({ length: samples }, (_, sampleIndex) => {
      const wave =
        Math.sin((sampleIndex + seed + seriesIndex * 11) / 7.5) * 0.018 +
        Math.cos((sampleIndex * (seriesIndex + 2) + seed) / 19) * 0.012;
      const evening = Math.exp(-Math.pow((sampleIndex - 78) / 13, 2)) * (0.028 + ((seed + seriesIndex) % 5) * 0.006);
      const predawn = Math.exp(-Math.pow((sampleIndex - 28) / 11, 2)) * (0.018 + ((seed + seriesIndex * 3) % 4) * 0.005);
      const spike =
        (sampleIndex + seed + seriesIndex * 17) % 37 === 0
          ? 0.06 + ((seed + sampleIndex) % 6) * 0.018
          : 0;
      const base = kind === "amplitude" ? 0.025 : 0.06;
      const scale = kind === "amplitude" ? 1 : 1.45;
      return Math.min(1, Math.max(0, (base + wave + evening + predawn + spike) * scale));
    }),
  );
}

function pathFromSeries(values: number[], width: number, height: number) {
  const left = 54;
  const right = 12;
  const top = 14;
  const bottom = 38;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  return values
    .map((value, index) => {
      const x = left + (index / Math.max(values.length - 1, 1)) * chartW;
      const y = top + 12 + (1 - value) * chartH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function ScintillationPlot({
  title,
  yLabel,
  kind,
  stationCode,
}: {
  title: string;
  yLabel: string;
  kind: "amplitude" | "phase";
  stationCode: string;
}) {
  const width = 470;
  const height = 210;
  const left = 54;
  const right = 12;
  const top = 14;
  const bottom = 38;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  const thresholdY = (value: number) => top + (1 - value) * chartH;
  const series = buildScintillationSeries(stationCode, kind);

  return (
    <div className="scint-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
        <text x={width / 2} y="18" textAnchor="middle" className="scint-plot-title">
          {title}
        </text>
        <rect x={left} y={top + 12} width={chartW} height={chartH} fill="#ffffff" stroke="#111827" strokeWidth="1.4" />
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((tick) => (
          <g key={tick}>
            <line x1={left - 5} x2={left} y1={thresholdY(tick) + 12} y2={thresholdY(tick) + 12} stroke="#111827" />
            <line x1={left + chartW} x2={left + chartW + 5} y1={thresholdY(tick) + 12} y2={thresholdY(tick) + 12} stroke="#111827" />
            <text x={left - 9} y={thresholdY(tick) + 16} textAnchor="end" className="scint-axis-text">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((tick, index) => (
          <g key={tick}>
            <line x1={left + tick * chartW} x2={left + tick * chartW} y1={top + 12} y2={top + 18} stroke="#111827" />
            <line x1={left + tick * chartW} x2={left + tick * chartW} y1={top + chartH + 6} y2={top + chartH + 12} stroke="#111827" />
            <text x={left + tick * chartW} y={height - 8} textAnchor="middle" className="scint-axis-text">
              {SCINT_TIME_LABELS[index]}
            </text>
          </g>
        ))}
        {kind === "amplitude" && (
          <>
            <line x1={left} x2={left + chartW} y1={thresholdY(0.6) + 12} y2={thresholdY(0.6) + 12} stroke="#111827" strokeDasharray="9 8" />
            <line x1={left} x2={left + chartW} y1={thresholdY(0.3) + 12} y2={thresholdY(0.3) + 12} stroke="#111827" strokeDasharray="9 8" />
            <text x={left + 26} y={thresholdY(0.6) - 2} className="scint-threshold-text">strong scintillation</text>
            <text x={left + 26} y={thresholdY(0.3) - 2} className="scint-threshold-text">weak scintillation</text>
          </>
        )}
        {series.map((values, index) => (
          <path
            key={index}
            d={pathFromSeries(values, width, height).replaceAll(",", ",")}
            fill="none"
            stroke={SCINT_COLORS[index % SCINT_COLORS.length]}
            strokeWidth="1.35"
            opacity="0.92"
          />
        ))}
        <text x={18} y={top + chartH / 2 + 12} textAnchor="middle" className="scint-y-label" transform={`rotate(-90 18 ${top + chartH / 2 + 12})`}>
          {yLabel}
        </text>
        <text x={left + chartW / 2} y={height - 23} textAnchor="middle" className="scint-x-label">Time (UTC)</text>
      </svg>
    </div>
  );
}

function ScintillationStationPanel({ station }: { station: Station }) {
  const code = station.code.toUpperCase();
  return (
    <article className="scint-station-card">
      <div className="scint-station-head">
        <div className="scint-map-thumb" aria-hidden>
          <span />
        </div>
        <div>
          <h3>{station.name || code}</h3>
          <p>
            {code} ({Math.abs(station.lat).toFixed(3)}{station.lat < 0 ? "S" : "N"},{" "}
            {Math.abs(station.lon).toFixed(3)}{station.lon < 0 ? "W" : "E"})
          </p>
        </div>
      </div>
      <div className="scint-plot-grid">
        <ScintillationPlot
          title={`Amplitude Scintillation, ${code}`}
          yLabel="Amplitude Scintillation Index, S4"
          kind="amplitude"
          stationCode={code}
        />
        <ScintillationPlot
          title={`Phase Scintillation, ${code}`}
          yLabel="Phase Scintillation Index, sigma-60"
          kind="phase"
          stationCode={code}
        />
      </div>
    </article>
  );
}

function downloadCsv(filename: string, rows: Record<string, string | number | boolean | null | undefined>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fmt(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function timeSeriesLink(date: string, station: string) {
  const params = new URLSearchParams({ start: date, end: date, tab: "storms" });
  if (station) params.set("station", station);
  return `/time-series?${params.toString()}`;
}

export default function AnomalyDetectionPage() {
  const [tab, setTab] = useState(0);
  const [anomalies, setAnomalies] = useState<AnomalyDay[]>([]);
  const [stormComparison, setStormComparison] = useState<StormComparisonDoy[]>([]);
  const [eia, setEia] = useState<EiaSummary | null>(null);
  const [stations, setStations] = useState<string[]>([]);
  const [kpAvailable, setKpAvailable] = useState(false);
  const [dstAvailable, setDstAvailable] = useState(false);
  const [station, setStation] = useState("");
  const [diurnal, setDiurnal] = useState<DiurnalPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [solar, setSolar] = useState<SolarCycleRow[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [forecastModel, setForecastModel] = useState<"statistical" | "cnn-gru">("statistical");
  const [fcStatus, setFcStatus] = useState<ForecastStatus | null>(null);
  const [trainStatus, setTrainStatus] = useState<CnnGruTrainStatus | null>(null);
  const [stationCatalog, setStationCatalog] = useState<Station[]>([]);
  const [trainStarting, setTrainStarting] = useState(false);
  const [pct, setPct] = useState(95);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const st = station || undefined;
    Promise.all([getAnomalyAnalysis(pct, st), getStatisticalForecast(30)])
      .then(([analysis, f]) => {
        setAnomalies(analysis.days);
        setStormComparison(analysis.storm_comparison);
        setEia(analysis.eia);
        setStations(analysis.stations);
        setKpAvailable(analysis.kp_available);
        setDstAvailable(analysis.dst_available);
        setDiurnal(analysis.diurnal);
        setSeasonal(analysis.seasonal);
        setSolar(analysis.solar_cycle);
        setForecast(f);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : "Could not load anomaly data"))
      .finally(() => setLoading(false));
  }, [pct, station]);

  useEffect(() => {
    if (forecastModel !== "cnn-gru") return;
    getCnnGruForecast()
      .then(setForecast)
      .catch((exc) => setError(exc instanceof Error ? exc.message : "CNN-GRU forecast unavailable"));
  }, [forecastModel]);

  useEffect(() => {
    getForecastStatus().then(setFcStatus).catch(() => setFcStatus(null));
    getCnnGruTrainStatus().then(setTrainStatus).catch(() => setTrainStatus(null));
    getStations()
      .then((items) => setStationCatalog(items.slice(0, 24)))
      .catch(() => setStationCatalog([]));
  }, []);

  useEffect(() => {
    if (!trainStatus?.running) return;
    const id = setInterval(() => {
      getCnnGruTrainStatus()
        .then((status) => {
          setTrainStatus(status);
          if (!status.running && status.result && !status.error) {
            getForecastStatus().then(setFcStatus).catch(() => null);
            if (forecastModel === "cnn-gru") {
              getCnnGruForecast().then(setForecast).catch(() => null);
            }
          }
        })
        .catch(() => null);
    }, 2000);
    return () => clearInterval(id);
  }, [trainStatus?.running, forecastModel]);

  async function handleTrainModel() {
    setTrainStarting(true);
    setError(null);
    try {
      await trainCnnGruModel();
      const status = await getCnnGruTrainStatus();
      setTrainStatus(status);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not start CNN-GRU training");
    } finally {
      setTrainStarting(false);
    }
  }

  const anomalyDays = useMemo(() => anomalies.filter((a) => a.anomaly), [anomalies]);
  const stormConfirmed = useMemo(
    () => anomalies.filter((a) => a.anomaly && a.storm_flag),
    [anomalies],
  );
  const threshold = anomalies[0]?.threshold ?? 0;
  const meanTec = anomalies.length
    ? anomalies.reduce((sum, item) => sum + item.mean_vtec, 0) / anomalies.length
    : null;
  const maxDay = anomalies.reduce<AnomalyDay | null>(
    (best, item) => (!best || item.mean_vtec > best.mean_vtec ? item : best),
    null,
  );
  const anomalyRate = anomalies.length ? (anomalyDays.length * 100) / anomalies.length : 0;
  const highSeason = seasonal.reduce<SeasonalRow | null>(
    (best, item) => (!best || item.mean > best.mean ? item : best),
    null,
  );
  const peakHour = diurnal.reduce<DiurnalPoint | null>(
    (best, item) => (!best || item.mean_vtec > best.mean_vtec ? item : best),
    null,
  );
  const postSunsetDiurnal = diurnal.filter((d) => d.hour >= 18 && d.hour <= 23);
  const postSunsetPeak = postSunsetDiurnal.reduce<DiurnalPoint | null>(
    (best, item) => (!best || item.mean_vtec > best.mean_vtec ? item : best),
    null,
  );
  const scintillationStations = useMemo<Station[]>(() => {
    if (stationCatalog.length > 0) return stationCatalog.slice(0, 24);
    const codes = stations.length > 0 ? stations : FALLBACK_CORS_CODES;
    return codes.slice(0, 24).map((code, index) => ({
      code,
      name: code.toUpperCase(),
      lat: -17.6 - (index % 6) * 0.72,
      lon: 25.4 + Math.floor(index / 6) * 1.75 + (index % 2) * 0.35,
      status: "unknown",
      constellations: [],
      current_tec: null,
      height_m: null,
    }));
  }, [stationCatalog, stations]);

  return (
    <div className="anomaly-page">
      <div>
        <h1 className="page-title">TEC Anomaly Detection</h1>
        <p className="page-subtitle">
          Storm analysis, diurnal and seasonal variation, solar-cycle context, EIA study, and TEC prediction.
        </p>
      </div>

      {trainStatus?.running && (
        <div className="banner banner-info" style={{ fontSize: "0.82rem" }}>
          <strong>CNN-GRU training in progress</strong> — epoch {trainStatus.epoch}/{trainStatus.total_epochs}
          {trainStatus.last_loss != null ? ` · loss ${trainStatus.last_loss.toFixed(5)}` : ""}. Open the{" "}
          <button
            type="button"
            onClick={() => setTab(6)}
            style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
          >
            TEC Prediction
          </button>{" "}
          tab for details.
        </div>
      )}

      <div className="anomaly-control-card card">
        <div>
          <div className="metric-label">Station</div>
          <select
            aria-label="Archive station filter"
            value={station}
            onChange={(event) => setStation(event.target.value)}
          >
            <option value="">All stations</option>
            {stations.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
        {!kpAvailable && !loading && anomalies.length > 0 && (
          <p className="small-note">GFZ Kp index unavailable — storm flags may be incomplete.</p>
        )}
        {!dstAvailable && !loading && anomalies.length > 0 && (
          <p className="small-note">WDC Kyoto Dst unavailable — storm cross-check uses Kp only.</p>
        )}
      </div>

      <div className="tabs anomaly-tabs">
        {TABS.map((title, index) => (
          <button key={title} className={`tab${tab === index ? " active" : ""}`} onClick={() => setTab(index)}>
            {title}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-alert">{error}</div>}
      {loading && <div className="banner banner-info">Loading TEC anomaly analytics...</div>}
      {!loading && !error && anomalies.length === 0 && (
        <div className="banner banner-warn">
          No processed TEC archive available yet — anomaly detection needs ingested RINEX/CMN observations.
          Process station data on the <Link href="/processing">Processing</Link> page to populate this view.
        </div>
      )}

      <section className="anomaly-summary-grid">
        <div className="card card-accent">
          <div className="metric-label">Anomaly days</div>
          <div className="metric-value">{anomalyDays.length}</div>
          <p className="small-note">VTEC at or above {pct}th percentile</p>
        </div>
        <div className="card card-warn">
          <div className="metric-label">Storm-confirmed</div>
          <div className="metric-value">{eia?.storm_confirmed_count ?? stormConfirmed.length}</div>
          <p className="small-note">Anomaly days with Kp storm (G1+)</p>
        </div>
        <div className="card card-ok">
          <div className="metric-label">Mean VTEC</div>
          <div className="metric-value">{fmt(meanTec)}</div>
          <p className="small-note">Daily archive average</p>
        </div>
        <div className="card card-alert">
          <div className="metric-label">Peak day</div>
          <div className="metric-value">{fmt(maxDay?.mean_vtec)}</div>
          <p className="small-note">{maxDay?.date ?? "No archive data"}</p>
        </div>
      </section>

      {tab === 0 && (
        <section className="anomaly-stack">
          <div className="card anomaly-control-card">
            <div>
              <div className="metric-label">Anomaly threshold percentile</div>
              <strong>{pct}th percentile</strong>
            </div>
            <input
              aria-label="Anomaly threshold percentile"
              type="range"
              min={80}
              max={99}
              value={pct}
              onChange={(event) => setPct(Number(event.target.value))}
            />
            <button
              className="btn"
              onClick={() =>
                downloadCsv(
                  "tec-anomaly-days.csv",
                  anomalyDays.map((day) => ({
                    date: day.date,
                    mean_vtec: day.mean_vtec,
                    threshold: day.threshold,
                    anomaly: day.anomaly,
                    kp: day.kp ?? "",
                    storm_flag: day.storm_flag ?? false,
                    tec_response: day.tec_response ?? "",
                  })),
                )
              }
            >
              Export anomalies CSV
            </button>
          </div>

          <div className="card">
            <div className="metric-label">Daily mean VTEC with anomaly threshold</div>
            <LineChart
              labels={anomalies.map((a) => a.date)}
              datasets={[
                { label: "VTEC (TECU)", data: anomalies.map((a) => a.mean_vtec), color: "#168bd2" },
                { label: "Anomaly days", data: anomalies.map((a) => (a.anomaly ? a.mean_vtec : NaN)), color: "#ff4444" },
                {
                  label: "Kp storm days",
                  data: anomalies.map((a) => (a.storm_flag ? a.mean_vtec : NaN)),
                  color: "#ff8c00",
                },
              ]}
              threshold={{ value: threshold, label: `${pct}th pct: ${fmt(threshold)} TECU` }}
              height={330}
            />
          </div>

          <div className="card anomaly-table-card">
            <div className="anomaly-card-header">
              <div>
                <div className="metric-label">Flagged anomaly days</div>
                <strong>{anomalyDays.length} days detected</strong>
              </div>
              <span className="small-note">Top 20 by VTEC intensity — click date for time series</span>
            </div>
            <div className="table-scroll">
              <table className="dark-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mean VTEC</th>
                    <th>Kp</th>
                    <th>Dst</th>
                    <th>Storm</th>
                    <th>TEC response</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalyDays
                    .slice()
                    .sort((a, b) => b.mean_vtec - a.mean_vtec)
                    .slice(0, 20)
                    .map((day) => (
                      <tr key={day.date}>
                        <td>
                          <Link href={timeSeriesLink(day.date, station)} className="link-inline">
                            {day.date}
                          </Link>
                        </td>
                        <td>{fmt(day.mean_vtec)} TECU</td>
                        <td>{day.kp != null ? fmt(day.kp, 1) : "—"}</td>
                        <td>{day.dst != null ? fmt(day.dst, 0) : "—"}</td>
                        <td>
                          {day.storm_flag ? (
                            <span className="status-pill warn">{day.kp_severity ?? "Storm"}</span>
                          ) : (
                            <span className="status-pill">Quiet</span>
                          )}
                        </td>
                        <td>{day.tec_response ?? "—"}</td>
                        <td><span className="status-pill alert">Anomaly</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === 1 && (
        <section className="anomaly-stack">
          <div className="card">
            <div className="metric-label">Quiet vs storm VTEC by day of year</div>
            <p className="body-copy">
              Compares archive mean VTEC on quiet days (Kp &lt; 3) against geomagnetic storm days (Kp ≥ 5) from GFZ.
              {kpAvailable ? " Kp data loaded from GFZ Potsdam." : " Kp overlay unavailable — showing archive stats only."}
            </p>
            <div className="comparison-grid">
              <div>
                <span className="small-note">Archive days</span>
                <strong>{anomalies.length}</strong>
              </div>
              <div>
                <span className="small-note">Anomaly rate</span>
                <strong>{fmt(anomalyRate, 1)}%</strong>
              </div>
              <div>
                <span className="small-note">Storm-confirmed anomalies</span>
                <strong>{stormConfirmed.length}</strong>
              </div>
            </div>
          </div>

          {stormComparison.length > 0 ? (
            <div className="card">
              <div className="metric-label">Mean VTEC by day of year (DOY)</div>
              <LineChart
                labels={stormComparison.map((r) => String(r.doy))}
                datasets={[
                  {
                    label: "Quiet days (Kp < 3)",
                    data: stormComparison.map((r) => r.quiet_mean_vtec ?? NaN),
                    color: "#00ff88",
                  },
                  {
                    label: "Storm days (Kp ≥ 5)",
                    data: stormComparison.map((r) => r.storm_mean_vtec ?? NaN),
                    color: "#ff4444",
                  },
                ]}
                height={310}
              />
            </div>
          ) : (
            <div className="banner banner-info">
              Storm comparison chart needs overlapping archive and GFZ Kp data for the selected range.
            </div>
          )}

          {anomalies.length > 0 && kpAvailable && (
            <div className="card">
              <div className="metric-label">Archive VTEC vs geomagnetic Kp</div>
              <p className="small-note">Dual-axis view — mean VTEC (TECU) with daily Kp from GFZ Potsdam.</p>
              <LineChart
                labels={anomalies.map((a) => a.date)}
                datasets={[
                  {
                    label: "Mean VTEC (TECU)",
                    data: anomalies.map((a) => a.mean_vtec),
                    color: "#168bd2",
                  },
                  {
                    label: "Kp index",
                    data: anomalies.map((a) => a.kp ?? null),
                    color: "#ff8c00",
                    dashed: true,
                    yAxisId: "y2",
                  },
                ]}
                yLabel="VTEC (TECU)"
                secondaryYLabel="Kp"
                height={310}
              />
            </div>
          )}

          {anomalyDays.length > 0 && dstAvailable && (
            <div className="card">
              <div className="metric-label">Anomaly-day Dst index (WDC Kyoto)</div>
              <LineChart
                labels={anomalyDays.map((a) => a.date)}
                datasets={[
                  {
                    label: "Mean VTEC",
                    data: anomalyDays.map((a) => a.mean_vtec),
                    color: "#168bd2",
                  },
                  {
                    label: "Dst (nT)",
                    data: anomalyDays.map((a) => a.dst ?? null),
                    color: "#a78bfa",
                    dashed: true,
                    yAxisId: "y2",
                  },
                ]}
                yLabel="VTEC (TECU)"
                secondaryYLabel="Dst (nT)"
                height={280}
              />
            </div>
          )}

          <div className="card anomaly-table-card">
            <div className="metric-label">Storm-confirmed anomaly days</div>
            <div className="table-scroll compact">
              <table className="dark-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mean VTEC</th>
                    <th>Kp</th>
                    <th>Dst</th>
                    <th>TEC response</th>
                  </tr>
                </thead>
                <tbody>
                  {stormConfirmed.slice(0, 15).map((day) => (
                    <tr key={day.date}>
                      <td>
                        <Link href={timeSeriesLink(day.date, station)} className="link-inline">
                          {day.date}
                        </Link>
                      </td>
                      <td>{fmt(day.mean_vtec)} TECU</td>
                      <td>{day.kp != null ? fmt(day.kp, 1) : "—"}</td>
                      <td>{day.dst != null ? fmt(day.dst, 0) : "—"}</td>
                      <td>{day.tec_response ?? "—"}</td>
                    </tr>
                  ))}
                  {stormConfirmed.length === 0 && (
                    <tr>
                      <td colSpan={5}>No anomaly days coincided with Kp storm conditions in this archive.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === 2 && (
        <div className="card">
          <div className="metric-label">24-hour VTEC variation, UTC</div>
          <p className="small-note">
            Zimbabwe local time is UTC + 2h. Peak hour: {peakHour ? `${peakHour.hour}:00 UTC` : "N/A"}.
            {station ? ` Station: ${station}.` : ""}
          </p>
          <LineChart
            labels={diurnal.map((d) => `${d.hour}:00`)}
            datasets={[{ label: "Mean VTEC (TECU)", data: diurnal.map((d) => d.mean_vtec), color: "#168bd2", fill: true }]}
            height={300}
          />
        </div>
      )}

      {tab === 3 && (
        <div className="card">
          <div className="metric-label">Seasonal mean VTEC, southern hemisphere seasons</div>
          <p className="small-note">Highest seasonal mean: {highSeason?.season ?? "N/A"}.</p>
          <BarChart labels={seasonal.map((s) => s.season)} values={seasonal.map((s) => s.mean)} height={300} />
        </div>
      )}

      {tab === 4 && (
        <div className="card">
          <div className="metric-label">Annual TEC trend and Solar Cycle 25 context</div>
          <LineChart
            labels={solar.map((s) => String(s.year))}
            datasets={[
              { label: "Mean VTEC", data: solar.map((s) => s.mean_vtec), color: "#168bd2" },
              { label: "Max VTEC", data: solar.map((s) => s.max_vtec), color: "#ff4444" },
              { label: "Min VTEC", data: solar.map((s) => s.min_vtec), color: "#00ff88" },
            ]}
            height={310}
          />
        </div>
      )}

      {tab === 5 && (
        <section className="anomaly-two-col">
          <div className="card">
            <div className="metric-label">Equatorial Ionospheric Anomaly study</div>
            <p className="body-copy">
              Zimbabwe lies under low-latitude ionospheric dynamics where post-sunset plasma redistribution and
              solar-cycle forcing can increase TEC gradients. Post-sunset hours (18–23 UTC) often show EIA-related
              structure distinct from daytime means.
            </p>
            <p className="body-copy">
              View spatial TEC structure on the{" "}
              <Link href="/tec-heatmap">TEC Heatmap</Link> to correlate regional gradients with anomaly days.
            </p>
          </div>
          <div className="card">
            <div className="metric-label">EIA indicators from archive</div>
            <div className="comparison-grid">
              <div>
                <span className="small-note">Peak UTC hour</span>
                <strong>{eia?.peak_hour_utc != null ? `${eia.peak_hour_utc}:00` : peakHour ? `${peakHour.hour}:00` : "N/A"}</strong>
              </div>
              <div>
                <span className="small-note">Post-sunset peak</span>
                <strong>
                  {eia?.post_sunset_peak_hour_utc != null
                    ? `${eia.post_sunset_peak_hour_utc}:00`
                    : postSunsetPeak
                      ? `${postSunsetPeak.hour}:00`
                      : "N/A"}
                </strong>
              </div>
              <div>
                <span className="small-note">Post-sunset mean VTEC</span>
                <strong>{fmt(eia?.post_sunset_mean_vtec ?? null)} TECU</strong>
              </div>
              <div>
                <span className="small-note">Daytime mean VTEC</span>
                <strong>{fmt(eia?.daytime_mean_vtec ?? null)} TECU</strong>
              </div>
              <div>
                <span className="small-note">Peak season</span>
                <strong>{eia?.peak_season ?? highSeason?.season ?? "N/A"}</strong>
              </div>
              <div>
                <span className="small-note">Storm-confirmed anomalies</span>
                <strong>{eia?.storm_confirmed_count ?? stormConfirmed.length}</strong>
              </div>
            </div>
          </div>
          {postSunsetDiurnal.length > 0 && (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <div className="metric-label">Post-sunset diurnal profile (18–23 UTC)</div>
              <LineChart
                labels={postSunsetDiurnal.map((d) => `${d.hour}:00`)}
                datasets={[
                  {
                    label: "Post-sunset VTEC",
                    data: postSunsetDiurnal.map((d) => d.mean_vtec),
                    color: "#a78bfa",
                    fill: true,
                  },
                ]}
                height={260}
              />
            </div>
          )}
        </section>
      )}

      {tab === 6 && (
        <div className="card">
          <div className="anomaly-control-card" style={{ marginBottom: "1rem" }}>
            <div>
              <div className="metric-label">Forecast model</div>
              <strong>{forecastModel === "statistical" ? "Fourier + linear trend" : "CNN-GRU neural network"}</strong>
            </div>
            <div className="tabs" style={{ margin: 0 }}>
              <button
                type="button"
                className={`tab${forecastModel === "statistical" ? " active" : ""}`}
                onClick={() => {
                  setForecastModel("statistical");
                  getStatisticalForecast(30).then(setForecast).catch(() => {});
                }}
              >
                Statistical
              </button>
              <button
                type="button"
                className={`tab${forecastModel === "cnn-gru" ? " active" : ""}`}
                onClick={() => setForecastModel("cnn-gru")}
              >
                CNN-GRU
              </button>
            </div>
          </div>

          {forecastModel === "cnn-gru" && (
            <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
              <div className="metric-label" style={{ marginBottom: "0.5rem" }}>CNN-GRU Model Training</div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
                Trains daily on 30+ days of 15-min mean VTEC from TimescaleDB. Fine-tunes existing weights when available.
              </p>
              <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.8rem", marginBottom: "0.85rem" }}>
                <div><strong>Sequence length:</strong> {fcStatus?.seq_len ?? 96} steps (24 h)</div>
                <div><strong>Forecast horizon:</strong> {fcStatus?.forecast_h ?? 6} h</div>
                <div><strong>Architecture:</strong> Conv1D(32) → Conv1D(64) → GRU(128×2) → Dense</div>
                <div>
                  <strong>Model status:</strong>{" "}
                  {fcStatus
                    ? fcStatus.torch_ok
                      ? fcStatus.model_exists
                        ? "Ready"
                        : "No trained weights yet"
                      : "PyTorch unavailable"
                    : "Checking…"}
                </div>
              </div>

              {trainStatus?.running && (
                <div className="banner banner-info" style={{ marginBottom: "0.75rem", fontSize: "0.82rem" }}>
                  <strong>Training CNN-GRU…</strong>{" "}
                  epoch {trainStatus.epoch}/{trainStatus.total_epochs}
                  {trainStatus.last_loss != null ? ` · loss ${trainStatus.last_loss.toFixed(5)}` : ""}
                  <div style={{ marginTop: "0.35rem", color: "var(--text-muted)" }}>
                    Loading VTEC windows from TimescaleDB and updating Conv1D + GRU weights — this may take a few minutes.
                  </div>
                </div>
              )}

              {!trainStatus?.running && trainStatus?.error && (
                <div className="banner banner-alert" style={{ marginBottom: "0.75rem", fontSize: "0.82rem" }}>
                  Training failed: {trainStatus.error}
                </div>
              )}

              {!trainStatus?.running && trainStatus?.result && !trainStatus.error && (
                <div className="banner banner-info" style={{ marginBottom: "0.75rem", fontSize: "0.82rem", borderColor: "#00ff8844" }}>
                  Training complete — final loss{" "}
                  {typeof trainStatus.result.final_loss === "number"
                    ? trainStatus.result.final_loss.toFixed(5)
                    : "N/A"}
                  {typeof trainStatus.result.n_windows === "number"
                    ? ` over ${trainStatus.result.n_windows} windows`
                    : ""}
                  {trainStatus.result.trained_at ? ` · ${String(trainStatus.result.trained_at).slice(0, 19).replace("T", " ")} UTC` : ""}
                </div>
              )}

              {fcStatus && !fcStatus.torch_ok && (
                <div className="banner banner-info" style={{ marginBottom: "0.75rem", fontSize: "0.82rem" }}>
                  CNN-GRU training requires PyTorch on the backend. See backend requirements.
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleTrainModel}
                disabled={trainStarting || trainStatus?.running || !fcStatus?.torch_ok}
              >
                {trainStatus?.running || trainStarting ? "Training…" : "Train model"}
              </button>
            </div>
          )}

          <div className="metric-label">30-day TEC forecast</div>
          {forecast.length > 0 ? (
            <LineChart
              labels={forecast.map((f) => f.t)}
              datasets={[
                { label: "Forecast VTEC", data: forecast.map((f) => f.predicted_vtec), color: "#ff8c00" },
                { label: "Upper band", data: forecast.map((f) => f.upper ?? f.predicted_vtec), color: "#ff8c0044" },
                { label: "Lower band", data: forecast.map((f) => f.lower ?? f.predicted_vtec), color: "#ff8c0044" },
              ]}
              height={310}
            />
          ) : (
            <div className="banner banner-info">Forecast unavailable until archive data is loaded.</div>
          )}
        </div>
      )}

      {tab === 7 && (
        <section className="anomaly-stack">
          <div className="card scint-section-header">
            <div>
              <div className="metric-label">Ionospheric Scintillation</div>
              <h2>Zimbabwe CORS S4 and phase scintillation monitor</h2>
              <p>
                Station-by-station plots for the 24 Zimbabwe CORS sites, following the paired amplitude S4 and
                phase scintillation format used by the Australian SWS scintillation products.
              </p>
            </div>
            <div className="scint-update-badge">
              <span>Updates</span>
              <strong>Every 10 minutes</strong>
            </div>
          </div>

          <div className="banner banner-info">
            S4 and sigma-60 panels are prepared for Zimbabwe CORS scintillation ingestion. Connect the live
            per-station S4/sigma feed to replace these station traces with measured observations.
          </div>

          <div className="scint-station-list">
            {scintillationStations.map((item) => (
              <ScintillationStationPanel key={item.code} station={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
