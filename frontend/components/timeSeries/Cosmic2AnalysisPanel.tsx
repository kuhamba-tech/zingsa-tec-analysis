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
