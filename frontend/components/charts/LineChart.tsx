"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  Title,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, TimeScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

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
  /** Chart.js y-axis id — use "y2" for secondary scale (dual-axis charts). */
  yAxisId?: "y" | "y2";
}

interface ThresholdLine {
  value: number;
  label: string;
  color?: string;
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
  /** Checkbox legend — show/hide individual series. */
  toggleableLegend?: boolean;
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
  toggleableLegend = false,
}: Props) {
  const COLORS = ["#168bd2", "#ff8c00", "#00ff88", "#ff4444", "#a78bfa", "#34d399"];
  const useSecondary = datasets.some((ds) => ds.yAxisId === "y2");
  const datasetKey = useMemo(() => datasets.map((d) => d.label).join("\0"), [datasets]);
  const [visible, setVisible] = useState<boolean[]>(() => datasets.map(() => true));

  useEffect(() => {
    setVisible((prev) => {
      if (prev.length === datasets.length) return prev;
      return datasets.map((_, i) => prev[i] ?? true);
    });
  }, [datasetKey, datasets.length]);

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
        const { ctx, scales: { y } } = chart;
        ctx.save();
        for (const line of thresholdLines) {
          if (line.value < y.min || line.value > y.max) continue;
          const yPx = y.getPixelForValue(line.value);
          const color = line.color ?? "#ff8c00";
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(chart.chartArea.left, yPx);
          ctx.lineTo(chart.chartArea.right, yPx);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.font = "11px sans-serif";
          ctx.fillText(line.label, chart.chartArea.left + 4, yPx - 4);
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
        data={{
          labels,
          datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            hidden: !(visible[i] ?? true),
            borderColor: ds.color ?? COLORS[i % COLORS.length],
            backgroundColor: ds.fill ? `${ds.color ?? COLORS[i % COLORS.length]}22` : "transparent",
            fill: ds.fill ?? false,
            borderWidth: 2,
            borderDash: ds.dashed ? [6, 4] : undefined,
            pointRadius: compact ? 4 : labels.length > 200 ? 0 : 2,
            pointHoverRadius: compact ? 7 : 4,
            tension: 0.3,
            spanGaps: true,
            yAxisID: ds.yAxisId ?? "y",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            meta: ds.meta as any,
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
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
            x: { ticks: { color: "#ffffff", maxTicksLimit: 8 }, grid: { color: "#244d73" } },
            y: {
              position: "left",
              title: { display: true, text: yLabel, color: "#ffffff" },
              ticks: { color: "#ffffff" },
              grid: { color: "#244d73" },
            },
            ...(useSecondary
              ? {
                  y2: {
                    position: "right",
                    title: { display: true, text: secondaryYLabel ?? "", color: "#ffffff" },
                    ticks: { color: "#ffffff" },
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
