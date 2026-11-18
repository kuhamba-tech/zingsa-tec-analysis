"use client";

import { useMemo, useContext } from "react";
import ChartDateRange, { ChartDateRangeContext, utcDayBounds } from "@/components/charts/ChartDateRange";
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
import { reportPlotAreaPlugin, type PlotAreaReporter } from "@/lib/chartPlotArea";
import { alignKpSeriesToDomain, KP_BIN_MS } from "@/lib/kpTimeline";

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
  analysisDomain,
  onPickTime,
  onPlotAreaChange,
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
  analysisDomain?: { min: number; max: number };
  onPickTime?: (ms: number) => void;
  onPlotAreaChange?: PlotAreaReporter;
}) {
  const calendar = useContext(ChartDateRangeContext);
  if (!analysisDomain && calendar?.day) {
    const bounds=utcDayBounds(calendar.day);
    const epochs=seriesEpochsFromApi(labels, epochMs, times);
    const keep=labels.map((_,i)=>i).filter(i=>epochs && epochs[i]>=bounds.min && epochs[i]<bounds.max);
    labels=keep.map(i=>labels[i]);
    times=times ? keep.map(i=>times![i]) : undefined;
    epochMs=epochMs ? keep.map(i=>epochMs![i]) : undefined;
    observed=keep.map(i=>observed[i]); estimated=keep.map(i=>estimated[i]); predicted=keep.map(i=>predicted[i]);
  }
  if (analysisDomain) {
    const epochs = seriesEpochsFromApi(labels, epochMs, times);
    const aligned = alignKpSeriesToDomain(epochs, { observed, estimated, predicted }, analysisDomain);
    labels = aligned.epochs.map(formatKpUtcBinLabel);
    times = aligned.epochs.map(time => new Date(time).toISOString());
    epochMs = aligned.epochs;
    observed = aligned.observed;
    estimated = aligned.estimated;
    predicted = aligned.predicted;
  }
  const utcLabels = useMemo(() => {
    const epochs = seriesEpochsFromApi(labels, epochMs, times);
    if (epochs) return epochs.map(formatKpUtcBinLabel);
    return labels.map((l) => (/Z\b/i.test(l) ? l : `${l}Z`));
  }, [labels, epochMs, times]);

  const dstAligned = useMemo(() => {
    const kpEpochs = seriesEpochsFromApi(labels, epochMs, times);
    const bins = analysisDomain && kpEpochs ? kpEpochs.slice(0, -1) : kpEpochs;
    const dstEpochs = seriesEpochsFromApi(dstLabels ?? [], dstEpochMs, dstTimes);
    const aligned = dstOnKpBins(bins, dstEpochs, dst);
    return analysisDomain && aligned ? [...aligned, null] : aligned;
  }, [labels, epochMs, times, dst, dstLabels, dstTimes, dstEpochMs, analysisDomain]);

  const dstScale = useMemo(() => {
    const values = (dstAligned ?? []).filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 0);
    const pad = Math.max(10, Math.round((high - low) * 0.2));
    const min = Math.min(-45, Math.floor((low - pad) / 10) * 10);
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
          backgroundColor: observed.map((value) => value != null && value >= 5 ? "#ef4444" : "#22c55e"),
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
          backgroundColor: estimated.map((value) => value != null && value >= 5 ? "#ef4444" : "#eab308"),
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
          backgroundColor: predicted.map((value) => value != null && value >= 5 ? "#ef4444" : "#38bdf8aa"),
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
    <div>{!analysisDomain && <ChartDateRange />}
    {calendar?.day && !labels.length && <p role="status">No loaded Kp observations for {calendar.day} UTC.</p>}
    <div style={{ height: 250, position: "relative" }}>
      <Chart
        type="bar"
        data={data}
        plugins={onPlotAreaChange ? [reportPlotAreaPlugin<"bar" | "line">(onPlotAreaChange)] : undefined}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          color: "#ffffff",
          animation: false,
          onClick: (event, _elements, chart) => {
            if (!analysisDomain || !onPickTime || event.x == null) return;
            if (event.x < chart.chartArea.left || event.x > chart.chartArea.right) return;
            const categoryValue = chart.scales.x.getValueForPixel(event.x);
            if (categoryValue == null || !Number.isFinite(categoryValue)) return;
            const index = Math.round(categoryValue);
            const binCount = Math.ceil((analysisDomain.max - analysisDomain.min) / KP_BIN_MS);
            if (!Number.isFinite(index) || index < 0 || index > binCount) return;
            onPickTime(Math.min(analysisDomain.max - 1, analysisDomain.min + index * KP_BIN_MS));
          },
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
              offset: analysisDomain ? false : undefined,
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
              grid: { color: "#1e3a5f", offset: analysisDomain ? false : undefined },
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
    </div></div>
  );
}
