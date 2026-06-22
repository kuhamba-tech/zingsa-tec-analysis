"use client";

import LineChart from "@/components/charts/LineChart";
import type { CelestrakAnalysisResponse } from "@/lib/types";

interface Props {
  celestrak: CelestrakAnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
}

function fmt(v: number | null | undefined, digits = 1, suffix = "") {
  if (v === null || v === undefined) return "N/A";
  return `${v.toFixed(digits)}${suffix}`;
}

export default function CelestrakAnalysisPanel({
  celestrak,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return <div className="banner banner-info">Fetching CelesTrak indices (SSN, Kp, Ap, F10.7)…</div>;
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!celestrak || celestrak.series.length === 0) {
    return (
      <div className="banner banner-info">
        Select a date range above and click <strong>Load CelesTrak analysis</strong> to pull space-weather indices
        from CelesTrak and compare them with your archived VTEC.
      </div>
    );
  }

  const labels = celestrak.series.map((r) => r.date);
  const stormDates = celestrak.storms.map((s) => s.date);
  const stormTypeByDate = new Map(celestrak.series.map((row) => [row.date, row.storm_class || "Quiet"]));
  const stormTypesFor = (chartLabels: string[]) => chartLabels.map((date) => stormTypeByDate.get(date) ?? null);
  const vtecOverlay =
    vtecDatasets.length > 0
      ? vtecDatasets
      : [
          {
            label: "Network mean VTEC",
            data: labels.map((d) => celestrak.series.find((r) => r.date === d)?.mean_vtec ?? 0),
            color: "#168bd2",
          },
        ];

  const delta =
    celestrak.mean_vtec_storm !== null &&
    celestrak.mean_vtec_quiet !== null &&
    celestrak.mean_vtec_storm !== undefined &&
    celestrak.mean_vtec_quiet !== undefined
      ? celestrak.mean_vtec_storm - celestrak.mean_vtec_quiet
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
          <strong>CelesTrak geomagnetic context</strong> — Daily indices from{" "}
          <a href="https://celestrak.org/SpaceData/" target="_blank" rel="noreferrer">
            CelesTrak Space Weather Data
          </a>
          . Red bands on the VTEC chart mark storm days (Kp ≥ 5 or Ap ≥ 50). CelesTrak does not publish Dst, so
          severity here is judged from Kp/Ap instead.
        </p>
      </div>

      <div className="omni-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Storm days</div>
          <div className="omni-stat-value" style={{ color: celestrak.storm_days > 0 ? "#ff6b6b" : "#00ff88" }}>
            {celestrak.storm_days} / {celestrak.days}
          </div>
          <div className="omni-stat-note">Kp ≥ 5 or Ap ≥ 50</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak Kp</div>
          <div className="omni-stat-value">{fmt(celestrak.max_kp)}</div>
          <div className="omni-stat-note">Daily maximum</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak Ap</div>
          <div className="omni-stat-value">{fmt(celestrak.max_ap, 0)}</div>
          <div className="omni-stat-note">Daily mean Ap maximum</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Mean F10.7</div>
          <div className="omni-stat-value">{fmt(celestrak.mean_f107, 1, " SFU")}</div>
          <div className="omni-stat-note">Solar flux driver</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">VTEC storm vs quiet</div>
          <div className="omni-stat-value">
            {fmt(celestrak.mean_vtec_storm)} vs {fmt(celestrak.mean_vtec_quiet)} TECU
          </div>
          <div className="omni-stat-note">
            {delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} TECU on storm days` : "No VTEC overlap in range"}
          </div>
        </div>
      </div>

      {vtecLabels.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>VTEC with CelesTrak storm days highlighted</div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Shaded columns indicate CelesTrak-classified storm intervals. Compare TEC uplift or depletion against Kp/Ap below.
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
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>CelesTrak indices — Kp &amp; Ap</div>
        <LineChart
          labels={labels}
          datasets={[
            { label: "Kp (daily max)", data: celestrak.series.map((r) => r.kp ?? 0), color: "#ff8c00" },
            {
              label: "Ap (daily mean)",
              data: celestrak.series.map((r) => (r.ap !== null ? r.ap / 10 : 0)),
              color: "#ff4444",
              dashed: true,
            },
          ]}
          yLabel="Kp / Ap÷10"
          height={240}
          tooltipDetails={stormTypesFor(labels)}
        />
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
          Ap scaled ÷10 for shared axis readability (e.g. Ap 50 → 5.0).
        </p>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Solar drivers — F10.7 &amp; sunspot number</div>
        <LineChart
          labels={labels}
          datasets={[
            { label: "F10.7 (SFU)", data: celestrak.series.map((r) => r.f107 ?? 0), color: "#ffcc00" },
            { label: "Sunspot number", data: celestrak.series.map((r) => r.ssn ?? 0), color: "#a78bfa" },
          ]}
          yLabel="F10.7 / SSN"
          height={220}
          tooltipDetails={stormTypesFor(labels)}
        />
      </div>

      {celestrak.storms.length > 0 ? (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>CelesTrak storm days in selected range</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "640px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Class</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Ap</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>F10.7</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>SSN</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Mean VTEC</th>
                </tr>
              </thead>
              <tbody>
                {celestrak.storms.map((row) => (
                  <tr key={row.date} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "#ff8c00" }}>{row.storm_class}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.kp)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.ap, 0)}</td>
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
        <div className="banner banner-info">No CelesTrak storm days (Kp ≥ 5 or Ap ≥ 50) in this range.</div>
      )}

      {celestrak.fetched_at && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
          CelesTrak data fetched {celestrak.fetched_at.replace("T", " ").slice(0, 19)} UTC · {celestrak.source}
        </p>
      )}
    </div>
  );
}
