"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { loadLineChart } from "@/lib/loadLineChart";
import {
  seriesEpochsFromApi,
  sharedTimeDomain,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";
import type { ImfSeries } from "@/lib/types";
import type { PlotAreaReporter } from "@/lib/chartPlotArea";
import { IMF_BT_SCALE } from "@/lib/spaceWeatherMetrics";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const IMF_GUIDES = [
  { value: 0, label: "Bz = 0", color: "#64748b" },
  ...IMF_BT_SCALE.slice(1).map(band => ({
    value: band.boundary,
    label: `Bt ${band.label} (${band.range})`,
    color: band.color,
  })),
];

export default function InterplanetaryMagneticFieldChart({
  data,
  analysisDomain,
  selectedTime,
  verticalMarkers,
  onPlotAreaChange,
  onPickTime,
  height = 220,
}: {
  data: ImfSeries;
  analysisDomain?: { min: number; max: number };
  selectedTime?: number;
  verticalMarkers?: { x: number; label: string; color?: string; highlighted?: boolean }[];
  onPlotAreaChange?: PlotAreaReporter;
  onPickTime?: (ms: number) => void;
  height?: number;
}) {
  const epochs = useMemo(
    () => seriesEpochsFromApi(data.labels, data.epoch_ms, data.times),
    [data.labels, data.epoch_ms, data.times],
  );
  const visible = useMemo(() => {
    const indices = data.labels.map((_, index) => index);
    if (!analysisDomain) return indices;
    return indices.filter(index => {
      const time = epochs?.[index] ?? Date.parse(data.times[index] ?? data.labels[index]);
      return Number.isFinite(time) && time >= analysisDomain.min && time < analysisDomain.max;
    });
  }, [analysisDomain, data.labels, data.times, epochs]);
  const chartDomain = useMemo(() => {
    if (analysisDomain) return analysisDomain;
    return epochs ? sharedTimeDomain([epochs]) : null;
  }, [analysisDomain, epochs]);
  const selected = useMemo(() => {
    if (selectedTime == null || !epochs) return null;
    let nearest = -1;
    for (const index of visible) {
      if (nearest < 0 || Math.abs(epochs[index] - selectedTime) < Math.abs(epochs[nearest] - selectedTime)) {
        nearest = index;
      }
    }
    if (nearest < 0 || Math.abs(epochs[nearest] - selectedTime) > 5 * 60_000) return null;
    const value = (values: (number | null)[]) => {
      const sample = values[nearest];
      return sample != null && Number.isFinite(sample) ? `${sample.toFixed(2)} nT` : "N/A";
    };
    return {
      x: selectedTime,
      lines: [
        `${new Date(selectedTime).toISOString().slice(11, 16)} UTC`,
        `Bt: ${value(data.bt)} · By: ${value(data.by)} · Bz: ${value(data.bz)}`,
      ],
    };
  }, [data.bt, data.by, data.bz, epochs, selectedTime, visible]);

  return (
    <LineChart
      labels={visible.map(index => data.labels[index])}
      xValues={epochs ? visible.map(index => epochs[index]) : undefined}
      epochMs={epochs ? visible.map(index => epochs[index]) : undefined}
      yLabel="IMF (nT)"
      height={height}
      toggleableLegend
      preserveSamples
      ySuggestedMax={IMF_BT_SCALE[3].boundary + 2}
      thresholds={IMF_GUIDES}
      verticalMarkers={verticalMarkers}
      markerReadout={selected ?? undefined}
      onPlotAreaChange={onPlotAreaChange}
      onPickTime={onPickTime}
      datasets={[
        { label: "IMF Bt", data: visible.map(index => data.bt[index]), color: "#f8fafc" },
        { label: "IMF GSM By", data: visible.map(index => data.by[index]), color: "#38bdf8" },
        { label: "IMF GSM Bz", data: visible.map(index => data.bz[index]), color: "#ef4444", fill: true },
      ]}
      {...utcTimeAxisProps(chartDomain)}
    />
  );
}
