"use client";
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
}: Props) {
  const COLORS = ["#168bd2", "#ff8c00", "#00ff88", "#ff4444", "#a78bfa", "#34d399"];

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
    <div style={{ height, position: "relative" }}>
      <Line
        data={{
          labels,
          datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            borderColor: ds.color ?? COLORS[i % COLORS.length],
            backgroundColor: ds.fill ? `${ds.color ?? COLORS[i % COLORS.length]}22` : "transparent",
            fill: ds.fill ?? false,
            borderWidth: 2,
            borderDash: ds.dashed ? [6, 4] : undefined,
            pointRadius: compact ? 4 : labels.length > 200 ? 0 : 2,
            pointHoverRadius: compact ? 7 : 4,
            tension: 0.3,
            spanGaps: true,
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
            legend: { labels: { color: "#fff", boxWidth: 12 } },
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
            y: { title: { display: true, text: yLabel, color: "#ffffff" }, ticks: { color: "#ffffff" }, grid: { color: "#244d73" } },
          },
        }}
        plugins={plugins as never}
      />
    </div>
  );
}
