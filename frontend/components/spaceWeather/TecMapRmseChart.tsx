"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  rmseHistogramExplanation,
  rmseHourExplanation,
  rmseTimeExplanation,
} from "@/lib/matambaChartExplanation";
import type { IonoResponseFigures } from "@/lib/types";
import MatambaChartPanel from "./MatambaChartPanel";

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

/** Keep the cloud readable. The same step is applied to every series. */
function stride<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const step = Math.ceil(rows.length / limit);
  const kept = rows.filter((_, index) => index % step === 0);
  const last = rows[rows.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

type RmseSample = { rmse: number; hour: number };

/** Sample standard deviation of ln(RMSE), then the paper's exp(μ ± 1.5 s) lines. */
function lognormalFit(values: number[]) {
  const positive = values.filter((value) => value > 0);
  if (positive.length < 8) return null;
  const logs = positive.map((value) => Math.log(value));
  const muLn = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const variance = logs.reduce((sum, value) => sum + (value - muLn) ** 2, 0) / (logs.length - 1);
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  return {
    muLn,
    sigma,
    mean: Math.exp(muLn + (sigma * sigma) / 2),
    low: Math.exp(muLn - 1.5 * sigma),
    high: Math.exp(muLn + 1.5 * sigma),
    n: positive.length,
  };
}

function lognormalPdf(x: number, muLn: number, sigma: number): number {
  if (x <= 0) return 0;
  const z = (Math.log(x) - muLn) / sigma;
  return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
}

function histogramBins(values: number[], binWidth: number) {
  const max = Math.max(...values, binWidth);
  const count = Math.max(1, Math.ceil(max / binWidth));
  const bins = Array.from({ length: count }, (_, index) => ({
    x: (index + 0.5) * binWidth,
    y: 0,
    from: index * binWidth,
    to: (index + 1) * binWidth,
  }));
  for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(value / binWidth)));
    bins[index].y += 1;
  }
  return bins;
}

function lineWithGaps(points: Point[], gapMs = 6 * 60 * 60 * 1000): Point[] {
  const out: Point[] = [];
  let previous: number | null = null;
  for (const point of points) {
    const x = typeof point.x === "number" ? point.x : null;
    if (x == null) continue;
    if (previous != null && x - previous > gapMs) out.push({ x: previous + 1, y: Number.NaN });
    out.push(point);
    previous = x;
  }
  return out;
}

/**
 * Matamba and Danskin (2022) RMSE of TEC maps, on the Zimbabwe ionospheric response tab.
 * Each point is the 1° median-filtered grid minus the original code TEC at the pierce points.
 */
