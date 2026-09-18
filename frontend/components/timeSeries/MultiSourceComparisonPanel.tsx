"use client";

import LineChart from "@/components/charts/LineChart";
import GeomagneticConditionScale from "@/components/spaceWeather/GeomagneticConditionScale";
import type {
  CelestrakAnalysisResponse,
  GfzKpAnalysisResponse,
  OmniAnalysisResponse,
  WdcKyotoAnalysisResponse,
} from "@/lib/types";
import {
  apComparison,
  cpGfzOnly,
  dstComparison,
  f107Comparison,
  fmt,
  kpComparison,
  kpDifferenceTable,
  loadedSourceCount,
  ssnComparison,
  stormDatesUnion,
  unionDates,
  type SourceBundle,
} from "@/lib/multiSourceIndicesMerge";

import {
  analyzeApChart,
  analyzeCpChart,
  analyzeDstChart,
  analyzeF107Chart,
  analyzeKpChart,
  analyzeOverallSummary,
  analyzeSsnChart,
  analyzeVtecStormOverlay,
  globalKpPeak,
  type ChartAnalysisBlock,
} from "@/lib/multiSourceChartAnalysis";

function MetricRoleBadge({ role }: { role: "storm" | "solar" | "local" }) {
  const styles: Record<typeof role, { bg: string; label: string }> = {
    storm: { bg: "rgba(255, 80, 80, 0.15)", label: "Geomagnetic storm index" },
    solar: { bg: "rgba(255, 180, 50, 0.15)", label: "Solar activity — not a storm detector alone" },
    local: { bg: "rgba(22, 139, 210, 0.15)", label: "Local ionosphere vs storm days" },
  };
  const { bg, label } = styles[role];
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: "0.5rem",
        padding: "0.12rem 0.45rem",
        fontSize: "0.68rem",
        fontWeight: 600,
        borderRadius: 4,
        background: bg,
        color: "var(--text-muted)",
        verticalAlign: "middle",
      }}
    >
      {label}
    </span>
  );
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

interface Props {
  omni: OmniAnalysisResponse | null;
  celestrak: CelestrakAnalysisResponse | null;
  gfz: GfzKpAnalysisResponse | null;
  kyoto: WdcKyotoAnalysisResponse | null;
  vtecLabels: string[];
  vtecDatasets: { label: string; data: number[]; color?: string }[];
  loading?: boolean;
  errors?: {
    omni?: string | null;
    celestrak?: string | null;
    gfz?: string | null;
    kyoto?: string | null;
  };
}

function ErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div className="banner banner-warn" style={{ fontSize: "0.82rem" }}>
      <strong>{label}:</strong> {message}
    </div>
  );
}

