"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { formatUtcDayShort } from "@/lib/chartTimeAxis";
import { getFlareMonth, getGfzKpAnalysis } from "@/lib/api";
import type { FlareMonthDay, FlareMonthResponse, GfzKpDailyPoint } from "@/lib/types";
import styles from "./SolarFlareFrequencyChart.module.css";

ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement, PointElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

function niceMax(peak: number, step: number, floor: number): number {
  if (peak <= 0) return floor;
  return Math.max(floor, Math.ceil(peak / step) * step);
}

export default function SolarFlareMonthChart({ showDailyStorms = false, start, end }: {
  showDailyStorms?: boolean;
  start?: string;
  end?: string;
}) {
  const [payload, setPayload] = useState<FlareMonthResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getFlareMonth(retry > 0, start, end)
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
  }, [retry, start, end]);

  const days = useMemo(() => {
    if (!start || !end) return payload?.days ?? [];
    const first = Date.parse(start);
    const count = Math.floor((Date.parse(end) - first) / 86_400_000) + 1;
    const byDate = new Map(payload?.days.map(day => [day.date, day]));
    return Array.from({ length: count }, (_, index) => {
      const time = first + index * 86_400_000;
      const date = new Date(time).toISOString().slice(0, 10);
      return byDate.get(date) ?? {
        date, label: formatUtcDayShort(time), c_count: null, m_count: null, x_count: null, ssn: null,
      };
    });
  }, [payload, start, end]);
  const hasSolarData = Boolean(payload?.days.length);
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
    <>
    <section className={styles.panel} aria-label="Daily solar flares and sunspot number">
      <h2 className={styles.title}>Solar flares and sunspot number</h2>
      <h3 className={styles.subtitle}>{start && end ? `${start} to ${end} UTC` : "Past month"}</h3>
      <p className={styles.copy}>
        Daily C-, M- and X-class flare counts and sunspot numbers. Blank days have no observations.
      </p>
      {loading && (
        <div className="banner banner-info" role="status">
          Loading daily flares and sunspot numbers…
        </div>
      )}
      {failed && !payload && (
        <p className={styles.copy} role="status">
          Daily flare and sunspot data could not be loaded.{" "}
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {payload && !hasSolarData && (
        <p className={styles.copy} role="status">
          No flare or sunspot observations are available for these dates.
        </p>
      )}
      {hasSolarData && (
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
    {showDailyStorms && days.length > 0 && <DailyStormChart key={`${days[0].date}/${days[days.length - 1].date}`} days={days} />}
    </>
  );
}

const STORM_BANDS = [
  { min: 0, label: "Below G1", color: "#64748b" },
  { min: 4.666, label: "G1 — Minor", color: "#fde047" },
  { min: 5.666, label: "G2 — Moderate", color: "#eab308" },
  { min: 6.666, label: "G3 — Strong", color: "#f97316" },
  { min: 7.666, label: "G4 — Severe", color: "#ef4444" },
  { min: 8.666, label: "G5 — Extreme", color: "#7f1d1d" },
];

function DailyStormChart({ days }: { days: FlareMonthDay[] }) {
  const start = days[0].date;
  const end = days[days.length - 1].date;
  const [rows, setRows] = useState<GfzKpDailyPoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getGfzKpAnalysis(start, end, undefined, false).then(({ series }) => {
      if (!cancelled) setRows(series);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [start, end, retry]);

  const peaks = useMemo(() => {
    const byDate = new Map(rows?.map(row => [row.date, row.kp_peak ?? row.kp]));
    return days.map(day => byDate.get(day.date) ?? null);
  }, [days, rows]);

  return (
    <section className={styles.panel} aria-label="Daily geomagnetic storm activity">
      <h2 className={styles.title}>Daily geomagnetic storm activity</h2>
      <p className={styles.copy}>Highest observed Kp for each UTC day in the selected window. Blank days have no Kp observations.</p>
      {!rows && !failed && <p role="status">Loading daily Kp…</p>}
      {rows && peaks.every(kp => kp == null) && <p role="status">No Kp observations are available for these dates.</p>}
      {failed && <p role="status">Daily Kp could not be loaded. <button className="btn" type="button" onClick={() => {
        setFailed(false);
        setRetry(value => value + 1);
      }}>Retry</button></p>}
      {rows && <div className={styles.chart}>
        <Chart type="bar" role="img" aria-label="Daily maximum Kp, colored by geomagnetic storm level"
          data={{
            labels: days.map(day => day.label),
            datasets: STORM_BANDS.map((band, index) => ({
              label: band.label,
              backgroundColor: band.color,
              data: peaks.map(kp => kp != null && kp >= band.min && kp < (STORM_BANDS[index + 1]?.min ?? Infinity) ? kp : null),
            })),
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} · Kp ${ctx.parsed.y?.toFixed(2)}` } },
            },
            scales: {
              x: { stacked: true, ticks: { maxRotation: 0, maxTicksLimit: 12, font: { size: 10 } }, grid: { color: "rgba(148, 163, 184, 0.18)" } },
              y: { stacked: true, min: 0, max: 9, ticks: { stepSize: 1 }, title: { display: true, text: "Daily maximum Kp" }, grid: { color: "rgba(148, 163, 184, 0.18)" } },
            },
          }}
        />
      </div>}
      <p className={styles.source}>Source: GFZ Potsdam Kp index</p>
    </section>
  );
}
