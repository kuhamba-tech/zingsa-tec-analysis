"use client";

import LineChart from "@/components/charts/LineChart";
import GeomagneticConditionScale, { geomagneticConditionForKp } from "@/components/spaceWeather/GeomagneticConditionScale";
import type { GfzKpAnalysisResponse, GfzKpDailyPoint } from "@/lib/types";

interface Props {
  gfz: GfzKpAnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
}

function fmt(v: number | null | undefined, digits = 1, suffix = "") {
  if (v === null || v === undefined) return "N/A";
  return `${v.toFixed(digits)}${suffix}`;
}

function shortDateLabel(date: string): string {
  const parts = date.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return date.slice(5) || date;
}

function KpIndexBarChart({ rows }: { rows: GfzKpDailyPoint[] }) {
  const width = 980;
  const height = 310;
  const left = 74;
  const right = 36;
  const top = 28;
  const bottom = 58;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  const values = rows.map((row) => row.kp ?? 0);
  const maxValue = Math.max(9, ...values, 1);
  const yFor = (value: number) => top + chartH - (value / maxValue) * chartH;
  const barGap = 3;
  const barW = Math.max(3, chartW / Math.max(rows.length, 1) - barGap);
  const stormIndexes = rows
    .map((row, index) => (row.storm_flag || (row.kp ?? 0) >= 5 ? index : -1))
    .filter((index) => index >= 0);
  const stormMin = stormIndexes.length > 0 ? Math.min(...stormIndexes) : -1;
  const stormMax = stormIndexes.length > 0 ? Math.max(...stormIndexes) : -1;
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="kp-bar-figure">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="GFZ Kp index bar graph">
        <rect width={width} height={height} fill="#ffffff" />
        <rect x={left} y={top} width={chartW} height={chartH} fill="#ffffff" stroke="#111827" strokeWidth="1.4" />
        {stormMin >= 0 && (
          <rect
            x={left + (stormMin / rows.length) * chartW}
            y={top}
            width={((stormMax - stormMin + 1) / rows.length) * chartW}
            height={chartH}
            fill="#fef3c7"
            opacity="0.55"
          />
        )}
        {[0, 3, 6, 9].map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={left - 6} x2={left} y1={y} y2={y} stroke="#111827" />
              <line x1={left} x2={left + chartW} y1={y} y2={y} stroke="#d1d5db" strokeDasharray="5 5" />
              <text x={left - 12} y={y + 5} textAnchor="end" className="kp-bar-axis-text">{tick}</text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const x = left + (index / rows.length) * chartW + barGap / 2;
          const value = row.kp ?? 0;
          const barHeight = Math.max(0, top + chartH - yFor(value));
          const isStorm = row.storm_flag || value >= 5;
          return (
            <rect
              key={row.date}
              x={x}
              y={top + chartH - barHeight}
              width={barW}
              height={barHeight}
              fill={isStorm ? "#0f8ac4" : "#1f9bd2"}
            />
          );
        })}
        {rows.map((row, index) => {
          if (index % labelEvery !== 0 && index !== rows.length - 1) return null;
          const x = left + ((index + 0.5) / rows.length) * chartW;
          return (
            <g key={`label-${row.date}`}>
              <line x1={x} x2={x} y1={top} y2={top + chartH} stroke="#9ca3af" strokeDasharray="6 6" />
              <text x={x} y={height - 28} textAnchor="middle" className="kp-bar-axis-text">{shortDateLabel(row.date)}</text>
            </g>
          );
        })}
        <text x={width - 42} y={top + 18} textAnchor="middle" className="kp-bar-panel-label">(b) Kp</text>
        <text x={left + chartW / 2} y={height - 8} textAnchor="middle" className="kp-bar-axis-title">Date</text>
        <text x="24" y={top + chartH / 2} textAnchor="middle" className="kp-bar-axis-title" transform={`rotate(-90 24 ${top + chartH / 2})`}>
          Kp index
        </text>
      </svg>
    </div>
  );
}

