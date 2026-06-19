"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getAnomalies,
  getDiurnal,
  getSeasonal,
  getSolarCycle,
  getStatisticalForecast,
} from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import BarChart from "@/components/charts/BarChart";
import type {
  AnomalyDay,
  DiurnalPoint,
  ForecastPoint,
  SeasonalRow,
  SolarCycleRow,
} from "@/lib/types";

const TABS = [
  "Anomaly Detection",
  "Storm Comparison",
  "Diurnal Variation",
  "Seasonal Variation",
  "Solar Cycle",
  "EIA Study",
  "TEC Prediction",
];

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

export default function AnomalyDetectionPage() {
  const [tab, setTab] = useState(0);
  const [anomalies, setAnomalies] = useState<AnomalyDay[]>([]);
  const [diurnal, setDiurnal] = useState<DiurnalPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [solar, setSolar] = useState<SolarCycleRow[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [pct, setPct] = useState(95);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getAnomalies(pct), getDiurnal(), getSeasonal(), getSolarCycle(), getStatisticalForecast(30)])
      .then(([a, d, s, sc, f]) => {
        setAnomalies(a);
        setDiurnal(d);
        setSeasonal(s);
        setSolar(sc);
        setForecast(f);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : "Could not load anomaly data"))
      .finally(() => setLoading(false));
  }, [pct]);

  const anomalyDays = useMemo(() => anomalies.filter((a) => a.anomaly), [anomalies]);
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

  return (
    <div className="anomaly-page">
      <div>
        <h1 className="page-title">TEC Anomaly Detection</h1>
        <p className="page-subtitle">
          Storm analysis, diurnal and seasonal variation, solar-cycle context, EIA study, and TEC prediction.
        </p>
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
          <div className="metric-label">Threshold</div>
          <div className="metric-value">{fmt(threshold)}</div>
          <p className="small-note">TECU cutoff for anomaly flagging</p>
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
              <span className="small-note">Top 20 by VTEC intensity</span>
            </div>
            <div className="table-scroll">
              <table className="dark-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mean VTEC</th>
                    <th>Threshold</th>
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
                        <td>{day.date}</td>
                        <td>{fmt(day.mean_vtec)} TECU</td>
                        <td>{fmt(day.threshold)} TECU</td>
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
        <section className="anomaly-two-col">
          <div className="card">
            <div className="metric-label">Storm comparison proxy</div>
            <p className="body-copy">
              The converted backend does not yet expose a day-by-day Kp storm endpoint, so this panel compares quiet
              archive days against high-VTEC anomaly days. This avoids showing false storm values while still showing
              which days need geomagnetic cross-checking.
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
                <span className="small-note">Highest VTEC</span>
                <strong>{fmt(maxDay?.mean_vtec)} TECU</strong>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="metric-label">Days to inspect against Kp storm records</div>
            <div className="table-scroll compact">
              <table className="dark-table">
                <thead><tr><th>Date</th><th>Mean VTEC</th></tr></thead>
                <tbody>
                  {anomalyDays.slice(0, 12).map((day) => (
                    <tr key={day.date}><td>{day.date}</td><td>{fmt(day.mean_vtec)} TECU</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === 2 && (
        <div className="card">
          <div className="metric-label">24-hour VTEC variation, UTC</div>
          <p className="small-note">Zimbabwe local time is UTC + 2h. Peak hour: {peakHour ? `${peakHour.hour}:00 UTC` : "N/A"}.</p>
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
              solar-cycle forcing can increase TEC gradients. Use this view to connect anomaly days with diurnal peaks,
              seasonal maxima, and solar-cycle years.
            </p>
          </div>
          <div className="card">
            <div className="metric-label">Current EIA indicators from archive</div>
            <div className="comparison-grid">
              <div><span className="small-note">Peak UTC hour</span><strong>{peakHour ? `${peakHour.hour}:00` : "N/A"}</strong></div>
              <div><span className="small-note">Peak season</span><strong>{highSeason?.season ?? "N/A"}</strong></div>
              <div><span className="small-note">Peak archive day</span><strong>{maxDay?.date ?? "N/A"}</strong></div>
            </div>
          </div>
        </section>
      )}

      {tab === 6 && (
        <div className="card">
          <div className="metric-label">30-day TEC forecast, Fourier plus linear trend model</div>
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
    </div>
  );
}
