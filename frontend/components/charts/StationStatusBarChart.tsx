"use client";

import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { StationUptimeRow } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const STATUS_COLORS = {
  online: "#00ff88",
  degraded: "#ffcc00",
  offline: "#ff7a00",
  unknown: "#94a3b8",
} as const;

interface Props {
  rows: StationUptimeRow[];
  height?: number;
}

export default function StationStatusBarChart({ rows, height = 420 }: Props) {
  const labels = rows.map((r) => r.station_code.toUpperCase());

  return (
    <div style={{ height, position: "relative" }}>
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: "Online",
              data: rows.map((r) => r.online_pct),
              backgroundColor: STATUS_COLORS.online + "dd",
              borderColor: STATUS_COLORS.online,
              borderWidth: 1,
              stack: "status",
            },
            {
              label: "Degraded",
              data: rows.map((r) => r.degraded_pct),
              backgroundColor: STATUS_COLORS.degraded + "dd",
              borderColor: STATUS_COLORS.degraded,
              borderWidth: 1,
              stack: "status",
            },
            {
              label: "Offline",
              data: rows.map((r) => r.offline_pct),
              backgroundColor: STATUS_COLORS.offline + "dd",
              borderColor: STATUS_COLORS.offline,
              borderWidth: 1,
              stack: "status",
            },
            {
              label: "Unknown",
              data: rows.map((r) => r.unknown_pct),
              backgroundColor: STATUS_COLORS.unknown + "dd",
              borderColor: STATUS_COLORS.unknown,
              borderWidth: 1,
              stack: "status",
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "top",
              labels: { color: "#ffffff", boxWidth: 14, padding: 14 },
            },
            tooltip: {
              callbacks: {
                afterTitle: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx === undefined) return "";
                  const row = rows[idx];
                  return row ? `${row.station_name} · ${row.samples} samples` : "";
                },
                label: (ctx) => {
                  const value = typeof ctx.parsed.y === "number" ? ctx.parsed.y : 0;
                  return `${ctx.dataset.label}: ${value.toFixed(1)}%`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: "#ffffff", maxRotation: 90, minRotation: 45, font: { size: 10 } },
              grid: { color: "rgba(36,77,115,0.35)" },
            },
            y: {
              stacked: true,
              min: 0,
              max: 100,
              title: { display: true, text: "% of samples (7 days)", color: "#ffffff" },
              ticks: { color: "#ffffff", callback: (v) => `${v}%` },
              grid: { color: "rgba(36,77,115,0.35)" },
            },
          },
        }}
      />
    </div>
  );
}
