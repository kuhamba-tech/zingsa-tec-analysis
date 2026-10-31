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
} from "chart.js";
import { Chart } from "react-chartjs-2";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
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

function gScale(kp: number): string | null {
  if (kp >= 9) return "G5";
  if (kp >= 8) return "G4";
  if (kp >= 7) return "G3";
  if (kp >= 6) return "G2";
  if (kp >= 5) return "G1";
  return null;
}

function formatWhen(time: string): string {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return time;
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${hours}:00 UTC`;
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
  const [retry, setRetry] = useState(0);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setError(null);
      getIonoResponseFigures(180, false)
        .then((payload) => {
          if (!cancelled) {
            setData(payload);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setError("Dst and Kp could not be loaded. The data service may be temporarily unavailable.");
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [retry]);

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

  const analysis = useMemo(() => {
    if (!data || !kpChart) return { lead: "", bullets: [] as string[] };
    let peakKp: { value: number; time: string } | null = null;
    let latestKp: { value: number; time: string } | null = null;
    let pairedKp: { value: number; ekf: number; time: string } | null = null;
    let g1 = 0;
    let active = 0;
    for (const point of kpChart.kp) {
      if (!finite(point.kp)) continue;
      if (!peakKp || point.kp > peakKp.value) peakKp = { value: point.kp, time: point.time };
      latestKp = { value: point.kp, time: point.time };
      if (finite(point.ekf)) pairedKp = { value: point.kp, ekf: point.ekf, time: point.time };
      if (point.kp >= 5) g1 += 1;
      else if (point.kp >= 4) active += 1;
    }
    let lowestDst: { value: number; time: string } | null = null;
    let latestDst: { value: number; time: string } | null = null;
    let pairedDst: { value: number; ekf: number; time: string } | null = null;
    let through50 = 0;
    for (const point of kpChart.dst) {
      if (!finite(point.dst)) continue;
      if (!lowestDst || point.dst < lowestDst.value) lowestDst = { value: point.dst, time: point.time };
      latestDst = { value: point.dst, time: point.time };
      if (finite(point.ekf)) pairedDst = { value: point.dst, ekf: point.ekf, time: point.time };
      if (point.dst <= -50) through50 += 1;
    }
    const kpSentence = peakKp && latestKp
      ? `The highest observed Kp in this window is ${peakKp.value.toFixed(2)} at ${formatWhen(peakKp.time)}${gScale(peakKp.value) ? `, which reaches ${gScale(peakKp.value)} on the high-latitude scale` : ""}. The latest observed Kp is ${latestKp.value.toFixed(2)} at ${formatWhen(latestKp.time)}. ${g1} samples reach Kp 5, the G1 line. ${active} other samples are Kp 4 to just under 5, which is active and not a G-scale storm.`
      : "No observed Kp is drawn in this window.";
    const dstSentence = lowestDst && latestDst
      ? `The most negative observed Dst is ${lowestDst.value.toFixed(0)} nT at ${formatWhen(lowestDst.time)}. The latest observed Dst is ${latestDst.value.toFixed(0)} nT at ${formatWhen(latestDst.time)}. ${through50 === 0 ? "Dst does not fall through −50 nT in this window, so there is no ring-current main phase on this chart." : `${through50} Dst samples are at or below −50 nT. That is the ring-current reading. Call it a main phase only when southward Bz holds at the same time.`}`
      : "No observed Dst is drawn in this window.";
    const filterBits: string[] = [];
    if (pairedKp) {
      filterBits.push(`at ${formatWhen(pairedKp.time)} the Kp forecast is ${pairedKp.ekf.toFixed(2)}, ${Math.abs(pairedKp.value - pairedKp.ekf).toFixed(2)} from the observed Kp of ${pairedKp.value.toFixed(2)}`);
    }
    if (pairedDst) {
      filterBits.push(`at ${formatWhen(pairedDst.time)} the Dst forecast is ${pairedDst.ekf.toFixed(0)} nT, ${Math.abs(pairedDst.value - pairedDst.ekf).toFixed(0)} nT from the observed Dst of ${pairedDst.value.toFixed(0)} nT`);
    }
    const filterSentence = filterBits.length
      ? `Where the dashed forecast is drawn, ${filterBits.join(", and ")}. A one-step jump that the filter does not follow stays on the observed series.`
      : "The dashed forecast stays off until the filter has a real observed start. No prediction is invented for a series the filter cannot run.";
    return {
      lead: `This graph means the planetary magnetic response from ${data.start} to ${data.end}. The pale bars are observed Kp, from 0 to 9, on the left axis. The white line is observed Kyoto Dst, in nanotesla, on the right axis. The dashed lines are the Extended Kalman Filter forecast made before each sample is seen: blue for Kp and amber for Dst. Its importance is whether the field at Earth has already become a storm. Kp 4 is active. A G-scale rating starts at Kp 5. Zimbabwe is checked with TEC and scintillation on the CORS network.`,
      bullets: [kpSentence, dstSentence, filterSentence],
    };
  }, [data, kpChart]);

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
      {error && !data && <div className="banner banner-warn" role="status">
        {error} <button className="btn" onClick={() => setRetry((value) => value + 1)}>Retry Dst and Kp</button>
      </div>}
      {!data && !error && <div className="banner banner-info">Loading Dst and Kp…</div>}
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
      {kpChart && (
        <>
          <button
            type="button"
            onClick={() => setExplainOpen((open) => !open)}
            aria-expanded={explainOpen}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--accent)",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {explainOpen ? "Hide what this graph means" : "What this graph means"}
          </button>
          {explainOpen && (
            <ChartAnalysisBox
              block={analysis}
              title="What this graph means"
              afterLeadTitle="Scientific explanation"
            />
          )}
        </>
      )}
      {data && (
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          {data.start} to {data.end}. {data.kp_source} {data.dst_source} {data.rmse_definition} {data.note} Kp 4 is active, not a G-scale storm. Read a Dst fall through −50 nT with southward Bz as the main phase, then check whether the TEC map RMSE left its usual band.
        </p>
      )}
    </div>
  );
}
