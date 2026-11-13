"use client";

import { useEffect, useMemo, useState } from "react";
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
import { getFlareMonth } from "@/lib/api";
import type { FlareMonthResponse } from "@/lib/types";
import styles from "./SolarFlareFrequencyChart.module.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

function niceMax(peak: number, step: number, floor: number): number {
  if (peak <= 0) return floor;
  return Math.max(floor, Math.ceil(peak / step) * step);
}

/**
 * Past-month daily C/M/X flares with the sunspot number. Shown when the
 * Solar Flare card is opened. Values come from NOAA's daily solar file.
 */
export default function SolarFlareMonthChart() {
  const [payload, setPayload] = useState<FlareMonthResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getFlareMonth(retry > 0)
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const days = payload?.days ?? [];
  const labels = useMemo(() => days.map((day) => day.label), [days]);
  const cCounts = useMemo(() => days.map((day) => day.c_count), [days]);
  const mCounts = useMemo(() => days.map((day) => day.m_count), [days]);
  const xCounts = useMemo(() => days.map((day) => day.x_count), [days]);
  const ssn = useMemo(() => days.map((day) => day.ssn), [days]);

  const flareMax = useMemo(() => {
    let peak = 0;
    for (const day of days) {
      const total = (day.c_count ?? 0) + (day.m_count ?? 0) + (day.x_count ?? 0);
      if (total > peak) peak = total;
    }
    return niceMax(peak, 8, 8);
  }, [days]);

  const ssnMax = useMemo(() => {
    const values = ssn.filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length) return 150;
    return niceMax(Math.max(...values), 30, 60);
  }, [ssn]);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "C-flares",
          data: cCounts,
          backgroundColor: "#f59e0b",
          borderSkipped: false,
          stack: "flares",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "M-flares",
          data: mCounts,
          backgroundColor: "#ef4444",
          borderSkipped: false,
          stack: "flares",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "X-flares",
          data: xCounts,
          backgroundColor: "#7f1d1d",
          borderSkipped: false,
          stack: "flares",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Sunspot number",
          data: ssn,
          borderColor: "#38bdf8",
          backgroundColor: "#38bdf8",
          borderWidth: 2,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.15,
          spanGaps: false,
          yAxisID: "y1",
          order: 0,
        },
      ],
    }),
    [labels, cCounts, mCounts, xCounts, ssn],
  );

  const loading = !payload && !failed;

  return (
    <section className={styles.panel} aria-label="Solar flares and sunspot number for the past month">
      <h2 className={styles.title}>Solar flares and sunspot number, past month</h2>
      <h3 className={styles.subtitle}>Number of C-, M- and X-class flares of the last month</h3>
      <p className={styles.copy}>
        The graph shows how many C-, M- and X-class solar flares occurred on each day of the past
        month, together with the daily sunspot number.
      </p>
      {loading && (
        <div className="banner banner-info" role="status">
          Loading the past month of flares and sunspot numbers…
        </div>
      )}
      {failed && !payload && (
        <p className={styles.copy} role="status">
          The past-month flare chart could not be loaded.{" "}
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {payload && days.length === 0 && (
        <p className={styles.copy} role="status">
          The past-month flare chart is unavailable.
        </p>
      )}
      {days.length > 0 && (
        <div className={styles.chart}>
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
                  position: "bottom",
                  labels: { color: "#ffffff", boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const value = ctx.parsed.y;
                      if (value == null || Number.isNaN(value)) return `${ctx.dataset.label}: —`;
                      if (ctx.dataset.yAxisID === "y1") return `Sunspot number: ${Math.round(value)}`;
                      return `${ctx.dataset.label}: ${Math.round(value)}`;
                    },
                  },
                },
              },
              scales: {
                x: {
                  stacked: true,
                  ticks: {
                    color: "#ffffff",
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 12,
                    font: { size: 10 },
                  },
                  grid: { color: "rgba(148, 163, 184, 0.18)" },
                },
                y: {
                  stacked: true,
                  min: 0,
                  max: flareMax,
                  title: {
                    display: true,
                    text: "Number of flares",
                    color: "#ffffff",
                    font: { size: 11, weight: "bold" },
                  },
                  ticks: { color: "#ffffff" },
                  grid: { color: "rgba(148, 163, 184, 0.18)" },
                },
                y1: {
                  position: "right",
                  min: 0,
                  max: ssnMax,
                  grid: { drawOnChartArea: false },
                  title: {
                    display: true,
                    text: "Sunspot number",
                    color: "#38bdf8",
                    font: { size: 11, weight: "bold" },
                  },
                  ticks: { color: "#38bdf8" },
                },
              },
            }}
          />
        </div>
      )}
      {payload?.source ? <p className={styles.source}>Source: {payload.source}</p> : null}
    </section>
  );
}
