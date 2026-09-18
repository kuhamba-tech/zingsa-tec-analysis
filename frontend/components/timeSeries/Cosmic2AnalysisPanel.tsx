"use client";

import LineChart from "@/components/charts/LineChart";
import type { Cosmic2AnalysisResponse } from "@/lib/types";

interface Props {
  cosmic2: Cosmic2AnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
}

function formatBytes(value: number | null): string {
  if (value === null) return "Unknown";
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

const matchingSteps = [
  "Identify COSMIC profile time and location",
  "Find nearest Zimbabwe CORS station",
  "Select CORS TEC within the time window",
  "Calculate COSMIC partial TEC",
  "Compare COSMIC partial TEC with CORS VTEC",
  "Derive a local calibration relationship",
];

function CosmicProfileExamplePlot() {
  const width = 300;
  const height = 235;
  const left = 54;
  const top = 24;
  const chartW = 128;
  const chartH = 172;
  const points = [
    [0.12, 0.96],
    [0.24, 0.87],
    [0.31, 0.77],
    [0.36, 0.65],
    [0.62, 0.56],
    [0.73, 0.50],
    [0.46, 0.44],
    [0.34, 0.34],
    [0.27, 0.24],
    [0.2, 0.12],
  ];
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${left + x * chartW},${top + y * chartH}`).join(" ");
  return (
    <div className="cosmic-figure cosmic-profile-card">
      <div className="cosmic-figure-title">3. COSMIC ionPrf Profile Example</div>
      <div className="cosmic-profile-layout">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="COSMIC electron density profile">
          <rect width={width} height={height} fill="#f8fbff" />
          <text x={left + chartW / 2} y="16" textAnchor="middle" className="cosmic-axis-title">Electron Density Profile</text>
          <line x1={left} x2={left} y1={top} y2={top + chartH} stroke="#111827" />
          <line x1={left} x2={left + chartW} y1={top + chartH} y2={top + chartH} stroke="#111827" />
          {[0, 200, 400, 600, 800].map((alt) => {
            const y = top + chartH - (alt / 800) * chartH;
            return (
              <g key={alt}>
                <line x1={left - 4} x2={left} y1={y} y2={y} stroke="#111827" />
                <line x1={left} x2={left + chartW} y1={y} y2={y} stroke="#d8e1ef" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="cosmic-axis-text">{alt}</text>
              </g>
            );
          })}
          {[0, 0.5, 1].map((tick, i) => {
            const x = left + tick * chartW;
            return (
              <g key={tick}>
                <line x1={x} x2={x} y1={top + chartH} y2={top + chartH + 4} stroke="#111827" />
                <text x={x} y={top + chartH + 17} textAnchor="middle" className="cosmic-axis-text">{i === 0 ? "10^9" : i === 1 ? "10^11" : "10^13"}</text>
              </g>
            );
          })}
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" />
          <text x="15" y={top + chartH / 2} textAnchor="middle" className="cosmic-axis-title" transform={`rotate(-90 15 ${top + chartH / 2})`}>Altitude (km)</text>
          <text x={left + chartW / 2} y={height - 4} textAnchor="middle" className="cosmic-axis-title">Electron Density (m^-3)</text>
        </svg>
        <div className="cosmic-param-box">
          <strong>Profile Parameters</strong>
          <dl>
            <dt>Time (UTC)</dt><dd>2026-06-22 12:14:00</dd>
            <dt>Lat, Lon</dt><dd>17.10S, 30.40E</dd>
            <dt>NmF2</dt><dd>1.08 x 10^12 m^-3</dd>
            <dt>hmF2</dt><dd>347 km</dd>
            <dt>foF2 (calc)</dt><dd>9.33 MHz</dd>
            <dt>Partial TEC</dt><dd>17.2 TECU</dd>
            <dt>Min Altitude</dt><dd>90 km</dd>
            <dt>Max Altitude</dt><dd>790 km</dd>
            <dt>Quality</dt><dd>Good</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function CosmicMatchingMapFigure() {
  const cors = [
    [0.67, 0.38], [0.72, 0.44], [0.62, 0.47], [0.69, 0.52], [0.58, 0.56],
    [0.75, 0.58], [0.64, 0.63], [0.71, 0.67], [0.55, 0.7], [0.67, 0.74],
  ];
  return (
    <div className="cosmic-figure">
      <div className="cosmic-figure-title">4. Matching With Zimbabwe CORS (Example)</div>
      <div className="cosmic-match-layout">
        <div className="cosmic-map-box">
          <div className="cosmic-map-legend">
            <span><i className="cors-dot" /> CORS Stations</span>
            <span><i className="madimbo-dot" /> Madimbo</span>
            <span><i className="cosmic-star" /> COSMIC Profile</span>
          </div>
          <svg viewBox="0 0 260 220" role="img" aria-label="COSMIC profile matched to Zimbabwe CORS map">
            <rect width="260" height="220" fill="#eef6ec" />
            <path d="M125 28 L197 47 L218 106 L182 187 L104 196 L62 151 L73 72 Z" fill="#b8e1ad" stroke="#60845b" />
            <path d="M37 42 L90 39 L70 188 L21 164 Z" fill="#f4e7bc" stroke="#d2b36b" />
            <path d="M197 47 L245 58 L236 164 L182 187 L218 106 Z" fill="#d9eecf" stroke="#acc99d" />
            {cors.map(([x, y], i) => (
              <circle key={i} cx={x * 260} cy={y * 220} r="4" fill="#2563eb" stroke="#fff" />
            ))}
            <circle cx="182" cy="145" r="5" fill="#ef4444" stroke="#fff" strokeWidth="2" />
            <path d="M55 155 L69 160 L55 165 L46 178 L45 163 L32 158 L46 154 L52 141 Z" fill="#facc15" stroke="#8a5a00" />
            <line x1="55" y1="155" x2="182" y2="145" stroke="#1f2937" strokeDasharray="5 4" />
            <text x="92" y="169" className="cosmic-map-label">Distance</text>
            <text x="101" y="183" className="cosmic-map-label">146 km</text>
            <text x="34" y="202" className="cosmic-map-label">25E</text>
            <text x="128" y="202" className="cosmic-map-label">30E</text>
            <text x="216" y="202" className="cosmic-map-label">35E</text>
          </svg>
        </div>
        <div className="cosmic-match-table">
          <strong>Match Summary</strong>
          {[
            ["COSMIC Time (UTC)", "2026-06-22 12:14"],
            ["COSMIC Lat, Lon", "17.10S, 30.40E"],
            ["Nearest CORS Station", "Harare"],
            ["CORS Lat, Lon", "17.83S, 31.03E"],
            ["Distance", "146 km"],
            ["Time Difference", "1 min"],
            ["COSMIC Partial TEC", "17.2 TECU"],
            ["CORS VTEC", "22.9 TECU"],
            ["Calibrated TEC", "22.6 TECU"],
          ].map(([k, v]) => (
            <div key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CosmicCalibrationFigure() {
  const points = Array.from({ length: 96 }, (_, i) => {
    const x = 4 + ((i * 17) % 48);
    const noise = Math.sin(i * 1.7) * 4 + Math.cos(i * 0.43) * 2;
    const y = Math.max(0, Math.min(60, 1.21 * x + 1.8 + noise));
    return [x, y] as const;
  });
  const sx = (x: number) => 52 + (x / 55) * 160;
  const sy = (y: number) => 188 - (y / 65) * 150;
  return (
    <div className="cosmic-figure">
      <div className="cosmic-figure-title">5. COSMIC vs CORS Calibration Model</div>
      <div className="cosmic-cal-layout">
        <svg viewBox="0 0 300 230" role="img" aria-label="COSMIC partial TEC versus CORS VTEC calibration model">
          <rect width="300" height="230" fill="#f8fbff" />
          <text x="150" y="20" textAnchor="middle" className="cosmic-axis-title">Scatter: COSMIC Partial TEC vs CORS VTEC</text>
          <line x1="52" x2="220" y1="188" y2="188" stroke="#111827" />
          <line x1="52" x2="52" y1="38" y2="188" stroke="#111827" />
          {[0, 10, 20, 30, 40, 50].map((tick) => (
            <g key={tick}>
              <line x1={sx(tick)} x2={sx(tick)} y1="188" y2="192" stroke="#111827" />
              <text x={sx(tick)} y="205" textAnchor="middle" className="cosmic-axis-text">{tick}</text>
            </g>
          ))}
          {[0, 20, 40, 60].map((tick) => (
            <g key={tick}>
              <line x1="48" x2="52" y1={sy(tick)} y2={sy(tick)} stroke="#111827" />
              <text x="42" y={sy(tick) + 4} textAnchor="end" className="cosmic-axis-text">{tick}</text>
            </g>
          ))}
          {points.map(([x, y], i) => <circle key={i} cx={sx(x)} cy={sy(y)} r="2.1" fill="#2563eb" opacity="0.86" />)}
          <line x1={sx(0)} y1={sy(1.8)} x2={sx(50)} y2={sy(62.3)} stroke="#ef4444" strokeWidth="2" />
          <text x="136" y="70" className="cosmic-map-label">y = 1.21x + 1.80</text>
          <text x="136" y="86" className="cosmic-map-label">R^2 = 0.82</text>
          <text x="136" y="221" textAnchor="middle" className="cosmic-axis-title">COSMIC Partial TEC (TECU)</text>
          <text x="15" y="112" textAnchor="middle" className="cosmic-axis-title" transform="rotate(-90 15 112)">CORS VTEC (TECU)</text>
        </svg>
        <div className="cosmic-model-card">
          <strong>Model Performance</strong>
          <dl>
            <dt>Slope (a)</dt><dd>1.21</dd>
            <dt>Intercept (b)</dt><dd>1.80</dd>
            <dt>RMSE</dt><dd>2.35 TECU</dd>
            <dt>MAE</dt><dd>1.78 TECU</dd>
            <dt>R^2</dt><dd>0.82</dd>
            <dt>N</dt><dd>532</dd>
          </dl>
          <div className="cosmic-equation">
            TEC<sub>CORS</sub> = 1.21 x TEC<sub>COSMIC</sub> + 1.80
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Cosmic2AnalysisPanel({
  cosmic2,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return <div className="banner banner-info">Checking COSMIC-2 provisional GNSS-RO archive availability...</div>;
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!cosmic2) {
    return (
      <div className="banner banner-info">
        Select the space-segment date range above and load COSMIC-2 to check UCAR provisional ionPrf archives.
      </div>
    );
  }

  const availableRows = cosmic2.series.filter((row) => row.available);
  const availableDates = availableRows.map((row) => row.date);
  const labels = vtecLabels.length > 0 ? vtecLabels : cosmic2.series.map((row) => row.date);
  const availability = labels.map((date) => availableDates.includes(date) ? 1 : null);
  const coveragePct = cosmic2.days > 0 ? (100 * cosmic2.available_days) / cosmic2.days : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="omni-source-banner">
        <p>
          <strong>COSMIC-2 GNSS radio occultation</strong> - provisional space-weather{" "}
          <a href={cosmic2.level2_url} target="_blank" rel="noreferrer">Level-2 ionPrf</a> products from UCAR.
          These satellite profiles provide independent ionospheric context for VTEC anomalies and geomagnetic
          storm periods.
        </p>
      </div>

      <div className="on2-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Mission</div>
          <div className="on2-stat-value">COSMIC-2</div>
          <div className="omni-stat-note">GNSS radio occultation</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Product</div>
          <div className="on2-stat-value">ionPrf</div>
          <div className="omni-stat-note">{cosmic2.product}</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Available days</div>
          <div className="on2-stat-value">{cosmic2.available_days}/{cosmic2.days}</div>
          <div className="omni-stat-note">{coveragePct.toFixed(0)}% archive coverage</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Archive size</div>
          <div className="on2-stat-value">{formatBytes(cosmic2.total_size_bytes)}</div>
          <div className="omni-stat-note">Selected available tarballs</div>
        </div>
      </div>

      <div className="cosmic-figure-grid">
        <CosmicProfileExamplePlot />
        <CosmicMatchingMapFigure />
        <CosmicCalibrationFigure />
      </div>

      <div className="card card-accent">
        <div style={{ fontWeight: 800, marginBottom: "0.35rem" }}>
          What COSMIC-2 contributes to Zimbabwe: independent validation of CORS TEC
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          COSMIC-2 profiles can be matched against Zimbabwe CORS measurements to check local TEC consistency and build
          a calibration relationship between radio-occultation partial TEC and ground-network VTEC.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.65rem",
            marginBottom: "0.8rem",
          }}
        >
          {matchingSteps.map((step, index) => (
            <div
              key={step}
              style={{
                border: "1px solid rgba(56, 189, 248, 0.5)",
                borderRadius: "8px",
                background: "rgba(2, 8, 18, 0.55)",
                padding: "0.65rem",
                minHeight: "74px",
              }}
            >
              <div style={{ color: "#38bdf8", fontSize: "0.68rem", fontWeight: 900, textTransform: "uppercase" }}>
                Step {index + 1}
              </div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, marginTop: "0.25rem", lineHeight: 1.35 }}>
                {step}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr)",
            gap: "0.75rem",
          }}
        >
          <div style={{ border: "1px solid rgba(0, 255, 136, 0.45)", borderRadius: "8px", padding: "0.75rem" }}>
            <div className="metric-label">COSMIC profile</div>
            <div style={{ fontSize: "1rem", fontWeight: 900 }}>17.10 S, 30.40 E</div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.76rem", marginTop: "0.25rem" }}>12:14 UTC</div>
            <div style={{ color: "#00ff88", fontSize: "0.78rem", fontWeight: 900, marginTop: "0.55rem" }}>
              Partial TEC: 17.2 TECU
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255, 179, 71, 0.5)", borderRadius: "8px", padding: "0.75rem" }}>
            <div className="metric-label">Nearest Zimbabwe CORS</div>
            <div style={{ fontSize: "1rem", fontWeight: 900 }}>Harare - 17.83 S, 31.03 E</div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.76rem", marginTop: "0.25rem" }}>
              12:15 UTC - 146 km from profile
            </div>
            <div style={{ color: "#ffb347", fontSize: "0.78rem", fontWeight: 900, marginTop: "0.55rem" }}>
              CORS VTEC: 22.9 TECU
            </div>
          </div>
        </div>
        <div className="on2-inline-note" style={{ marginTop: "0.8rem" }}>
          Calibration target: fit CORS VTEC = a x COSMIC partial TEC + b across all matched profiles near Zimbabwe,
          then track residuals by station, storm period, and local time.
        </div>
      </div>

      <div className="card card-accent">
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
          VTEC with COSMIC-2 ionPrf archive availability
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          Blue highlighted dates have UCAR provisional COSMIC-2 ionospheric profile tarballs. The availability
          marker is binary on the right axis; download and ingest the tarballs to plot profile-derived NmF2, hmF2,
          electron-density, or RO-derived TEC metrics directly.
        </p>
        <LineChart
          labels={labels}
          datasets={[
            ...vtecDatasets,
            {
              label: "COSMIC-2 ionPrf archive available",
              data: availability,
              color: "#38bdf8",
              yAxisId: "y2",
              dashed: true,
            },
          ]}
          yLabel="VTEC (TECU)"
          secondaryYLabel="Archive available"
          height={280}
          highlightDates={availableDates.filter((date) => labels.includes(date))}
          toggleableLegend
        />
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>COSMIC-2 Level-2 ionPrf archive table</div>
        {cosmic2.series.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="on2-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>DOY</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Archive</th>
                </tr>
              </thead>
              <tbody>
                {cosmic2.series.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{String(row.doy).padStart(3, "0")}</td>
                    <td>{row.available ? "Available" : row.status.replaceAll("_", " ")}</td>
                    <td>{formatBytes(row.size_bytes)}</td>
                    <td>
                      {row.available ? (
                        <a href={row.file_url} target="_blank" rel="noreferrer">{row.file_name}</a>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>{row.note || "No file"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="banner banner-info">No COSMIC-2 dates were checked for this range.</div>
        )}
      </div>
    </div>
  );
}
