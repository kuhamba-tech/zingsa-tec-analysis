"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { getKyotoIndices } from "@/lib/api";
import { formatUtcDayShort } from "@/lib/chartTimeAxis";
import type { KyotoResponse } from "@/lib/kyotoIndices";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const HOUR_MS = 60 * 60 * 1000;

type HourPoint = { x: number; y: number };

function hourlyMeans(payload: KyotoResponse): HourPoint[] {
  const buckets = new Map<number, number[]>();
  for (const row of payload.rows ?? []) {
    const value = row["SYM-H"];
    const ms = Date.parse(row.time);
    if (value == null || !Number.isFinite(value) || !Number.isFinite(ms)) continue;
    const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
    const values = buckets.get(hour) ?? [];
    values.push(value);
    buckets.set(hour, values);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, values]) => ({
      x: hour,
      y: values.reduce((sum, value) => sum + value, 0) / values.length,
    }));
}

/** Kyoto SYM-H under the planetary Kp bars. The ring-current index, not a second Kp trace. */
export default function SymhRingCurrentChart() {
  const [payload, setPayload] = useState<KyotoResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getKyotoIndices({ hours: 168 })
      .then((body) => {
        if (!cancelled) {
          setPayload(body);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const points = useMemo(() => (payload ? hourlyMeans(payload) : []), [payload]);
  const yPad = useMemo(() => {
    if (points.length === 0) return { min: -40, max: 20 };
    const values = points.map((point) => point.y);
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 0);
    const pad = Math.max(10, Math.round((high - low) * 0.15));
    return {
      min: Math.floor((low - pad) / 10) * 10,
      max: Math.ceil((high + pad) / 10) * 10,
    };
  }, [points]);

  return (
    <div style={{ marginTop: "0.85rem" }}>
      <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.15rem" }}>
        SYM-H (nT) — ring current
      </div>
      <p style={{ margin: "0 0 0.4rem", fontSize: "0.72rem", color: "#ffffff", lineHeight: 1.4 }}>
        Hourly mean of Kyoto minute SYM-H
        {payload?.start && payload?.end ? ` from ${payload.start.replace("T", " ").replace("Z", " UTC")} to ${payload.end.replace("T", " ").replace("Z", " UTC")}` : ""}, drawn under the Kp bars. SYM-H is the symmetric
        horizontal disturbance from the magnetospheric ring current. It is not Kp. An hour
        with no Kyoto sample is left open.
        {payload?.publication_warning ? ` ${payload.publication_warning}` : ""}
      </p>
      {failed && (
        <div className="banner banner-warn">SYM-H could not be loaded from Kyoto. No substitute series is drawn.</div>
      )}
      {!failed && payload == null && (
        <div className="banner banner-info" role="status">Loading Kyoto SYM-H…</div>
      )}
      {!failed && payload != null && points.length === 0 && (
        <div className="banner banner-info">Kyoto returned no SYM-H samples for this window.</div>
      )}
      {points.length > 0 && (
        <div style={{ height: 220, position: "relative" }}>
          <Line
            data={{
              datasets: [{
                label: "SYM-H",
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
                      if (!Number.isFinite(ms)) return "";
                      return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
                    },
                    label: (item) => {
                      const value = item.parsed.y;
                      return value == null ? "SYM-H: —" : `SYM-H: ${value.toFixed(1)} nT`;
                    },
                  },
                },
              },
              scales: {
                x: {
                  type: "linear",
                  min: points[0].x,
                  max: points[points.length - 1].x,
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
                  title: { display: true, text: "SYM-H (nT)", color: "#ffffff", font: { weight: "bold" } },
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
