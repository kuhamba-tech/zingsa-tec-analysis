"use client";

import Link from "next/link";
import type { GicLiveModel, GicSeriesResponse } from "@/lib/types";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { analyzeGicTimeline } from "@/lib/dashboardChartAnalysis";
import { DEFAULT_GIC_STATION_ID } from "@/lib/gicNetworkStatic";

const GIC_THRESHOLDS = [
  { value: 25, label: "Moderate (25 A)", color: "#ffcc00" },
  { value: 50, label: "High (50 A)", color: "#ff7a00" },
  { value: 75, label: "Extreme (75 A)", color: "#ff2e2e" },
];

export interface GicTimelineBundle {
  stationId: string;
  series: GicSeriesResponse | null;
  liveModel: GicLiveModel | null;
}

interface Props {
  data: GicTimelineBundle | null;
}

interface ChartDataset {
  label: string;
  data: (number | null)[];
  color: string;
  dashed?: boolean;
  meta?: ({ error?: number | null; confidence?: number | null } | null)[];
}

/** Live GIC timeline — data supplied by the dashboard parent poll. */
export default function GicLiveTimelinePanel({ data }: Props) {
  const series = data?.series ?? null;
  const liveModel = data?.liveModel ?? null;
  const stationId = data?.stationId ?? DEFAULT_GIC_STATION_ID;

  const hasEkf = (series?.points ?? []).some((p) => p.predicted != null);

  const measuredChart = (() => {
    const pts = (series?.points ?? []).filter((p) => p.observed != null);
    if (pts.length === 0) return null;
    const step = Math.max(1, Math.floor(pts.length / 288));
    const sampled = pts.filter((_, i) => i % step === 0);
    return {
      labels: sampled.map((p) => p.t.replace("T", " ").slice(11, 16)),
      observed: sampled.map((p) => p.observed),
      predicted: sampled.map((p) => p.predicted),
      meta: sampled.map((p) =>
        p.error != null || p.confidence != null ? { error: p.error, confidence: p.confidence } : null,
      ),
    };
  })();

  const modelChart = (() => {
    if (!liveModel?.available || liveModel.points.length === 0) return null;
    const pts = liveModel.points.filter((p) => p.gic_est_a != null);
    const step = Math.max(1, Math.floor(pts.length / 288));
    const sampled = pts.filter((_, i) => i % step === 0);
    return {
      labels: sampled.map((p) => p.t.replace("T", " ").slice(11, 16)),
      data: sampled.map((p) => (p.gic_est_a != null ? Math.abs(p.gic_est_a) : null)),
    };
  })();

  const chart = measuredChart ?? modelChart;
  const isModelled = !measuredChart && !!modelChart;
  const latest = liveModel?.latest?.t ?? series?.points.at(-1)?.t;

  const datasets = (() => {
    if (measuredChart) {
      const ds: ChartDataset[] = [{ label: "Measured GIC (A)", data: measuredChart.observed, color: "#00ff88" }];
      if (hasEkf) {
        ds.push({
          label: "EKF Predicted (A)",
          data: measuredChart.predicted,
          color: "#ff8c00",
          dashed: true,
          meta: measuredChart.meta,
        });
      }
      return ds;
    }
    if (modelChart) {
      return [{ label: "Modelled |GIC| estimate (A)", data: modelChart.data, color: "#00ff88" }];
    }
    return [];
  })();

  return (
    <div className="card operations-chart-card">
      <div className="operations-chart-title">
        Live GIC Current Timeline — last 24 h{" "}
        <Link href="/gic-monitor" style={{ fontSize: "0.72rem", marginLeft: "0.5rem" }}>
          Open GIC Monitor →
        </Link>
      </div>
      {chart && datasets.length > 0 ? (
        <>
          <LineChart labels={chart.labels} datasets={datasets} yLabel="Amps (A)" height={230} thresholds={GIC_THRESHOLDS} />
          <ChartAnalysisBox block={analyzeGicTimeline(data)} />
          <p className="operations-source">
            {isModelled ? (
              <>
                Live plane-wave estimate (K·dB/dt, K = {liveModel?.coefficient_a_per_nt_min ?? 0.8} A per nT/min)
                driven by {liveModel?.source ?? "NOAA GOES magnetometer"}.
                {latest ? ` Latest sample: ${latest.replace("T", " ").slice(0, 16)} UTC.` : ""}
                {" "}Switches to measured transformer-neutral values once field data arrives.
              </>
            ) : (
              <>
                Source: /gic/series measured transformer-neutral current ({stationId}).
                {hasEkf && " Solid: observed · dashed: EKF predicted."}
                {latest ? ` Latest sample: ${latest.replace("T", " ").slice(0, 16)} UTC.` : ""}
              </>
            )}
          </p>
        </>
      ) : (
        <div className="banner banner-warn">
          Live GIC feed is unavailable
          {liveModel?.reason ? ` (${liveModel.reason})` : ""} — nothing is simulated.
        </div>
      )}
    </div>
  );
}