export default function TecMapRmseChart() {
  const [data, setData] = useState<IonoResponseFigures | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getIonoResponseFigures(180)
        .then((payload) => {
          if (cancelled) return;
          setData(payload);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError("TEC map RMSE could not be calculated.");
        });
    };
    load();
    const timer = window.setInterval(load, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const chart = useMemo(() => {
    const rows = stride((data?.rmse ?? []).filter((point) => finite(point.rmse)), 3500);
    if (rows.length === 0) return null;
    const times = rows.map((point) => epoch(point.time)).filter((value) => Number.isFinite(value));
    const xMin = Math.min(...times);
    const xMax = Math.max(...times);
    const observed = rows.map((point) => point.rmse as number);
    const yMax = Math.max(5, Math.ceil(Math.max(...observed) + 0.4));
    const datasets: ChartDataset<"line" | "scatter", Point[]>[] = [
      {
        type: "scatter",
        label: "RMSE",
        data: rows.map((point) => ({ x: epoch(point.time), y: point.rmse as number })),
        backgroundColor: "rgba(226, 232, 240, 0.72)",
        pointRadius: 1.5,
        yAxisID: "y",
      },
      {
        type: "line",
        label: "7-day average",
        data: rows
          .filter((point) => finite(point.smooth))
          .map((point) => ({ x: epoch(point.time), y: point.smooth as number })),
        borderColor: "#ef4444",
        borderWidth: 2,
        pointRadius: 0,
        spanGaps: true,
        yAxisID: "y",
      },
    ];
    const ekfLine = lineWithGaps(
      rows
        .filter((point) => finite(point.ekf))
        .map((point) => ({ x: epoch(point.time), y: point.ekf as number })),
    ).filter((point) => Number.isFinite(point.y));
    if (ekfLine.length > 0) {
      datasets.push({
        type: "line",
        label: "EKF Predicted",
        data: lineWithGaps(
          rows
            .filter((point) => finite(point.ekf))
            .map((point) => ({ x: epoch(point.time), y: point.ekf as number })),
        ),
        borderColor: "#fde68a",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: false,
        yAxisID: "y",
      });
    }
    const guides: Array<[number | null, string, string]> = [
      [data?.rmse_low ?? null, "−1.5σ", "#c4b15a"],
      [data?.rmse_high ?? null, "+1.5σ", "#c084fc"],
    ];
    for (const [level, label, color] of guides) {
      if (!finite(level)) continue;
      datasets.push({
        type: "line",
        label: `${level.toFixed(2)} TECU (${label})`,
        data: [
          { x: xMin, y: level },
          { x: xMax, y: level },
        ],
        borderColor: color,
        borderDash: [7, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        yAxisID: "y",
      });
    }
    return { datasets, xMin, xMax, yMax };
  }, [data]);

  const histograms = useMemo(() => {
    const samples: RmseSample[] = [];
    for (const point of data?.rmse ?? []) {
      if (!finite(point.rmse) || point.rmse <= 0) continue;
      const ms = epoch(point.time);
      if (!Number.isFinite(ms)) continue;
      samples.push({ rmse: point.rmse, hour: new Date(ms).getUTCHours() });
    }
    const fit = lognormalFit(samples.map((sample) => sample.rmse));
    if (!fit || samples.length === 0) return null;
    const maxRmse = Math.max(...samples.map((sample) => sample.rmse));
    const binWidth = maxRmse <= 6 ? 0.1 : maxRmse <= 12 ? 0.25 : 0.5;
    const bins = histogramBins(samples.map((sample) => sample.rmse), binWidth);
    const xMax = Math.max(binWidth * bins.length, fit.high * 1.05);
    const curve: Array<{ x: number; y: number }> = [];
    const steps = 160;
    for (let step = 1; step <= steps; step += 1) {
      const x = (step / steps) * xMax;
      curve.push({ x, y: lognormalPdf(x, fit.muLn, fit.sigma) * fit.n * binWidth });
    }
    const peak = Math.max(...bins.map((bin) => bin.y), ...curve.map((point) => point.y), 1);
    const hourPanel = (predicate: (rmse: number) => boolean) => {
      const counts = Array.from({ length: 24 }, () => 0);
      for (const sample of samples) {
        if (predicate(sample.rmse)) counts[sample.hour] += 1;
      }
      const total = counts.reduce((sum, count) => sum + count, 0);
      return {
        total,
        bars: counts.map((count, hour) => ({ x: hour + 0.5, y: total > 0 ? count / total : 0, count, hour })),
      };
    };
    return {
      fit,
      binWidth,
      xMax,
      yMax: peak * 1.12,
      bins,
      curve,
      below: hourPanel((rmse) => rmse < fit.low),
      above: hourPanel((rmse) => rmse > fit.high),
    };
  }, [data]);

  return (
    <section className="matamba-figures">
      <div className="matamba-figures-title">RMSE of TEC maps</div>
      <div className="matamba-figures-note">
        Matamba and Danskin (2022): 1° nearest-neighbour map after a size-7 median filter, minus the
        original code TEC at each pierce point. Each point uses the previous 15 minutes. Hours
        without enough pierce points stay empty. The red curve is the 7-day average and continues
        across those hours. The dashed line is the EKF forecast and restarts after a gap longer
        than six hours. Olive and purple lines are the log-normal −1.5σ and +1.5σ.
        Click a graph for the Matamba and Danskin explanation.
      </div>
      {!data && !error && (
        <div className="banner banner-info" role="status">Calculating TEC map RMSE…</div>
      )}
      {error && !chart && <div className="banner banner-warn">{error}</div>}
      {data && !chart && (
        <div className="banner banner-info">
          {data.note || "No pierce-point maps yet. Hours without code TEC stay empty."}
        </div>
      )}
      {chart && (
        <MatambaChartPanel label="RMSE of TEC maps" analysis={rmseTimeExplanation()}>
        <div className="matamba-chart matamba-chart--rmse">
          <Chart
            type="scatter"
            data={{ datasets: chart.datasets }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              color: "#ffffff",
              animation: false,
              plugins: {
                legend: {
                  display: true,
                  labels: { color: "#ffffff", boxWidth: 12, font: { size: 10 } },
                },
                tooltip: {
                  callbacks: {
                    title: (items) => {
                      const ms = Number(items[0]?.parsed.x);
                      if (!Number.isFinite(ms)) return "";
                      return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
                    },
                    label: (item) => {
                      const value = item.parsed.y;
                      if (value == null || Number.isNaN(value)) return item.dataset.label ?? "";
                      return `${item.dataset.label}: ${value.toFixed(2)} TECU`;
                    },
                  },
                },
              },
              scales: {
                x: {
                  type: "linear",
                  min: chart.xMin,
                  max: chart.xMax,
                  ticks: {
                    color: "#ffffff",
                    maxTicksLimit: 8,
                    callback: (value) => dayMonth(Number(value)),
                  },
                  title: { display: true, text: "Day-Month", color: "#ffffff", font: { size: 11, weight: "bold" } },
                  grid: { color: "#1e3a5f" },
                },
                y: {
                  min: 0,
                  max: chart.yMax,
                  title: { display: true, text: "RMSE", color: "#ffffff", font: { weight: "bold" } },
                  ticks: { color: "#ffffff" },
                  grid: { color: "#1e3a5f" },
                },
              },
            }}
          />
        </div>
        </MatambaChartPanel>
      )}
      {histograms && (
        <div className="matamba-figure-stack">
          <MatambaChartPanel
            label="Histogram of RMSE"
            analysis={rmseHistogramExplanation(histograms.fit)}
          >
            <div className="matamba-chart matamba-chart--hist">
            <Chart
              type="bar"
              data={{
                datasets: [
                  {
                    type: "bar" as const,
                    label: "Count",
                    data: histograms.bins,
                    backgroundColor: "rgba(45, 212, 191, 0.85)",
                    borderWidth: 0,
                    barPercentage: 1,
                    categoryPercentage: 1,
                    order: 2,
                  },
                  {
                    type: "line" as const,
                    label: "Log-normal fit",
                    data: histograms.curve,
                    borderColor: "#ef4444",
                    borderWidth: 2,
                    pointRadius: 0,
                    order: 1,
                  },
                  {
                    type: "line" as const,
                    label: `${histograms.fit.low.toFixed(2)} TECU`,
                    data: [{ x: histograms.fit.low, y: 0 }, { x: histograms.fit.low, y: histograms.yMax }],
                    borderColor: "#c4b15a",
                    borderDash: [5, 4],
                    borderWidth: 1.6,
                    pointRadius: 0,
                    order: 0,
                  },
                  {
                    type: "line" as const,
                    label: `${histograms.fit.high.toFixed(2)} TECU`,
                    data: [{ x: histograms.fit.high, y: 0 }, { x: histograms.fit.high, y: histograms.yMax }],
                    borderColor: "#c084fc",
                    borderDash: [5, 4],
                    borderWidth: 1.6,
                    pointRadius: 0,
                    order: 0,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                  legend: { labels: { color: "#ffffff", boxWidth: 12, font: { size: 10 } } },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        const bin = histograms.bins[items[0]?.dataIndex ?? -1];
                        return bin ? `${bin.from.toFixed(2)}–${bin.to.toFixed(2)} TECU` : "";
                      },
                      label: (item) => item.dataset.type === "bar"
                        ? `Count: ${item.parsed.y}`
                        : `${item.dataset.label}`,
                    },
                  },
                },
                scales: {
                  x: {
                    type: "linear",
                    min: 0,
                    max: histograms.xMax,
                    title: { display: true, text: "RMSE of fit to TEC maps", color: "#ffffff", font: { size: 11, weight: "bold" } },
                    ticks: { color: "#ffffff" },
                    grid: { color: "#1e3a5f" },
                  },
                  y: {
                    min: 0,
                    suggestedMax: histograms.yMax,
                    title: { display: true, text: "Count", color: "#ffffff", font: { weight: "bold" } },
                    ticks: { color: "#ffffff" },
                    grid: { color: "#1e3a5f" },
                  },
                },
              }}
            />
            </div>
            <div className="matamba-figures-caption">
              (a) Histogram of RMSE; points = {histograms.fit.n}. μ = {histograms.fit.mean.toFixed(2)} is the mean of the log-normal fit, s = {histograms.fit.sigma.toFixed(2)} is the standard deviation of ln(RMSE). Dashed lines are exp(μ<sub>ln</sub> ± 1.5 s).
            </div>
          </MatambaChartPanel>
          <div className="matamba-hour-grid">
            {([
              ["(b)", `RMSE < ${histograms.fit.low.toFixed(2)}`, histograms.below, "rgba(163, 177, 90, 0.9)"],
              ["(c)", `RMSE > ${histograms.fit.high.toFixed(2)}`, histograms.above, "rgba(192, 38, 211, 0.85)"],
            ] as const).map(([panel, title, series, color]) => (
              <MatambaChartPanel
                key={panel}
                label={`Histogram of ${title}`}
                analysis={rmseHourExplanation(panel === "(b)" ? "low" : "high", panel === "(b)" ? histograms.fit.low : histograms.fit.high, series.total)}
              >
                <div className="matamba-chart matamba-chart--hour">
                <Chart
                  type="bar"
                  data={{
                    datasets: [{
                      label: "Normalized count",
                      data: series.bars,
                      backgroundColor: color,
                      borderWidth: 0,
                      barPercentage: 1,
                      categoryPercentage: 1,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          title: (items) => {
                            const hour = series.bars[items[0]?.dataIndex ?? -1]?.hour;
                            return hour == null ? "" : `${String(hour).padStart(2, "0")}–${String(hour + 1).padStart(2, "0")} UT`;
                          },
                          label: (item) => {
                            const bar = series.bars[item.dataIndex];
                            const fraction = item.parsed.y;
                            const shown = fraction == null ? "—" : fraction.toFixed(3);
                            return `Fraction: ${shown} (${bar?.count ?? 0} maps)`;
                          },
                        },
                      },
                    },
                    scales: {
                      x: {
                        type: "linear",
                        min: 0,
                        max: 24,
                        title: { display: true, text: "Hour of RMSE [UT]", color: "#ffffff", font: { size: 11, weight: "bold" } },
                        ticks: { color: "#ffffff", stepSize: 3 },
                        grid: { color: "#1e3a5f" },
                      },
                      y: {
                        min: 0,
                        title: { display: true, text: "Fraction", color: "#ffffff", font: { size: 11, weight: "bold" } },
                        ticks: { color: "#ffffff" },
                        grid: { color: "#1e3a5f" },
                      },
                    },
                  }}
                />
                </div>
                <div className="matamba-figures-caption">
                  {panel} Histogram of {title}; points = {series.total}
                </div>
              </MatambaChartPanel>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
