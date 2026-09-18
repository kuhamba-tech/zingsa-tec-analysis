"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LogarithmicScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { Chart as ChartInstance } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface PointMeta {
  error?: number | null;
  confidence?: number | null;
}

interface Dataset {
  label: string;
  data: (number | null)[];
  color?: string;
  fill?: boolean;
  dashed?: boolean;
  meta?: (PointMeta | null)[];
  /** Chart.js y-axis id — use "y2"/"y3" for secondary/tertiary scales. */
  yAxisId?: "y" | "y2" | "y3";
  /** Set false for PRN arcs where nulls mark real observation gaps. */
  spanGaps?: boolean;
}

interface ThresholdLine {
  value: number;
  label: string;
  color?: string;
  /** Shade the band above this line (e.g. fast-stream region ≥ 500 km/s). */
  fillAbove?: boolean;
}

interface Props {
  labels: string[];
  datasets: Dataset[];
  yLabel?: string;
  height?: number;
  threshold?: ThresholdLine;
  /** Multiple horizontal reference lines (e.g. Moderate/High/Extreme bands). */
  thresholds?: ThresholdLine[];
  highlightDates?: string[];
  tooltipDetails?: (string | null)[];
  tooltipDetailLabel?: string;
  /** Smaller charts — larger points and nearest-point hover for report mini charts. */
  compact?: boolean;
  /** Right-hand Y-axis label when any dataset uses yAxisId "y2". */
  secondaryYLabel?: string;
  /** Extra right-hand axis for a third scale (e.g. proton temperature in K). */
  tertiaryYLabel?: string;
  /** Checkbox legend — show/hide individual series. */
  toggleableLegend?: boolean;
  /**
   * Numeric x-values parallel to `labels`/each dataset's `data`. When set,
   * the x-axis switches from the default category scale (ticks at
   * evenly-spaced array indices) to a linear numeric scale (ticks at
   * evenly-spaced real values) — for irregularly-sampled series (e.g. real
   * GPS epochs across a day) the category scale's index-based ticks land on
   * odd values instead of round hours.
   */
  xValues?: number[];
  /** X-axis title, e.g. "UT (hrs)". Only used together with `xValues`. */
  xLabel?: string;
  xMin?: number;
  xMax?: number;
  xStepSize?: number;
  /** Format numeric x-axis tick labels (used with `xValues`). */
  formatXTick?: (value: number) => string;
  /**
   * When set with hourly `xStepSize`, only these hours get strong grid lines;
   * other hourly ticks stay as faint demarcations (KNMI-style).
   */
  xMajorStepMs?: number;
  /** Epoch milliseconds parallel to labels — enables shared crosshair sync. */
  epochMs?: (number | null)[];
  /** Shared hover time (epoch ms) drawn as a vertical cursor across synced charts. */
  syncHoverMs?: number | null;
  /** Report hover time so sibling charts can draw the same vertical cursor. */
  onSyncHoverMs?: (ms: number | null) => void;
  /** Optional log scale for Y (e.g. GOES X-ray W/m²). */
  yLogScale?: boolean;
  /** Hard / suggested primary Y bounds (e.g. solar-wind speed to show Fast stream). */
  yMin?: number;
  yMax?: number;
  ySuggestedMin?: number;
  ySuggestedMax?: number;
}

