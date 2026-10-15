"use client";

import { useMemo } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { formatUtcDayLabel, seriesEpochsFromApi } from "@/lib/chartTimeAxis";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

function formatKpUtcBinLabel(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${formatUtcDayLabel(ms).replace(/ \d{4}$/, "")} ${hh}Z`;
}

/** Kp forecast bars — split from HeliosphericMonitorStack so Chart.js Bar is one async chunk. */
export default function HeliosphericKpBars({
  labels,
  times,
  epochMs,
  observed,
  estimated,
  predicted,
}: {
  labels: string[];
  times?: string[];
  epochMs?: (number | null)[];
  observed: (number | null)[];
  estimated: (number | null)[];
  predicted: (number | null)[];
}) {
  const utcLabels = useMemo(() => {
    const epochs = seriesEpochsFromApi(labels, epochMs, times);
    if (epochs) return epochs.map(formatKpUtcBinLabel);
    return labels.map((l) => (/Z\b/i.test(l) ? l : `${l}Z`));
  }, [labels, epochMs, times]);

  const data = useMemo(
    () => ({
      labels: utcLabels,
      datasets: [
        {
          label: "Observed Kp",
          data: observed,
          backgroundColor: "#22c55e",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
        {
          label: "Estimated Kp",
          data: estimated,
          backgroundColor: "#eab308",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
        {
          label: "NOAA predicted Kp",
          data: predicted,
          backgroundColor: "#38bdf8aa",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
      ],
    }),
    [utcLabels, observed, estimated, predicted],
  );

  return (
    <div style={{ height: 220, position: "relative" }}>
      <Bar
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
                  return v == null ? `${ctx.dataset.label}: —` : `${ctx.dataset.label}: ${v.toFixed(2)}`;
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
          },
        }}
      />
    </div>
  );
}
