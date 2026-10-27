"use client";

import { useMemo } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { formatUtcDayLabel, seriesEpochsFromApi } from "@/lib/chartTimeAxis";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

function formatKpUtcBinLabel(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${formatUtcDayLabel(ms).replace(/ \d{4}$/, "")} ${hh}Z`;
}

/** Dst at each 3-hour Kp bar. Hours with no Kyoto sample stay empty. */
function dstOnKpBins(
  kpEpochs: number[] | null,
  dstEpochs: number[] | null,
  dstValues: (number | null)[] | undefined,
): (number | null)[] | null {
  if (!kpEpochs || !dstEpochs || !dstValues || dstValues.length === 0) return null;
  const samples = dstEpochs
    .map((ms, index) => ({ ms, value: dstValues[index] }))
    .filter((sample): sample is { ms: number; value: number } => (
      Number.isFinite(sample.ms) && sample.value != null && Number.isFinite(sample.value)
    ))
    .sort((a, b) => a.ms - b.ms);
  if (samples.length === 0) return null;
  const halfBinMs = 90 * 60 * 1000;
  return kpEpochs.map((ms) => {
    let best: { ms: number; value: number } | null = null;
    for (const sample of samples) {
      if (best == null || Math.abs(sample.ms - ms) < Math.abs(best.ms - ms)) best = sample;
      if (sample.ms > ms + halfBinMs) break;
    }
    if (!best || Math.abs(best.ms - ms) > halfBinMs) return null;
    return best.value;
  });
}

/** Kp forecast bars with Kyoto Dst on the right axis, as in the Dst-and-Kp index figure. */
export default function HeliosphericKpBars({
  labels,
  times,
  epochMs,
  observed,
  estimated,
  predicted,
  dst,
  dstLabels,
  dstTimes,
  dstEpochMs,
}: {
  labels: string[];
  times?: string[];
  epochMs?: (number | null)[];
  observed: (number | null)[];
  estimated: (number | null)[];
  predicted: (number | null)[];
  dst?: (number | null)[];
  dstLabels?: string[];
  dstTimes?: string[];
  dstEpochMs?: (number | null)[];
}) {
  const utcLabels = useMemo(() => {
    const epochs = seriesEpochsFromApi(labels, epochMs, times);
    if (epochs) return epochs.map(formatKpUtcBinLabel);
    return labels.map((l) => (/Z\b/i.test(l) ? l : `${l}Z`));
  }, [labels, epochMs, times]);

  const dstAligned = useMemo(() => {
    const kpEpochs = seriesEpochsFromApi(labels, epochMs, times);
    const dstEpochs = seriesEpochsFromApi(dstLabels ?? [], dstEpochMs, dstTimes);
    return dstOnKpBins(kpEpochs, dstEpochs, dst);
  }, [labels, epochMs, times, dst, dstLabels, dstTimes, dstEpochMs]);

  const dstScale = useMemo(() => {
    const values = (dstAligned ?? []).filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 0);
    const pad = Math.max(10, Math.round((high - low) * 0.2));
    const min = Math.floor((low - pad) / 10) * 10;
    const max = Math.ceil((high + pad) / 10) * 10;
    return min === max ? { min: min - 20, max: max + 20 } : { min, max };
  }, [dstAligned]);

  const data = useMemo(
    () => ({
      labels: utcLabels,
      datasets: [
        {
          type: "bar" as const,
          label: "Observed Kp",
          data: observed,
          backgroundColor: "#22c55e",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Estimated Kp",
          data: estimated,
          backgroundColor: "#eab308",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "NOAA predicted Kp",
          data: predicted,
          backgroundColor: "#38bdf8aa",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
          yAxisID: "y",
          order: 2,
        },
        ...(dstAligned && dstScale
          ? [{
              type: "line" as const,
              label: "Dst",
              data: dstAligned,
              borderColor: "#f8fafc",
              backgroundColor: "#f8fafc",
              borderWidth: 1.75,
              pointRadius: 0,
              pointHitRadius: 8,
              tension: 0,
              spanGaps: false,
              yAxisID: "y1",
              order: 0,
            }]
          : []),
      ],
    }),
    [utcLabels, observed, estimated, predicted, dstAligned, dstScale],
  );

  return (
    <div style={{ height: 250, position: "relative" }}>
      <Chart
        type="bar"
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          color: "#ffffff",
          animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true,
              labels: { color: "#ffffff", boxWidth: 10, font: { size: 10 } },
            },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx == null) return "";
                  const epochs = seriesEpochsFromApi(labels, epochMs, times);
                  if (epochs && Number.isFinite(epochs[idx])) {
                    const d = new Date(epochs[idx]);
                    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
                  }
                  return `${utcLabels[idx] ?? ""} UTC`;
                },
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  if (v == null || Number.isNaN(v)) return `${ctx.dataset.label}: —`;
                  if (ctx.dataset.yAxisID === "y1") return `Dst: ${v.toFixed(0)} nT`;
                  return `${ctx.dataset.label}: ${v.toFixed(2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              title: {
                display: true,
                text: "UTC",
                color: "#ffffff",
                font: { size: 11, weight: "bold" },
              },
              ticks: {
                color: "#ffffff",
                maxRotation: 45,
                minRotation: 0,
                autoSkip: true,
                maxTicksLimit: 10,
                font: { size: 10 },
              },
              grid: { color: "#1e3a5f" },
            },
            y: {
              min: 0,
              max: 9,
              title: {
                display: true,
                text: "Kp",
                color: "#ffffff",
                font: { weight: "bold" },
              },
              ticks: { color: "#ffffff", stepSize: 1 },
              grid: { color: "#1e3a5f" },
            },
            ...(dstScale
              ? {
                  y1: {
                    position: "right" as const,
                    min: dstScale.min,
                    max: dstScale.max,
                    title: {
                      display: true,
                      text: "Dst [nT]",
                      color: "#ffffff",
                      font: { weight: "bold" as const },
                    },
                    ticks: { color: "#ffffff" },
                    grid: { drawOnChartArea: false },
                  },
                }
              : {}),
          },
        }}
      />
    </div>
  );
}
