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
import { getFlareFrequencies } from "@/lib/api";
import type { FlareFrequenciesResponse } from "@/lib/types";
import styles from "./SolarFlareFrequencyChart.module.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const REFRESH_MS = 30 * 60_000;

function stamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return `${trimmed.slice(0, 10)} ${trimmed.slice(11, 16)} UTC`;
  }
  return trimmed;
}

/**
 * Yearly C/M/X flare counts with mean sunspot number — shown when the Solar Flare
 * metric card is opened. Counts refresh from NASA DONKI for recent years.
 */
export default function SolarFlareFrequencyChart() {
  const [payload, setPayload] = useState<FlareFrequenciesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (force: boolean) => {
      try {
        const next = await getFlareFrequencies(force);
        if (cancelled) return;
        setPayload(next);
        setFailed(false);
        timer = setTimeout(() => void load(true), REFRESH_MS);
      } catch {
        if (cancelled) return;
        setFailed(true);
        timer = setTimeout(() => void load(true), 60_000);
      }
    };
    void load(retry > 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [retry]);

  const points = payload?.points ?? [];
  const labels = useMemo(() => points.map((point) => String(point.year)), [points]);
  const cCounts = useMemo(() => points.map((point) => point.c_count), [points]);
  const mCounts = useMemo(() => points.map((point) => point.m_count), [points]);
  const xCounts = useMemo(() => points.map((point) => point.x_count), [points]);
  const ssn = useMemo(() => points.map((point) => point.ssn), [points]);

  const flareMax = useMemo(() => {
    let peak = 0;
    for (const point of points) {
      const total = (point.c_count ?? 0) + (point.m_count ?? 0) + (point.x_count ?? 0);
      if (total > peak) peak = total;
    }
    if (peak <= 0) return 1000;
    return Math.ceil(peak / 1000) * 1000;
  }, [points]);

  const ssnMax = useMemo(() => {
    const values = ssn.filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length) return 200;
    return Math.max(40, Math.ceil(Math.max(...values) / 40) * 40);
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
          borderColor: "#7dd3fc",
          backgroundColor: "#7dd3fc",
          borderWidth: 2,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0,
          spanGaps: false,
          yAxisID: "y1",
          order: 0,
        },
      ],
    }),
    [labels, cCounts, mCounts, xCounts, ssn],
  );

  const updated = stamp(payload?.updated_utc);
  const loading = !payload && !failed;

  return (
    <section className={styles.panel} aria-label="Solar flare frequencies">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <svg className={styles.bolt} viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path
              fill="#f87171"
              d="M13 2 4 14h6l-1 8 11-14h-7l2-6z"
            />
          </svg>
          <h2 className={styles.title}>Solar flare frequencies (C, M, and X-class)</h2>
        </div>
        <span className={styles.badge}>{updated ? `Updated ${updated}` : "Daily update"}</span>
      </header>
      <h3 className={styles.subtitle}>Number of C, M and X-class solar flares per year</h3>
      <p className={styles.copy}>
        The graph shows how many C-, M- and X-class solar flares occurred in each year, together with
        the yearly mean sunspot number. Historical years use NOAA NCEI GOES XRS reports; 2017 onward
        uses NASA DONKI so the current year keeps updating.
      </p>

      {loading && (
        <div className="banner banner-info" role="status">
          Loading yearly flare counts and sunspot numbers…
        </div>
      )}
      {failed && !payload && (
        <p className={styles.copy} role="status">
          Yearly flare frequencies could not be loaded.{" "}
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {payload && payload.mode !== "live" && (
        <div className="banner banner-info" role="status">
          {payload.note || "Yearly flare frequency series is unavailable from NOAA/NASA."}
        </div>
      )}
      {points.length > 0 && (
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
                      if (ctx.dataset.yAxisID === "y1") {
                        return `Sunspot number: ${value.toFixed(1)}`;
                      }
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
                  ticks: {
                    color: "#ffffff",
                    callback: (value) => {
                      const n = Number(value);
                      if (!Number.isFinite(n)) return "";
                      return n >= 1000 ? `${n / 1000}k` : String(n);
                    },
                  },
                  grid: { color: "rgba(148, 163, 184, 0.18)" },
                },
                y1: {
                  position: "right",
                  min: 0,
                  max: ssnMax,
                  grid: { drawOnChartArea: false },
                  title: {
                    display: true,
                    text: "Average sunspot number",
                    color: "#7dd3fc",
                    font: { size: 11, weight: "bold" },
                  },
                  ticks: { color: "#7dd3fc" },
                },
              },
            }}
          />
        </div>
      )}
      {payload?.source ? (
        <p className={styles.source}>Source: {payload.source}{payload.note ? ` · ${payload.note}` : ""}</p>
      ) : null}
    </section>
  );
}