export default function MultiSourceComparisonPanel({
  omni,
  celestrak,
  gfz,
  kyoto,
  vtecLabels,
  vtecDatasets,
  loading,
  errors,
}: Props) {
  const bundle: SourceBundle = { omni, celestrak, gfz, kyoto };

  if (loading) {
    return (
      <div className="banner banner-info">
        Fetching indices from NASA OMNIWeb, CelesTrak, GFZ Potsdam (Germany), and WDC Kyoto (Japan)…
      </div>
    );
  }

  const count = loadedSourceCount(bundle);
  if (count === 0) {
    return (
      <div className="banner banner-info">
        Select a date range above and click <strong>Load all sources</strong> to pull geomagnetic indices from
        NASA OMNIWeb, CelesTrak, GFZ Potsdam (Germany), and WDC Kyoto (Japan) on one timeline and compare how
        each provider recorded the same metrics.
      </div>
    );
  }

  const dates = unionDates(bundle);
  const kpLines = kpComparison(bundle, dates);
  const f107Lines = f107Comparison(bundle, dates);
  const ssnLines = ssnComparison(bundle, dates);
  const apLines = apComparison(bundle, dates);
  const dstLines = dstComparison(bundle, dates);
  const cpLine = cpGfzOnly(bundle, dates);
  const kpDiff = kpDifferenceTable(bundle, dates);
  const stormDates = stormDatesUnion(bundle);
  const kpPeak = globalKpPeak(bundle, dates);
  const spreadDays = kpDiff.filter((r) => r.maxSpread !== null && r.maxSpread >= 0.5);
  const overallSummary = analyzeOverallSummary(bundle);

  const vtecOverlay =
    vtecDatasets.length > 0
      ? vtecDatasets
      : [
          {
            label: "Network mean VTEC",
            data: dates.map((d) => omni?.series.find((r) => r.date === d)?.mean_vtec ?? 0),
            color: "#168bd2",
          },
        ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {(errors?.omni || errors?.celestrak || errors?.gfz || errors?.kyoto) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {errors?.omni && <ErrorBanner label="NASA OMNIWeb" message={errors.omni} />}
          {errors?.celestrak && <ErrorBanner label="CelesTrak" message={errors.celestrak} />}
          {errors?.gfz && <ErrorBanner label="GFZ Potsdam" message={errors.gfz} />}
          {errors?.kyoto && <ErrorBanner label="WDC Kyoto" message={errors.kyoto} />}
        </div>
      )}

      <div className="omni-source-banner">
        <p>
          <strong>Multi-source comparison</strong> — {count} of 4 providers loaded · {dates.length} day(s) on a
          common timeline. GFZ Potsdam (Germany) is the official Kp derivation centre; WDC Kyoto (Japan) hosts
          the definitive Dst index and redistributes definitive Kp/ap. Storm shading marks days flagged by{" "}
          <em>any</em> provider.
        </p>
      </div>

      <GeomagneticConditionScale />

      <div className="card" style={{ borderColor: "var(--accent)" }}>
        <ChartAnalysis block={overallSummary} />
      </div>

      <div className="omni-summary-grid">
        {omni && (
          <div className="card omni-stat-card">
            <div className="metric-label">NASA peak Kp</div>
            <div className="omni-stat-value">{fmt(omni.max_kp)}</div>
            <div className="omni-stat-note">{omni.storm_days} storm day(s)</div>
          </div>
        )}
        {celestrak && (
          <div className="card omni-stat-card">
            <div className="metric-label">CelesTrak peak Kp</div>
            <div className="omni-stat-value">{fmt(celestrak.max_kp)}</div>
            <div className="omni-stat-note">{celestrak.storm_days} storm day(s)</div>
          </div>
        )}
        {gfz && (
          <div className="card omni-stat-card">
            <div className="metric-label">GFZ peak Kp (DE)</div>
            <div className="omni-stat-value">{fmt(gfz.max_kp)}</div>
            <div className="omni-stat-note">{gfz.storm_days} storm day(s)</div>
          </div>
        )}
        {kyoto && (
          <div className="card omni-stat-card">
            <div className="metric-label">Kyoto peak Kp (JP)</div>
            <div className="omni-stat-value">{fmt(kyoto.max_kp)}</div>
            <div className="omni-stat-note">
              min Dst {fmt(kyoto.min_dst, 0, " nT")} · {kyoto.storm_days} storm day(s)
            </div>
          </div>
        )}
        {spreadDays.length > 0 && (
          <div className="card omni-stat-card">
            <div className="metric-label">Kp spread ≥ 0.5</div>
            <div className="omni-stat-value" style={{ color: "#ff8c00" }}>
              {spreadDays.length} day(s)
            </div>
            <div className="omni-stat-note">Max |source − source| on same date</div>
          </div>
        )}
      </div>

      {vtecLabels.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            VTEC with multi-source storm days
            <MetricRoleBadge role="local" />
          </div>
          <LineChart
            labels={vtecLabels}
            datasets={vtecOverlay}
            yLabel="VTEC (TECU)"
            height={280}
            highlightDates={stormDates.filter((d) => vtecLabels.includes(d))}
          />
          <ChartAnalysis block={analyzeVtecStormOverlay(bundle, stormDates, vtecLabels, kpPeak, vtecDatasets)} />
        </div>
      )}

      {kpLines.length >= 1 && (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            Kp index — all sources
            <MetricRoleBadge role="storm" />
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Daily maximum Kp from NASA OMNIWeb, CelesTrak, GFZ Potsdam (Germany), and WDC Kyoto (Japan). Kyoto
            definitive Kp is distributed via GFZ since 1997 — expect close agreement with GFZ on archived dates.
          </p>
          <LineChart labels={dates} datasets={kpLines} yLabel="Kp" height={260} highlightDates={stormDates} />
          <ChartAnalysis block={analyzeKpChart(dates, kpLines, kpDiff, stormDates, bundle, kpPeak)} />
        </div>
      )}

      {f107Lines.length >= 1 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            F10.7 solar flux — OMNI vs CelesTrak
            <MetricRoleBadge role="solar" />
          </div>
          <LineChart labels={dates} datasets={f107Lines} yLabel="F10.7 (sfu)" height={220} />
          <ChartAnalysis block={analyzeF107Chart(dates, f107Lines, kpPeak, bundle)} />
        </div>
      )}

      {ssnLines.length >= 1 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            Sunspot number — OMNI vs CelesTrak
            <MetricRoleBadge role="solar" />
          </div>
          <LineChart labels={dates} datasets={ssnLines} yLabel="SSN" height={220} />
          <ChartAnalysis block={analyzeSsnChart(dates, ssnLines, kpPeak, bundle)} />
        </div>
      )}

      {apLines.length >= 1 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            Ap index — CelesTrak vs GFZ vs Kyoto
            <MetricRoleBadge role="storm" />
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            CelesTrak publishes daily mean Ap; GFZ and WDC Kyoto provide daily planetary Ap (distinct from 3-hourly ap).
          </p>
          <LineChart labels={dates} datasets={apLines} yLabel="Ap" height={220} />
          <ChartAnalysis block={analyzeApChart(dates, apLines, kpPeak, bundle)} />
        </div>
      )}

      {dstLines.length >= 1 && (
        <div className="card card-accent">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            Dst index — NASA vs WDC Kyoto (Japan)
            <MetricRoleBadge role="storm" />
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
            Daily minimum Dst from NASA OMNIWeb and the official WDC Kyoto equatorial Dst index. This is where
            Japanese and US-sourced ring-current estimates can differ most.
          </p>
          <LineChart labels={dates} datasets={dstLines} yLabel="Dst (nT)" height={240} highlightDates={stormDates} />
          <ChartAnalysis block={analyzeDstChart(dates, dstLines, kpPeak, bundle)} />
        </div>
      )}

      {cpLine && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>
            Cp — GFZ Potsdam only
            <MetricRoleBadge role="storm" />
          </div>
          <LineChart
            labels={dates}
            datasets={[{ label: cpLine.label, data: cpLine.data, color: cpLine.color }]}
            yLabel="Cp"
            height={200}
          />
          <ChartAnalysis block={analyzeCpChart(dates, cpLine.data, kpPeak, bundle)} />
        </div>
      )}

      {kpDiff.length > 0 && kpLines.length >= 2 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.65rem" }}>Daily Kp comparison table</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "520px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Date</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>NASA Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>CelesTrak Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>GFZ Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Kyoto Kp</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Max spread</th>
                </tr>
              </thead>
              <tbody>
                {kpDiff.map((row) => (
                  <tr
                    key={row.date}
                    style={{
                      borderBottom: "1px solid rgba(36,77,115,0.35)",
                      background:
                        row.maxSpread !== null && row.maxSpread >= 0.5
                          ? "rgba(255, 140, 0, 0.08)"
                          : undefined,
                    }}
                  >
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{row.date}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.omni)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.celestrak)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.gfz)}</td>
                    <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{fmt(row.kyoto)}</td>
                    <td
                      style={{
                        padding: "0.35rem 0.5rem",
                        textAlign: "right",
                        fontWeight: row.maxSpread !== null && row.maxSpread >= 0.5 ? 700 : 400,
                        color: row.maxSpread !== null && row.maxSpread >= 0.5 ? "#ff8c00" : undefined,
                      }}
                    >
                      {fmt(row.maxSpread)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
