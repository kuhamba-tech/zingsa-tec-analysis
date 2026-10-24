"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarElement,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartDataset,
  type Point,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { getIonoResponseFigures } from "@/lib/api";
import type { IonoResponseFigures, IonoResponsePoint } from "@/lib/types";

ChartJS.register(LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function epoch(time: string): number {
  return Date.parse(time);
}

function dayMonth(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}`;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function tip(point: IonoResponsePoint | undefined, observed: number | null, unit: string): string[] {
  if (!point) return [];
  const lines = [`${point.time.replace("T", " ").replace(":00Z", " UTC").replace("Z", " UTC")}`];
  if (finite(observed)) lines.push(`Observed: ${observed.toFixed(2)} ${unit}`);
  if (finite(point.ekf)) lines.push(`EKF predicted: ${point.ekf.toFixed(2)} ${unit}`);
  if (finite(point.error)) lines.push(`Difference: ${point.error.toFixed(2)} ${unit}`);
  if (finite(point.confidence)) lines.push(`Prediction confidence: ${point.confidence.toFixed(0)}%`);
  return lines;
}

function Figure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      <div className="metric-label">{title}</div>
      <div style={{ background: "#0a1929", borderRadius: 8, padding: "0.45rem 0.35rem 0.15rem", height: 360 }}>
        {children}
      </div>
    </section>
  );
}

export default function ZimbabweIonoResponseFigures() {
  const [data, setData] = useState<IonoResponseFigures | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getIonoResponseFigures(180)
        .then((payload) => {
          if (!cancelled) {
            setData(payload);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setError("Dst, Kp, and TEC-map RMSE could not be loaded.");
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const kpChart = useMemo(() => {
    if (!data) return null;
    const kp = data.kp.filter((point) => finite(point.kp) || finite(point.ekf));
    const dst = data.dst.filter((point) => finite(point.dst) || finite(point.ekf));
    if (kp.length === 0 && dst.length === 0) return null;
    return {
      kp,
      dst,
      chart: {
        datasets: [
          {
            type: "bar" as const,
            label: "Kp observed",
            data: kp.filter((point) => finite(point.kp)).map((point) => ({ x: epoch(point.time), y: point.kp as number })),
            backgroundColor: "rgba(147, 197, 253, 0.85)",
            borderWidth: 0,
            yAxisID: "y",
            barThickness: 2,
            order: 2,
          },
          {
            type: "line" as const,
            label: "Kp EKF predicted",
            data: kp.filter((point) => finite(point.ekf)).map((point) => ({ x: epoch(point.time), y: point.ekf as number })),
            borderColor: "#38bdf8",
            borderDash: [6, 4],
            borderWidth: 1.4,
            pointRadius: 0,
            yAxisID: "y",
            order: 1,
          },
          {
            type: "line" as const,
            label: "Dst observed",
            data: dst.filter((point) => finite(point.dst)).map((point) => ({ x: epoch(point.time), y: point.dst as number })),
            borderColor: "#f8fafc",
            borderWidth: 1.1,
            pointRadius: 0,
            yAxisID: "y2",
            order: 0,
          },
          {
            type: "line" as const,
            label: "Dst EKF predicted",
            data: dst.filter((point) => finite(point.ekf)).map((point) => ({ x: epoch(point.time), y: point.ekf as number })),
            borderColor: "#fde68a",
            borderDash: [6, 4],
            borderWidth: 1.4,
            pointRadius: 0,
            yAxisID: "y2",
            order: 0,
          },
        ],
      },
    };
  }, [data]);

  const rmseChart = useMemo(() => {
    if (!data || data.rmse.length === 0) return null;
    const rows = data.rmse;
    const xMin = Date.parse(`${data.start}T00:00:00Z`);
    const xMax = Date.parse(`${data.end}T23:00:00Z`);
    const datasets: ChartDataset<"scatter", Point[]>[] = [
      {
        type: "scatter",
        label: "Observed",
        data: rows.filter((point) => finite(point.rmse)).map((point) => ({ x: epoch(point.time), y: point.rmse as number })),
        backgroundColor: "rgba(226, 232, 240, 0.75)",
        pointRadius: 1.6,
        yAxisID: "y",
      },
      {
        type: "scatter",
        label: "7-day average",
        data: rows.filter((point) => finite(point.smooth)).map((point) => ({ x: epoch(point.time), y: point.smooth as number })),
        showLine: true,
        borderColor: "#ef4444",
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: "y",
      },
      {
        type: "scatter",
        label: "EKF Predicted",
        data: rows.filter((point) => finite(point.ekf)).map((point) => ({ x: epoch(point.time), y: point.ekf as number })),
        showLine: true,
        borderColor: "#fde68a",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: "y",
      },
    ];
    const guides: Array<[number | null, string, string]> = [
      [data.rmse_low, `${Number(data.rmse_low).toFixed(2)} TECU (−1.5σ)`, "#a3b15a"],
      [data.rmse_high, `${Number(data.rmse_high).toFixed(2)} TECU (+1.5σ)`, "#e879f9"],
    ];
    for (const [level, label, color] of guides) {
      if (!finite(level)) continue;
      datasets.push({
        type: "scatter",
        label,
        data: [
          { x: xMin, y: level },
          { x: xMax, y: level },
        ],
        showLine: true,
        borderColor: color,
        borderDash: [7, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: "y",
      });
    }
    return { rows, chart: { datasets } };
  }, [data]);

  const xMin = data ? Date.parse(`${data.start}T00:00:00Z`) : undefined;
  const xMax = data ? Date.parse(`${data.end}T23:00:00Z`) : undefined;
  const axis = {
    min: xMin,
    max: xMax,
    ticks: { color: "#ffffff", maxTicksLimit: 8, callback: (value: string | number) => dayMonth(Number(value)) },
    grid: { color: "rgba(148, 163, 184, 0.2)" },
    title: { display: true, text: "Day-Month", color: "#ffffff" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {error && !data && <div className="banner banner-warn">{error}</div>}
      {!data && !error && <div className="banner banner-info">Loading Dst, Kp, and TEC-map RMSE…</div>}
      {kpChart && (
        <Figure title="(a) Dst and Kp indices">
          <Chart
            type="bar"
            data={kpChart.chart}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom", labels: { color: "#ffffff", boxWidth: 12 } },
                tooltip: {
                  callbacks: {
                    title: (items) => dayMonth(Number(items[0]?.parsed.x)),
                    label: (item) => {
                      const ms = Number(item.parsed.x);
                      const unit = item.dataset.yAxisID === "y2" ? "nT" : "";
                      const pool = item.dataset.yAxisID === "y2" ? kpChart.dst : kpChart.kp;
                      const point = pool.find((row) => Math.abs(epoch(row.time) - ms) < 1000);
                      const observed = item.dataset.yAxisID === "y2" ? point?.dst ?? null : point?.kp ?? null;
                      return tip(point, finite(observed) ? observed : null, unit || "Kp");
                    },
                  },
                },
              },
              scales: {
                x: { type: "linear", ...axis },
                y: {
                  position: "left",
                  min: 0,
                  max: 9,
                  title: { display: true, text: "Kp", color: "#93c5fd" },
                  ticks: { color: "#93c5fd" },
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                },
                y2: {
                  position: "right",
                  title: { display: true, text: "Dst [nT]", color: "#f8fafc" },
                  ticks: { color: "#f8fafc" },
                  grid: { drawOnChartArea: false },
                },
              },
            }}
          />
        </Figure>
      )}
      {data && rmseChart && (
        <Figure title="(b) RMSE of TEC maps">
          <Chart
            type="scatter"
            data={rmseChart.chart}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom", labels: { color: "#ffffff", boxWidth: 12 } },
                tooltip: {
                  callbacks: {
                    title: (items) => dayMonth(Number(items[0]?.parsed.x)),
                    label: (item) => {
                      const name = item.dataset.label ?? "";
                      if (name.includes("σ")) return name;
                      const ms = Number(item.parsed.x);
                      const point = rmseChart.rows.find((row) => Math.abs(epoch(row.time) - ms) < 1000);
                      return tip(point, point?.rmse ?? null, "TECU");
                    },
                  },
                },
              },
              scales: {
                x: { type: "linear", ...axis },
                y: {
                  min: 0,
                  title: { display: true, text: "RMSE", color: "#ffffff" },
                  ticks: { color: "#ffffff" },
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                },
              },
            }}
          />
        </Figure>
      )}
      {data && !rmseChart && (
        <div className="banner banner-info">
          TEC-map RMSE is not shown. {data.note || "Live code TEC has not yet been placed at ionospheric pierce points."}
        </div>
      )}
      {data && (
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          {data.start} to {data.end}. {data.kp_source} {data.dst_source} {data.rmse_definition} {data.note}
        </p>
      )}
    </div>
  );
}
