"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { getStormDays } from "@/lib/api";
import type { StormDaysResponse } from "@/lib/types";
import styles from "./SolarFlareFrequencyChart.module.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const BANDS = [
  { key: "g1", label: "G1 — Minor", color: "#fde047" },
  { key: "g2", label: "G2 — Moderate", color: "#eab308" },
  { key: "g3", label: "G3 — Strong", color: "#f97316" },
  { key: "g4", label: "G4 — Severe", color: "#ef4444" },
  { key: "g5", label: "G5 — Extreme", color: "#7f1d1d" },
] as const;

/**
 * Yearly G1–G5 storm days from the GFZ Kp record. Shown when the Geomagnetic
 * Storms card is opened.
 */
export default function GeomagneticStormDaysChart() {
  const [payload, setPayload] = useState<StormDaysResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getStormDays(retry > 0)
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

  const years = payload?.years ?? [];
  const labels = useMemo(() => years.map((row) => String(row.year)), [years]);
  const data = useMemo(
    () => ({
      labels,
      datasets: BANDS.map((band) => ({
        label: band.label,
        data: years.map((row) => row[band.key]),
        backgroundColor: band.color,
        borderSkipped: false,
        stack: "storms",
      })),
    }),
    [labels, years],
  );

  const stormMax = useMemo(() => {
    let peak = 0;
    for (const row of years) {
      const total = row.g1 + row.g2 + row.g3 + row.g4 + row.g5;
      if (total > peak) peak = total;
    }
    if (peak <= 0) return 50;
    return Math.ceil(peak / 25) * 25;
  }, [years]);

  const loading = !payload && !failed;

  return (
    <section className={styles.panel} aria-label="Geomagnetic storm days per year">
      <h2 className={styles.title}>Geomagnetic storm days per year</h2>
      <h3 className={styles.subtitle}>Number of days with a geomagnetic storm per year</h3>
      <p className={styles.copy}>
        The graph shows how many days in each year reached a geomagnetic storm, and how strong the
        strongest interval that day was. A day is counted once. G1 begins when the day’s highest Kp
        reaches 5−. The latest year includes only the days recorded so far.
      </p>
      {loading && (
        <div className="banner banner-info" role="status">
          Loading geomagnetic storm days from the GFZ Kp record…
        </div>
      )}
      {failed && !payload && (
        <p className={styles.copy} role="status">
          The storm-day chart could not be loaded.{" "}
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {payload && years.length === 0 && (
        <p className={styles.copy} role="status">
          The storm-day chart is unavailable.
        </p>
      )}
      {years.length > 0 && (
        <div className={styles.chart}>
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
                  position: "bottom",
                  labels: { color: "#ffffff", boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                  callbacks: {
                    footer: (items) => {
                      const total = items.reduce((sum, item) => sum + (Number(item.parsed.y) || 0), 0);
                      return `Storm days: ${total}`;
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
                    maxTicksLimit: 16,
                    font: { size: 10 },
                  },
                  grid: { color: "rgba(148, 163, 184, 0.18)" },
                },
                y: {
                  stacked: true,
                  min: 0,
                  max: stormMax,
                  title: {
                    display: true,
                    text: "Days with geomagnetic storms ≥ Kp 5",
                    color: "#ffffff",
                    font: { size: 11, weight: "bold" },
                  },
                  ticks: { color: "#ffffff" },
                  grid: { color: "rgba(148, 163, 184, 0.18)" },
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
