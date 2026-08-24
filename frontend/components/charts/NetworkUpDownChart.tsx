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
import type { StationUptimeTimelinePoint } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface Props {
  points: StationUptimeTimelinePoint[];
  height?: number;
  /** When true, chart title refers to a single station's up/down samples. */
  singleStation?: boolean;
}

/** Stacked bars: green = online sites/samples, red = offline, grey = unknown. */
export default function NetworkUpDownChart({ points, height = 280, singleStation = false }: Props) {
  const labels = useMemo(
    () => points.map((p) => p.time.slice(0, 16).replace("T", " ")),
    [points],
  );

  const chart = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: singleStation ? "Online samples" : "Online sites",
          data: points.map((p) => p.online_count),
          backgroundColor: "rgba(0, 255, 136, 0.85)",
          stack: "status",
        },
        {
          label: singleStation ? "Offline samples" : "Offline sites",
          data: points.map((p) => p.offline_count),
          backgroundColor: "rgba(255, 68, 68, 0.85)",
          stack: "status",
        },
        {
          label: "Unknown",
          data: points.map((p) => p.unknown_count),
          backgroundColor: "rgba(148, 163, 184, 0.75)",
          stack: "status",
        },
      ],
    }),
    [labels, points, singleStation],
  );

  if (!points.length) return null;

  return (
    <div style={{ height }}>
      <Bar
        data={chart}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top" as const,
              labels: { color: "#cbd5e1", boxWidth: 12, font: { size: 11 } },
            },
            tooltip: {
              callbacks: {
                footer: (items) => {
                  const idx = items[0]?.dataIndex ?? 0;
                  const p = points[idx];
                  if (!p) return "";
                  return `Uptime: ${p.online_pct.toFixed(1)}% · ${p.samples} samples`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: "#94a3b8", maxRotation: 45, minRotation: 0, font: { size: 10 } },
              grid: { color: "rgba(36, 77, 115, 0.35)" },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              title: {
                display: true,
                text: singleStation ? "Status samples per bucket" : "Station count per bucket",
                color: "#94a3b8",
                font: { size: 11 },
              },
              ticks: { color: "#94a3b8", precision: 0 },
              grid: { color: "rgba(36, 77, 115, 0.35)" },
            },
          },
        }}
      />
    </div>
  );
}
