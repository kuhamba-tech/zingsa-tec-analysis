"use client";

import LineChart from "@/components/charts/LineChart";
import GeomagneticConditionScale, { geomagneticConditionForKp } from "@/components/spaceWeather/GeomagneticConditionScale";
import type { OmniAnalysisResponse } from "@/lib/types";

interface Props {
  omni: OmniAnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
}

function fmt(v: number | null | undefined, digits = 1, suffix = "") {
  if (v === null || v === undefined) return "N/A";
  return `${v.toFixed(digits)}${suffix}`;
}

export default function GeomagneticAnalysisPanel({
  omni,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return <div className="banner banner-info">Fetching NASA OMNIWeb indices (SSN, Kp, Dst, F10.7)…</div>;
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!omni || omni.series.length === 0) {
    return (
      <div className="banner banner-info">
        Select a date range above and click <strong>Load all sources</strong> to pull geomagnetic indices
        from NASA OMNIWeb and compare them with your archived VTEC. See the <strong>Source Comparison</strong> tab
        for overlaid Kp from all providers.
      </div>
    );
  }

  const labels = omni.series.map((r) => r.date);
  const stormDates = omni.storms.map((s) => s.date);
  const stormTypeByDate = new Map(
    omni.series.map((row) => [row.date, geomagneticConditionForKp(row.kp) ?? row.storm_class ?? "Unavailable"]),
  );
  const stormTypesFor = (chartLabels: string[]) => chartLabels.map((date) => stormTypeByDate.get(date) ?? null);
  const vtecOverlay =
    vtecDatasets.length > 0
      ? vtecDatasets
      : [
          {
            label: "Network mean VTEC",
            data: labels.map((d) => omni.series.find((r) => r.date === d)?.mean_vtec ?? 0),
            color: "#168bd2",
          },
        ];

  const delta =
    omni.mean_vtec_storm !== null &&
    omni.mean_vtec_quiet !== null &&
    omni.mean_vtec_storm !== undefined &&
    omni.mean_vtec_quiet !== undefined
      ? omni.mean_vtec_storm - omni.mean_vtec_quiet
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="omni-source-banner">
        <div className="omni-source-scale" aria-hidden="true">
          <span>Low TEC</span>
          <div className="omni-source-gradient" />
          <span>High TEC</span>
        </div>
        <p>
          <strong>OMNIWeb geomagnetic context</strong> — Daily indices from{" "}
          <a href="https://omniweb.gsfc.nasa.gov/form/dx1.html" target="_blank" rel="noreferrer">
            NASA OMNI2
          </a>
          . Red bands on the VTEC chart mark geomagnetic storm days (Kp ≥ 5 or Dst ≤ −50 nT).
        </p>
      </div>

      <GeomagneticConditionScale />

      <div className="omni-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Storm days</div>
          <div className="omni-stat-value" style={{ color: omni.storm_days > 0 ? "#ff6b6b" : "#00ff88" }}>
            {omni.storm_days} / {omni.days}
          </div>
          <div className="omni-stat-note">Kp ≥ 5 or Dst ≤ −50 nT</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak Kp</div>
          <div className="omni-stat-value">{fmt(omni.max_kp)}</div>
          <div className="omni-stat-note">Daily maximum</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Min Dst</div>
          <div className="omni-stat-value">{fmt(omni.min_dst, 0, " nT")}</div>
          <div className="omni-stat-note">Most negative ring current</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Mean F10.7</div>
          <div className="omni-stat-value">{fmt(omni.mean_f107, 1, " SFU")}</div>
          <div className="omni-stat-note">Solar flux driver</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">VTEC storm vs quiet</div>
          <div className="omni-stat-value">
            {fmt(omni.mean_vtec_storm)} vs {fmt(omni.mean_vtec_quiet)} TECU
          </div>
          <div className="omni-stat-note">
            {delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} TECU on storm days` : "No VTEC overlap in range"}
          </div>
        </div>
      </div>

      {vtecLabels.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>VTEC with geomagnetic storm days highlighted</div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Shaded columns indicate OMNI-classified storm intervals. Compare TEC uplift or depletion against Kp/Dst below.
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
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>OMNI indices — Kp &amp; Dst</div>
        <LineChart
          labels={labels}
          datasets={[
            { label: "Kp (daily max)", data: omni.series.map((r) => r.kp ?? 0), color: "#ff8c00" },
            {
              label: "Dst (daily min, nT)",
              data: omni.series.map((r) => (r.dst !== null ? Math.abs(r.dst) / 10 : 0)),
              color: "#ff4444",
              dashed: true,
            },
          ]}
          yLabel="Kp / |Dst|÷10"
          height={240}
          tooltipDetails={stormTypesFor(labels)}
        />
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
          Dst scaled ÷10 for shared axis readability (e.g. −50 nT → 5.0).
        </p>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Solar drivers — F10.7 &amp; sunspot number</div>
        <LineChart
          labels={labels}
          datasets={[
            { label: "F10.7 (SFU)", data: omni.series.map((r) => r.f107 ?? 0), color: "#ffcc00" },
            { label: "Sunspot number", data: omni.series.map((r) => r.ssn ?? 0), color: "#a78bfa" },
          ]}
          yLabel="F10.7 / SSN"
          height={220}
          tooltipDetails={stormTypesFor(labels)}
        />
      </div>

      {omni.storms.length > 0 ? (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>Geomagnetic storm days in selected range</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "640px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Class</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Dst (nT)</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>F10.7</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>SSN</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Mean VTEC</th>
                </tr>
              </thead>
              <tbody>
                {omni.storms.map((row) => (
                  <tr key={row.date} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "#ff8c00" }}>{row.storm_class}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.kp)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.dst, 0)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.f107, 1)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.ssn, 0)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>
                      {row.mean_vtec !== null ? `${row.mean_vtec.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="banner banner-info">No geomagnetic storm days (Kp ≥ 5 or Dst ≤ −50 nT) in this range.</div>
      )}

      {omni.fetched_at && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
          OMNI data fetched {omni.fetched_at.replace("T", " ").slice(0, 19)} UTC · {omni.source}
        </p>
      )}
    </div>
  );
}
