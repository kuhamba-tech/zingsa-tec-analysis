"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import { getGicLiveModel, getGicSeries } from "@/lib/api";
import type { GicLiveModel, GicSeriesResponse } from "@/lib/types";

const GIC_THRESHOLDS = [
  { value: 25, label: "Moderate (25 A)", color: "#ffcc00" },
  { value: 50, label: "High (50 A)", color: "#ff7a00" },
  { value: 75, label: "Extreme (75 A)", color: "#ff2e2e" },
];

/** Live GIC timeline for the operations dashboard — measured transformer-neutral
 *  current when field data exists, otherwise the real GOES magnetometer model. */
export default function GicLiveTimelinePanel() {
  const [liveModel, setLiveModel] = useState<GicLiveModel | null>(null);
  const [series, setSeries] = useState<GicSeriesResponse | null>(null);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      getGicLiveModel(24).catch(() => null),
      getGicSeries("MARIMBA_001", 24).catch(() => null),
    ]);
    setLiveModel(m);
    setSeries(s?.points?.length ? s : null);
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const measuredChart = useMemo(() => {
    const pts = (series?.points ?? []).filter((p) => p.observed != null);
    if (pts.length === 0) return null;
    const step = Math.max(1, Math.floor(pts.length / 288));
    const sampled = pts.filter((_, i) => i % step === 0);
    return {
      labels: sampled.map((p) => p.t.replace("T", " ").slice(11, 16)),
      data: sampled.map((p) => p.observed),
    };
  }, [series]);

  const modelChart = useMemo(() => {
    if (!liveModel?.available || liveModel.points.length === 0) return null;
    const pts = liveModel.points.filter((p) => p.gic_est_a != null);
    const step = Math.max(1, Math.floor(pts.length / 288));
    const sampled = pts.filter((_, i) => i % step === 0);
    return {
      labels: sampled.map((p) => p.t.replace("T", " ").slice(11, 16)),
      data: sampled.map((p) => (p.gic_est_a != null ? Math.abs(p.gic_est_a) : null)),
    };
  }, [liveModel]);

  const chart = measuredChart ?? modelChart;
  const isModelled = !measuredChart && !!modelChart;
  const latest = liveModel?.latest?.t ?? series?.points.at(-1)?.t;

  return (
    <div className="card operations-chart-card">
      <div className="operations-chart-title">Live GIC Current Timeline — last 24 h</div>
      {chart ? (
        <>
          <LineChart
            labels={chart.labels}
            datasets={[
              {
                label: isModelled ? "Modelled |GIC| estimate (A)" : "Measured GIC (A)",
                data: chart.data,
                color: "#00ff88",
              },
            ]}
            yLabel="Amps (A)"
            height={230}
            thresholds={GIC_THRESHOLDS}
          />
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
                Source: /gic/series measured transformer-neutral current (MARIMBA_001).
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
