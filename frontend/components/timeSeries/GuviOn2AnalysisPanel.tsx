"use client";

import LineChart from "@/components/charts/LineChart";
import type { GuviOn2Response } from "@/lib/types";

interface Props {
  guvi: GuviOn2Response | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
}

function ratioDataset(guvi: GuviOn2Response, labels: string[]) {
  const byDate = new Map(guvi.series.map((row) => [row.date, row.ratio]));
  return labels.map((date) => byDate.get(date) ?? null);
}

export default function GuviOn2AnalysisPanel({
  guvi,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return <div className="banner banner-info">Loading TIMED/GUVI O/N2 overpass context...</div>;
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!guvi) {
    return (
      <div className="banner banner-info">
        Select the O/N2 range above and load TIMED/GUVI context for the Africa overpasses.
      </div>
    );
  }

  const overpassDates = guvi.series.map((row) => row.date);
  const labels = vtecLabels.length > 0 ? vtecLabels : overpassDates;
  const on2Data = ratioDataset(guvi, labels);
  const hasMeasuredRatios = guvi.series.some((row) => row.ratio !== null);
  const vtecOverlay = vtecDatasets.length > 0 ? vtecDatasets : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="omni-source-banner">
        <p>
          <strong>TIMED/GUVI thermospheric O/N2</strong> - {guvi.region} overpass context from{" "}
          <a href={guvi.source_url} target="_blank" rel="noreferrer">GUVI Level-3 O/N2</a>. TIMED/GUVI samples the
          mesosphere and lower thermosphere at about {guvi.altitude_range_km[0]}-{guvi.altitude_range_km[1]} km.
          This is historical context, not live telemetry.
        </p>
      </div>

      <div className="on2-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Instrument</div>
          <div className="on2-stat-value">TIMED/GUVI</div>
          <div className="omni-stat-note">Global Ultraviolet Imager</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Product</div>
          <div className="on2-stat-value">O/N2 ratio</div>
          <div className="omni-stat-note">Thermospheric composition proxy</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Coverage</div>
          <div className="on2-stat-value">{guvi.series.length}</div>
          <div className="omni-stat-note">Africa overpass day(s) in selected range</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Data status</div>
          <div className="on2-stat-value">{hasMeasuredRatios ? "Measured" : "Metadata"}</div>
          <div className="omni-stat-note">
            {hasMeasuredRatios ? "O/N2 values loaded" : "Import GUVI grids to plot ratios"}
          </div>
        </div>
      </div>

      <div className="card card-accent">
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
          VTEC with TIMED/GUVI O/N2 overpasses
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          O/N2 ratio depletion is a thermospheric composition signal that can help explain negative ionospheric
          storm phases. Overpass bands mark when GUVI viewed Africa; measured O/N2 ratios appear on the right axis
          after the Level-3 map grid is imported.
        </p>
        <LineChart
          labels={labels}
          datasets={[
            ...vtecOverlay,
            {
              label: "TIMED/GUVI O/N2 ratio",
              data: on2Data,
              color: "#f59e0b",
              yAxisId: "y2",
              dashed: true,
            },
          ]}
          yLabel="VTEC (TECU)"
          secondaryYLabel="O/N2 ratio"
          height={280}
          highlightDates={overpassDates.filter((date) => labels.includes(date))}
          toggleableLegend
        />
        {!hasMeasuredRatios && (
          <div className="banner banner-warn" style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}>
            GUVI O/N2 ratio values are not yet in the local archive. The panel currently records the Africa
            overpass dates and UT times only; add the downloaded Level-3 O/N2 grids to enable measured ratio
            plotting and VTEC correlation.
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>Africa overpass table</div>
        {guvi.series.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="on2-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Overpass UT</th>
                  <th>Region</th>
                  <th>O/N2 ratio</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {guvi.series.map((row) => (
                  <tr key={`${row.date}-${row.overpass_ut}`}>
                    <td>{row.date}</td>
                    <td>{row.overpass_ut}</td>
                    <td>{row.region}</td>
                    <td>{row.ratio === null ? "Pending grid import" : row.ratio.toFixed(3)}</td>
                    <td>{row.status.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="banner banner-info">
            No TIMED/GUVI reference overpasses fall inside this selected date range.
          </div>
        )}
      </div>
    </div>
  );
}