function DatasetToggleLegend({
  datasets,
  visible,
  onToggle,
  colors,
}: {
  datasets: Dataset[];
  visible: boolean[];
  onToggle: (index: number) => void;
  colors: string[];
}) {
  return (
    <div
      role="group"
      aria-label="Chart series visibility"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.65rem 1rem",
        marginBottom: "0.65rem",
      }}
    >
      {datasets.map((ds, i) => {
        const color = ds.color ?? colors[i % colors.length];
        const on = visible[i] ?? true;
        return (
          <label
            key={`${ds.label}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.78rem",
              color: on ? "#fff" : "var(--text-muted)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(i)}
              style={{ width: 14, height: 14, accentColor: color, cursor: "pointer" }}
            />
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 18,
                height: 0,
                borderTop: `2px ${ds.dashed ? "dashed" : "solid"} ${color}`,
                opacity: on ? 1 : 0.35,
              }}
            />
            <span style={{ textDecoration: on ? "none" : "line-through", opacity: on ? 1 : 0.65 }}>
              {ds.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function LineChart({
  labels,
  datasets,
  yLabel = "VTEC (TECU)",
  height = 300,
  threshold,
  thresholds,
  highlightDates,
  tooltipDetails,
  tooltipDetailLabel = "Geomagnetic condition",
  compact = false,
  secondaryYLabel,
  tertiaryYLabel,
  toggleableLegend = false,
  xValues,
  xLabel,
  xMin,
  xMax,
  xStepSize,
  formatXTick,
  xMajorStepMs,
  epochMs,
  syncHoverMs = null,
  onSyncHoverMs,
  yLogScale = false,
  yMin,
  yMax,
  ySuggestedMin,
  ySuggestedMax,
}: Props) {
  const COLORS = ["#168bd2", "#ff8c00", "#00ff88", "#ff4444", "#a78bfa", "#34d399"];
  const useNumericX = !!xValues && xValues.length === labels.length;
  const useSecondary = datasets.some((ds) => ds.yAxisId === "y2");
  const useTertiary = datasets.some((ds) => ds.yAxisId === "y3");
  const datasetKey = useMemo(() => datasets.map((d) => d.label).join("\0"), [datasets]);
  const [visible, setVisible] = useState<boolean[]>(() => datasets.map(() => true));
  const chartRef = useRef<ChartInstance<"line"> | null>(null);

  useEffect(() => {
    setVisible((prev) => {
      if (prev.length === datasets.length) return prev;
      return datasets.map((_, i) => prev[i] ?? true);
    });
  }, [datasetKey, datasets.length]);

  // Sibling charts share syncHoverMs — force a redraw so the crosshair plugin re-runs.
  useEffect(() => {
    chartRef.current?.update("none");
  }, [syncHoverMs]);

  const toggleDataset = (index: number) => {
    setVisible((prev) => prev.map((on, i) => (i === index ? !on : on)));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = [];
  const thresholdLines: ThresholdLine[] = [
    ...(threshold ? [threshold] : []),
    ...(thresholds ?? []),
  ];
  if (thresholdLines.length > 0) {
    plugins.push({
      id: "threshold",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDraw(chart: any) {
        const { ctx, chartArea, scales: { y } } = chart;
        if (!y || !chartArea) return;
        ctx.save();
        for (const line of thresholdLines) {
          if (line.value < y.min || line.value > y.max) continue;
          const yPx = y.getPixelForValue(line.value);
          const color = line.color ?? "#ff8c00";
          if (line.fillAbove) {
            ctx.fillStyle = `${color}22`;
            ctx.fillRect(
              chartArea.left,
              chartArea.top,
              chartArea.right - chartArea.left,
              Math.max(0, yPx - chartArea.top),
            );
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, yPx);
          ctx.lineTo(chartArea.right, yPx);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "11px sans-serif";
          ctx.fillText(line.label, chartArea.left + 4, yPx - 4);
        }
        ctx.restore();
      },
    });
  }
  if (highlightDates?.length) {
    const dates = highlightDates;
    plugins.push({
      id: "stormHighlight",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeDatasetsDraw(chart: any) {
        const { ctx, chartArea, scales } = chart;
        const x = scales.x;
        if (!x || !chartArea) return;
        ctx.save();
        ctx.fillStyle = "rgba(255, 68, 68, 0.14)";
        for (const d of dates) {
          const idx = labels.indexOf(d);
          if (idx < 0) continue;
          const x0 = x.getPixelForValue(Math.max(0, idx - 0.5));
          const x1 = x.getPixelForValue(Math.min(labels.length - 1, idx + 0.5));
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
      },
    });
  }

  if (epochMs && epochMs.length === labels.length) {
    plugins.push({
      id: "syncCrosshair",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterEvent(chart: any, args: any) {
        if (!onSyncHoverMs) return;
        const event = args.event;
        if (!event || args.inChartArea === false) {
          if (event?.type === "mouseout") onSyncHoverMs(null);
          return;
        }
        if (event.type !== "mousemove" && event.type !== "click") return;
        const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, true);
        const idx = points?.[0]?.index;
        if (idx == null) return;
        const ms = epochMs[idx];
        onSyncHoverMs(ms == null ? null : ms);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDraw(chart: any) {
        if (syncHoverMs == null || !epochMs.length) return;
        const xScale = chart.scales.x;
        const { ctx, chartArea } = chart;
        if (!xScale || !chartArea) return;

        let xPx: number;
        if (useNumericX) {
          // Shared UTC cursor in absolute time — aligns across differently sampled panels.
          xPx = xScale.getPixelForValue(syncHoverMs);
        } else {
          let bestIdx = -1;
          let bestDelta = Number.POSITIVE_INFINITY;
          for (let i = 0; i < epochMs.length; i++) {
            const ms = epochMs[i];
            if (ms == null) continue;
            const delta = Math.abs(ms - syncHoverMs);
            if (delta < bestDelta) {
              bestDelta = delta;
              bestIdx = i;
            }
          }
          if (bestIdx < 0) return;
          xPx = xScale.getPixelForValue(bestIdx);
        }
        if (xPx < chartArea.left || xPx > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xPx, chartArea.top);
        ctx.lineTo(xPx, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      },
    });
  }

  return (
    <div>
      {toggleableLegend && (
        <DatasetToggleLegend
          datasets={datasets}
          visible={visible}
          onToggle={toggleDataset}
          colors={COLORS}
        />
      )}
      <div style={{ height, position: "relative" }}>
      <Line
        ref={chartRef}
        data={{
          labels: useNumericX ? undefined : labels,
          datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: useNumericX
              ? ds.data.map((v, idx) => ({ x: xValues![idx], y: v }))
              : ds.data,
            hidden: !(visible[i] ?? true),
            borderColor: ds.color ?? COLORS[i % COLORS.length],
            backgroundColor: ds.fill ? `${ds.color ?? COLORS[i % COLORS.length]}22` : "transparent",
            fill: ds.fill ?? false,
            borderWidth: 2,
            borderDash: ds.dashed ? [6, 4] : undefined,
            pointRadius: compact ? 4 : labels.length > 200 ? 0 : 2,
            pointHoverRadius: compact ? 7 : 4,
            tension: 0.3,
            spanGaps: ds.spanGaps ?? true,
            yAxisID: ds.yAxisId ?? "y",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            meta: ds.meta as any,
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          layout: formatXTick
            ? { padding: { bottom: 22 } }
            : undefined,
          interaction: {
            mode: compact ? "nearest" : "index",
            intersect: compact,
            axis: "x",
          },
          plugins: {
            legend: {
              display: !toggleableLegend,
              labels: { color: "#fff", boxWidth: 12 },
            },
            tooltip: {
              mode: compact ? "nearest" : "index",
              intersect: compact,
              callbacks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                title: (items: any[]) => {
                  if (!items?.length) return "";
                  if (formatXTick && useNumericX) {
                    const x = items[0]?.parsed?.x;
                    if (typeof x === "number" && Number.isFinite(x)) {
                      const d = new Date(x);
                      return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
                    }
                  }
                  if (epochMs?.length) {
                    const idx = items[0]?.dataIndex;
                    const ms = idx != null ? epochMs[idx] : null;
                    if (ms != null) {
                      const d = new Date(ms);
                      return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
                    }
                  }
                  return items[0]?.label ?? "";
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label: (ctx: any) => {
                  const val = ctx.parsed.y;
                  let line = `${ctx.dataset.label}: ${val ?? "N/A"}`;
                  const detail = tooltipDetails?.[ctx.dataIndex];
                  if (detail) line += ` — ${detail}`;
                  const meta = ctx.dataset.meta?.[ctx.dataIndex];
                  if (meta) {
                    if (meta.error != null) line += ` · error ${meta.error.toFixed(2)}`;
                    if (meta.confidence != null) line += ` · confidence ${meta.confidence.toFixed(0)}%`;
                  }
                  return line;
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                afterBody: (items: any[]) => {
                  if (compact) return [];
                  const index = items[0]?.dataIndex;
                  const detail = index === undefined ? null : tooltipDetails?.[index];
                  return detail ? [`${tooltipDetailLabel}: ${detail}`] : [];
                },
              },
            },
          },
          scales: {
            x: useNumericX
              ? {
                  type: "linear" as const,
                  min: xMin,
                  max: xMax,
                  title: xLabel ? { display: true, text: xLabel, color: "#ffffff" } : undefined,
                  // Force ticks onto exact step boundaries (epoch ms). Chart.js "nice"
                  // rounding on large timestamps otherwise lands off :00 and every
                  // formatXTick returns "" — blank UTC axes on Solar Drivers charts.
                  afterBuildTicks:
                    xStepSize && xMin != null && xMax != null
                      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (axis: any) => {
                          const step = xStepSize;
                          const lo = Math.ceil(xMin / step) * step;
                          const ticks: { value: number }[] = [];
                          for (let v = lo; v <= xMax + step * 0.001; v += step) {
                            ticks.push({ value: v });
                          }
                          if (ticks.length === 0 || ticks[0].value > xMin) {
                            ticks.unshift({ value: xMin });
                          }
                          if (ticks[ticks.length - 1].value < xMax) {
                            ticks.push({ value: xMax });
                          }
                          axis.ticks = ticks;
                        }
                      : undefined,
                  ticks: {
                    color: "#ffffff",
                    stepSize: xStepSize,
                    maxRotation: 0,
                    minRotation: 0,
                    autoSkip: false,
                    includeBounds: true,
                    font: { size: 10 },
                    callback: formatXTick
                      ? (value) => {
                          const label = formatXTick(typeof value === "number" ? value : Number(value));
                          // Multi-line ticks: `00:00` then `18 Sep 2026` underneath.
                          if (label.includes("\n")) return label.split("\n");
                          return label;
                        }
                      : undefined,
                  },
                  grid: {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    color: (ctx: any) => {
                      const raw = ctx?.tick?.value;
                      if (typeof raw !== "number" || !Number.isFinite(raw)) return "#244d73";
                      if (!xMajorStepMs || !xStepSize) return "#244d73";
                      // Stronger line on major (e.g. 6h) ticks; faint hourly demarcations.
                      const rem = ((raw % xMajorStepMs) + xMajorStepMs) % xMajorStepMs;
                      const onMajor = rem < 1 || rem > xMajorStepMs - 1;
                      return onMajor ? "rgba(148, 163, 184, 0.45)" : "rgba(36, 77, 115, 0.35)";
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    lineWidth: (ctx: any) => {
                      const raw = ctx?.tick?.value;
                      if (typeof raw !== "number" || !xMajorStepMs) return 1;
                      const rem = ((raw % xMajorStepMs) + xMajorStepMs) % xMajorStepMs;
                      const onMajor = rem < 1 || rem > xMajorStepMs - 1;
                      return onMajor ? 1.25 : 0.75;
                    },
                  },
                }
              : { ticks: { color: "#ffffff", maxTicksLimit: 8 }, grid: { color: "#244d73" } },
            y: {
              position: "left",
              type: yLogScale ? ("logarithmic" as const) : undefined,
              min: yMin,
              max: yMax,
              suggestedMin: ySuggestedMin,
              suggestedMax: ySuggestedMax,
              title: { display: true, text: yLabel, color: "#ffffff" },
              ticks: { color: "#ffffff" },
              grid: { color: "#244d73" },
            },
            ...(useSecondary
              ? {
                  y2: {
                    position: "right" as const,
                    title: { display: true, text: secondaryYLabel ?? "", color: "#ffffff" },
                    ticks: { color: "#ffffff" },
                    grid: { drawOnChartArea: false },
                  },
                }
              : {}),
            ...(useTertiary
              ? {
                  y3: {
                    position: "right" as const,
                    offset: true,
                    title: { display: true, text: tertiaryYLabel ?? "", color: "#ffffff" },
                    ticks: {
                      color: "#ffffff",
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      callback: (value: any) => {
                        const n = typeof value === "number" ? value : Number(value);
                        if (!Number.isFinite(n)) return "";
                        return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
                      },
                    },
                    grid: { drawOnChartArea: false },
                  },
                }
              : {}),
          },
        }}
        plugins={plugins as never}
      />
      </div>
    </div>
  );
}