export default function GfzKpAnalysisPanel({
  gfz,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return <div className="banner banner-info">Fetching GFZ Potsdam indices (Kp, ap, Ap, Cp)…</div>;
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!gfz || gfz.series.length === 0) {
    return (
      <div className="banner banner-info">
        Select a date range above and click <strong>Load all sources</strong> to pull geomagnetic indices from
        GFZ Potsdam and compare them with your archived VTEC.
      </div>
    );
  }

  const labels = gfz.series.map((r) => r.date);
  const stormDates = gfz.storms.map((s) => s.date);
  const stormTypeByDate = new Map(
    gfz.series.map((row) => [row.date, geomagneticConditionForKp(row.kp) ?? row.storm_class ?? "Unavailable"]),
  );
  const stormTypesFor = (chartLabels: string[]) => chartLabels.map((date) => stormTypeByDate.get(date) ?? null);
  const vtecOverlay =
    vtecDatasets.length > 0
      ? vtecDatasets
      : [
          {
            label: "Network mean VTEC",
            data: labels.map((d) => gfz.series.find((r) => r.date === d)?.mean_vtec ?? 0),
            color: "#168bd2",
          },
        ];

  const delta =
    gfz.mean_vtec_storm !== null && gfz.mean_vtec_quiet !== null
      ? gfz.mean_vtec_storm - gfz.mean_vtec_quiet
      : null;

  const apFor = (r: (typeof gfz.series)[0]) => r.ap_daily ?? r.ap;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="omni-source-banner">
        <div className="omni-source-scale" aria-hidden="true">
          <span>Low TEC</span>
          <div className="omni-source-gradient" />
          <span>High TEC</span>
        </div>
        <p>
          <strong>GFZ Potsdam geomagnetic context</strong> — Official Kp index from{" "}
          <a href="https://kp.gfz.de/en/data" target="_blank" rel="noreferrer">
            GFZ Helmholtz Centre for Geosciences
          </a>
          . Red bands on the VTEC chart mark storm days (Kp ≥ 5 or Ap ≥ 50). Kp/ap are aggregated from 3-hourly
          nowcast/definitive values; Ap and Cp are daily planetary indices.
        </p>
      </div>

      <GeomagneticConditionScale />

      <div className="omni-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Storm days</div>
          <div className="omni-stat-value" style={{ color: gfz.storm_days > 0 ? "#ff6b6b" : "#00ff88" }}>
            {gfz.storm_days} / {gfz.days}
          </div>
          <div className="omni-stat-note">Kp ≥ 5 or Ap ≥ 50</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak Kp</div>
          <div className="omni-stat-value">{fmt(gfz.max_kp)}</div>
          <div className="omni-stat-note">Daily maximum (3-hourly)</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak Ap</div>
          <div className="omni-stat-value">{fmt(gfz.max_ap, 0)}</div>
          <div className="omni-stat-note">Daily planetary Ap</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Mean Cp</div>
          <div className="omni-stat-value">{fmt(gfz.mean_cp, 2)}</div>
          <div className="omni-stat-note">Planetary Cp index</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">VTEC storm vs quiet</div>
          <div className="omni-stat-value">
            {fmt(gfz.mean_vtec_storm)} vs {fmt(gfz.mean_vtec_quiet)} TECU
          </div>
          <div className="omni-stat-note">
            {delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} TECU on storm days` : "No VTEC overlap in range"}
          </div>
        </div>
      </div>

      {vtecLabels.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>VTEC with GFZ storm days highlighted</div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Shaded columns indicate GFZ-classified storm intervals from the official Kp index service.
          </p>
          <LineChart
            labels={vtecLabels}
            datasets={vtecOverlay}
            yLabel="VTEC (TECU)"
            height={300}
            highlightDates={stormDates.filter((d) => vtecLabels.includes(d))}
            tooltipDetails={stormTypesFor(vtecLabels)}
          />
        </div>
      )}

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>GFZ Kp index - bar graph</div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          Daily maximum Kp plotted as vertical bars. The pale band marks storm-class days where Kp is at least 5.
        </p>
        <KpIndexBarChart rows={gfz.series} />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>GFZ indices — Kp &amp; ap</div>
        <LineChart
          labels={labels}
          datasets={[
            { label: "Kp (daily max)", data: gfz.series.map((r) => r.kp ?? 0), color: "#ff8c00" },
            {
              label: "ap (3-hourly mean)",
              data: gfz.series.map((r) => (r.ap !== null ? r.ap / 10 : 0)),
              color: "#ff4444",
              dashed: true,
            },
          ]}
          yLabel="Kp / ap÷10"
          height={240}
          tooltipDetails={stormTypesFor(labels)}
        />
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
          ap scaled ÷10 for shared axis readability (e.g. ap 50 → 5.0).
        </p>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Planetary indices — Ap &amp; Cp</div>
        <LineChart
          labels={labels}
          datasets={[
            {
              label: "Ap (daily)",
              data: gfz.series.map((r) => (apFor(r) !== null ? (apFor(r)! / 10) : 0)),
              color: "#ffcc00",
            },
            { label: "Cp", data: gfz.series.map((r) => r.cp ?? 0), color: "#a78bfa" },
          ]}
          yLabel="Ap÷10 / Cp"
          height={220}
          tooltipDetails={stormTypesFor(labels)}
        />
      </div>

      {gfz.storms.length > 0 ? (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>GFZ storm days in selected range</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "560px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Class</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Ap</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Cp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Mean VTEC</th>
                </tr>
              </thead>
              <tbody>
                {gfz.storms.map((row) => (
                  <tr key={row.date} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "#ff8c00" }}>{row.storm_class}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.kp)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.ap, 0)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.cp, 2)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>
                      {row.mean_vtec !== null ? row.mean_vtec.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="banner banner-info">No GFZ storm days (Kp ≥ 5 or Ap ≥ 50) in this range.</div>
      )}

      {gfz.fetched_at && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
          GFZ data fetched {gfz.fetched_at.replace("T", " ").slice(0, 19)} UTC · {gfz.source}
        </p>
      )}
    </div>
  );
}
