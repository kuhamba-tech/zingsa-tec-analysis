"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { seriesEpochsFromApi, formatUtcDayShort } from "@/lib/chartTimeAxis";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

type Point = { x: number; y: number | null };

type Props = {
  dst?: (number | null)[];
  labels?: string[];
  times?: string[];
  epochMs?: (number | null)[];
};

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/** Live ring current under the planetary Kp bars. Hourly Kyoto Dst from NOAA, not a second Kp trace. */
export default function SymhRingCurrentChart({ dst, labels, times, epochMs }: Props) {
  const points = useMemo(() => {
    const values = dst ?? [];
    const stamps = labels ?? times ?? [];
    const epochs = seriesEpochsFromApi(stamps.length ? stamps : values.map(() => ""), epochMs, times);
    if (!epochs || epochs.length !== values.length) return [];
    return epochs.map((ms, index) => {
      const value = values[index];
      const y = value == null || !Number.isFinite(value) ? null : value;
      return { x: ms, y } satisfies Point;
    });
  }, [dst, labels, times, epochMs]);

  const measured = useMemo(() => points.filter((point) => point.y != null), [points]);
  const yPad = useMemo(() => {
    if (measured.length === 0) return { min: -40, max: 20 };
    const values = measured.map((point) => point.y as number);
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 0);
    const pad = Math.max(10, Math.round((high - low) * 0.15));
    return {
      min: Math.floor((low - pad) / 10) * 10,
      max: Math.ceil((high + pad) / 10) * 10,
    };
  }, [measured]);

  const first = measured[0];
  const last = measured[measured.length - 1];

  return (
    <div style={{ marginTop: "0.85rem" }}>
      <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.15rem" }}>
        Dst (nT) — ring current
      </div>
      <p style={{ margin: "0 0 0.4rem", fontSize: "0.72rem", color: "#ffffff", lineHeight: 1.4 }}>
        Hourly Kyoto Dst relayed by NOAA SWPC
        {first && last ? `, from ${formatUtc(first.x)} to ${formatUtc(last.x)}` : ""}. Dst is the
        ring-current index. Kyoto does not publish minute SYM-H until about a month later, so the
        live line is this hourly Dst. It is not Kp. An hour with no Dst value is left open.
      </p>
      {measured.length === 0 && (
        <div className="banner banner-info">
          NOAA has not returned Kyoto Dst for this window. No substitute ring-current line is drawn.
        </div>
      )}
      {measured.length > 0 && (
        <div style={{ height: 220, position: "relative" }}>
          <Line
            data={{
              datasets: [{
                label: "Dst",
                data: points,
                borderColor: "#38bdf8",
                backgroundColor: "#38bdf8",
                borderWidth: 1.75,
                pointRadius: 0,
                tension: 0,
                spanGaps: false,
              }],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              color: "#ffffff",
              animation: false,
              plugins: {
                legend: { labels: { color: "#ffffff", boxWidth: 12, font: { size: 10 } } },
                tooltip: {
                  callbacks: {
                    title: (items) => {
                      const ms = Number(items[0]?.parsed.x);
                      return Number.isFinite(ms) ? formatUtc(ms) : "";
                    },
                    label: (item) => {
                      const value = item.parsed.y;
                      return value == null ? "Dst: —" : `Dst: ${value.toFixed(0)} nT`;
                    },
                  },
                },
              },
              scales: {
                x: {
                  type: "linear",
                  min: measured[0].x,
                  max: measured[measured.length - 1].x,
                  title: { display: true, text: "UTC", color: "#ffffff", font: { size: 11 } },
                  ticks: {
                    color: "#ffffff",
                    maxTicksLimit: 8,
                    callback: (value) => formatUtcDayShort(Number(value)),
                  },
                  grid: { color: "#1e3a5f" },
                },
                y: {
                  min: yPad.min,
                  max: yPad.max,
                  title: { display: true, text: "Dst (nT)", color: "#ffffff", font: { weight: "bold" } },
                  ticks: { color: "#ffffff" },
                  grid: { color: "#1e3a5f" },
                },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}
