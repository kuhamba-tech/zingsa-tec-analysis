"use client";

import LineChart from "@/components/charts/LineChart";
import type {
  CelestrakAnalysisResponse,
  IntermagnetAnalysisResponse,
  OmniAnalysisResponse,
  WdcKyotoAnalysisResponse,
} from "@/lib/types";
import {
  dstApDualAxisComparison,
  loadedSourceCount,
  stormDatesUnion,
  type SourceBundle,
} from "@/lib/multiSourceIndicesMerge";
import {
  analyzeIntermagnetDbdtLink,
  analyzeIntermagnetDstApChart,
  type ChartAnalysisBlock,
} from "@/lib/multiSourceChartAnalysis";

interface Props {
  intermagnet: IntermagnetAnalysisResponse | null;
  omni: OmniAnalysisResponse | null;
  celestrak: CelestrakAnalysisResponse | null;
  kyoto: WdcKyotoAnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  error?: string | null;
  indicesLoading?: boolean;
}

function fmt(v: number | null | undefined, digits = 1, suffix = "") {
  if (v === null || v === undefined) return "N/A";
  return `${v.toFixed(digits)}${suffix}`;
}

function ChartAnalysis({ block }: { block: ChartAnalysisBlock }) {
  if (!block.lead && !block.bullets.length) return null;
  return (
    <div
      className="chart-analysis"
      style={{
        marginTop: "0.85rem",
        padding: "0.75rem 0.9rem",
        borderLeft: "3px solid var(--accent)",
        background: "rgba(22, 139, 210, 0.08)",
        borderRadius: "0 6px 6px 0",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.35rem" }}>What this chart tells you</div>
      {block.lead && (
        <p style={{ margin: "0 0 0.55rem", fontSize: "0.84rem", lineHeight: 1.5, color: "var(--text)" }}>{block.lead}</p>
      )}
      {block.bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55 }}>
          {block.bullets.map((text, i) => (
            <li key={i} style={{ marginBottom: "0.35rem" }}>
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function IntermagnetAnalysisPanel({
  intermagnet,
  omni,
  celestrak,
  kyoto,
  vtecLabels,
  vtecDatasets,
  loading,
  error,
  indicesLoading,
}: Props) {
  if (loading) {
    return (
      <div className="banner banner-info">
        Fetching INTERMAGNET minute data and planetary Dst/Ap indices (NASA, Kyoto, CelesTrak)…
      </div>
    );
  }
  if (error) {
    return <div className="banner banner-alert">{error}</div>;
  }
  if (!intermagnet || intermagnet.series.length === 0) {
    return (
      <div className="banner banner-info">
        Select a date range and observatory above and click <strong>Load INTERMAGNET analysis</strong> to pull
        ground-magnetometer data from the nearest southern-African observatories and compare geomagnetic
        activity (H range, dB/dt) with planetary Dst/Ap and your archived VTEC.
      </div>
    );
  }

  const labels = intermagnet.series.map((r) => r.date);
  const stormDates = intermagnet.storms.map((s) => s.date);
  const stormTypeByDate = new Map(intermagnet.series.map((row) => [row.date, row.storm_class]));
  const stormTypesFor = (chartLabels: string[]) => chartLabels.map((date) => stormTypeByDate.get(date) ?? null);
  const vtecOverlay =
    vtecDatasets.length > 0
      ? vtecDatasets
      : [
          {
            label: "Network mean VTEC",
            data: labels.map((d) => intermagnet.series.find((r) => r.date === d)?.mean_vtec ?? 0),
            color: "#168bd2",
          },
        ];

  const bundle: SourceBundle = { omni, celestrak, gfz: null, kyoto };
  const indicesCount = loadedSourceCount(bundle);
  const planetaryStormDates = stormDatesUnion(bundle);
  const { datasets: dstApDatasets } = dstApDualAxisComparison(bundle, labels);
  const dbdtAnalysis = analyzeIntermagnetDbdtLink(intermagnet, bundle);
  const dstApAnalysis =
    dstApDatasets.length > 0 ? analyzeIntermagnetDstApChart(bundle, labels, intermagnet, planetaryStormDates) : null;

  const delta =
    intermagnet.mean_vtec_storm !== null && intermagnet.mean_vtec_quiet !== null
      ? intermagnet.mean_vtec_storm - intermagnet.mean_vtec_quiet
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
          <strong>INTERMAGNET ground-magnetometer context</strong> — 1-minute observatory data from{" "}
          <a href="https://imag-data.bgs.ac.uk/GIN_V1/GINForms2" target="_blank" rel="noreferrer">
            INTERMAGNET (BGS GIN)
          </a>
          , observatory <strong>{intermagnet.observatory}</strong>
          {intermagnet.observatory_name ? ` (${intermagnet.observatory_name})` : ""}. Local storm days use
          dH/dt ≥ 10 nT/min or H-range ≥ 150 nT. Planetary Dst (NASA + Kyoto) and Ap (CelesTrak + Kyoto) on the
          chart below confirm global geomagnetic storms on the same dates.
        </p>
      </div>

      <div className="omni-summary-grid">
        <div className="card omni-stat-card">
          <div className="metric-label">Storm days</div>
          <div className="omni-stat-value" style={{ color: intermagnet.storm_days > 0 ? "#ff6b6b" : "#00ff88" }}>
            {intermagnet.storm_days} / {intermagnet.days}
          </div>
          <div className="omni-stat-note">dH/dt ≥ 10 nT/min or range ≥ 150 nT</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak dB/dt</div>
          <div className="omni-stat-value">{fmt(intermagnet.max_dbdt, 1, " nT/min")}</div>
          <div className="omni-stat-note">Max 1-min horizontal-field change</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak H range</div>
          <div className="omni-stat-value">{fmt(intermagnet.max_range_h, 0, " nT")}</div>
          <div className="omni-stat-note">Largest daily excursion</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">Peak modelled GIC</div>
          <div className="omni-stat-value">{fmt(intermagnet.max_gic_est_a, 1, " A")}</div>
          <div className="omni-stat-note">K·dB/dt plane-wave estimate</div>
        </div>
        <div className="card omni-stat-card">
          <div className="metric-label">VTEC storm vs quiet</div>
          <div className="omni-stat-value">
            {fmt(intermagnet.mean_vtec_storm)} vs {fmt(intermagnet.mean_vtec_quiet)} TECU
          </div>
          <div className="omni-stat-note">
            {delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} TECU on storm days` : "No VTEC overlap in range"}
          </div>
        </div>
      </div>

      {vtecLabels.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>VTEC with INTERMAGNET storm days highlighted</div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Shaded columns mark days when {intermagnet.observatory} recorded storm-level dH/dt or H-range activity.
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
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>
          Geomagnetic activity — daily max dB/dt &amp; modelled GIC
        </div>
        <LineChart
          labels={labels}
          datasets={[
            {
              label: "Max |dH/dt| (nT/min)",
              data: intermagnet.series.map((r) => r.max_dbdt ?? 0),
              color: "#ff8c00",
            },
            {
              label: "Modelled peak GIC (A)",
              data: intermagnet.series.map((r) => r.gic_est_a ?? 0),
              color: "#ff4444",
              dashed: true,
            },
          ]}
          yLabel="nT/min · Amps"
          height={240}
          highlightDates={stormDates}
          tooltipDetails={stormTypesFor(labels)}
        />
        <ChartAnalysis block={dbdtAnalysis} />
      </div>

      <div className="card card-accent">
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
          Dst &amp; Ap — NASA OMNIWeb · WDC Kyoto · CelesTrak
          <span
            style={{
              display: "inline-block",
              marginLeft: "0.5rem",
              padding: "0.12rem 0.45rem",
              fontSize: "0.68rem",
              fontWeight: 600,
              borderRadius: 4,
              background: "rgba(255, 80, 80, 0.15)",
              color: "var(--text-muted)",
              verticalAlign: "middle",
            }}
          >
            Planetary storm indices — global confirmation
          </span>
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          Left axis: Dst from NASA OMNIWeb and WDC Kyoto (Japan). Right axis: Ap from CelesTrak and WDC Kyoto.
          Compare with the dB/dt spike above — both should align on storm days (red shading from planetary Kp/Dst
          flags).
        </p>
        {indicesLoading ? (
          <div className="banner banner-info" style={{ marginBottom: "0.65rem" }}>
            Loading planetary indices…
          </div>
        ) : dstApDatasets.length > 0 ? (
          <LineChart
            labels={labels}
            datasets={dstApDatasets}
            yLabel="Dst (nT)"
            secondaryYLabel="Ap"
            height={260}
            highlightDates={planetaryStormDates.filter((d) => labels.includes(d))}
            toggleableLegend
          />
        ) : (
          <div className="banner banner-warn">
            Planetary Dst/Ap not loaded — reload INTERMAGNET analysis to fetch NASA, Kyoto, and CelesTrak indices
            for the same date range.
          </div>
        )}
        {dstApAnalysis && <ChartAnalysis block={dstApAnalysis} />}
        {indicesCount > 0 && (
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
            {indicesCount} planetary index provider(s) loaded for this timeline.
          </p>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Horizontal field — daily mean &amp; range</div>
        <LineChart
          labels={labels}
          datasets={[
            {
              label: "Daily H range (nT)",
              data: intermagnet.series.map((r) => r.range_h ?? 0),
              color: "#a78bfa",
              fill: true,
            },
          ]}
          yLabel="H range (nT)"
          height={220}
          highlightDates={stormDates}
          tooltipDetails={stormTypesFor(labels)}
        />
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.45rem" }}>
          Mean H over range: {fmt(intermagnet.series[0]?.mean_h, 0, " nT")} (start) →{" "}
          {fmt(intermagnet.series[intermagnet.series.length - 1]?.mean_h, 0, " nT")} (end). Quiet-day ranges at
          mid-latitudes are typically 30–60 nT; storm days exceed 150 nT.
        </p>
      </div>

      {intermagnet.storms.length > 0 ? (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>
            INTERMAGNET storm days at {intermagnet.observatory} in selected range
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "640px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Class</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Max dB/dt (nT/min)</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>H range (nT)</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Modelled GIC (A)</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Mean VTEC</th>
                </tr>
              </thead>
              <tbody>
                {intermagnet.storms.map((row) => (
                  <tr key={row.date} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "#ff8c00" }}>{row.storm_class}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.max_dbdt, 1)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.range_h, 0)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.gic_est_a, 1)}</td>
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
        <div className="banner banner-info">
          No INTERMAGNET storm days (dH/dt ≥ 10 nT/min or H range ≥ 150 nT) in this range.
        </div>
      )}

      {intermagnet.fetched_at && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
          INTERMAGNET data fetched {intermagnet.fetched_at.replace("T", " ").slice(0, 19)} UTC · {intermagnet.source}
        </p>
      )}
    </div>
  );
}
