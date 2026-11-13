"use client";

import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import GeomagneticConditionScale, { geomagneticConditionForKp } from "@/components/spaceWeather/GeomagneticConditionScale";
import type { GfzKpAnalysisResponse } from "@/lib/types";

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

export default function GfzKpAnalysisPanel({
  gfz,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
}: Props) {
  if (loading) {
    return (
      <div className="banner banner-info">
        Fetching GFZ Potsdam TXT indices (Kp, ap, Ap, SN, F10.7 since 1932 + nowcast)…
      </div>
    );
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
          <strong>GFZ Potsdam geomagnetic context</strong> — Official{" "}
          <code>Kp_ap_Ap_SN_F107</code> product from{" "}
          <a href="https://kp.gfz.de/en/data" target="_blank" rel="noreferrer">
            GFZ Helmholtz Centre for Geosciences
          </a>
          :{" "}
          <a href="https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt" target="_blank" rel="noreferrer">
            since_1932.txt
          </a>{" "}
          (historical) +{" "}
          <a href="https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_nowcast.txt" target="_blank" rel="noreferrer">
            nowcast.txt
          </a>
          . Storm shading uses Kp ≥ 5 or Ap ≥ 50. Daily Kp/ap come from eight 3-hour bins; Ap, SN, and F10.7obs
          are daily columns from the same files.
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
          <div className="metric-label">Peak SN</div>
          <div className="omni-stat-value">{fmt(gfz.max_sn ?? null, 0)}</div>
          <div className="omni-stat-note">SILSO sunspot number</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak F10.7</div>
          <div className="omni-stat-value">{fmt(gfz.max_f107 ?? null, 1)}</div>
          <div className="omni-stat-note">Observed sfu (TXT)</div>
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
          Daily maximum Kp. Red bars mark Kp 5 or higher; blue bars are below the storm threshold. Missing observations remain empty.
        </p>
        <BarChart
          labels={gfz.series.map(row => row.date)}
          values={gfz.series.map(row => row.kp)}
          barColors={gfz.series.map(row => row.kp != null && row.kp >= 5 ? "#ef4444" : "#168bd2")}
          yLabel="Kp (daily maximum)"
          xLabel="Date (UTC)"
          yMin={0}
          yMax={9}
          yStep={1}
          height={300}
        />
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
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Planetary Ap (+ Cp when JSON fallback)</div>
        <LineChart
          labels={labels}
          datasets={[
            {
              label: "Ap (daily)",
              data: gfz.series.map((r) => (apFor(r) !== null ? (apFor(r)! / 10) : 0)),
              color: "#ffcc00",
            },
            ...(gfz.series.some((r) => r.cp != null)
              ? [{ label: "Cp", data: gfz.series.map((r) => r.cp ?? 0), color: "#a78bfa" }]
              : []),
          ]}
          yLabel="Ap÷10 / Cp"
          height={220}
          tooltipDetails={stormTypesFor(labels)}
        />
      </div>

      {gfz.series.some((r) => r.sn != null || r.f107 != null) && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Solar indices from GFZ TXT — SN &amp; F10.7</div>
          <LineChart
            labels={labels}
            datasets={[
              {
                label: "SN (SILSO)",
                data: gfz.series.map((r) => r.sn ?? 0),
                color: "#f97316",
              },
              {
                label: "F10.7obs (sfu ÷10)",
                data: gfz.series.map((r) => (r.f107 != null ? r.f107 / 10 : 0)),
                color: "#38bdf8",
                dashed: true,
              },
            ]}
            yLabel="SN / F10.7÷10"
            height={220}
            tooltipDetails={stormTypesFor(labels)}
          />
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
            F10.7 scaled ÷10 for a shared axis (e.g. 150 sfu → 15.0). SN is CC BY-NC 4.0 (WDC-SILSO).
          </p>
        </div>
      )}

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
