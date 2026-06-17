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

interface Props {
  labels: string[];
  datasets: Dataset[];
  yLabel?: string;
  height?: number;
  threshold?: { value: number; label: string };
  highlightDates?: string[];
}

export default function LineChart({ labels, datasets, yLabel = "VTEC (TECU)", height = 300, threshold, highlightDates }: Props) {
  const COLORS = ["#168bd2", "#ff8c00", "#00ff88", "#ff4444", "#a78bfa", "#34d399"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = [];
  if (threshold) {
    plugins.push({
      id: "threshold",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDraw(chart: any) {
        const { ctx, scales: { y } } = chart;
        const yPx = y.getPixelForValue(threshold.value);
        ctx.save();
        ctx.strokeStyle = "#ff8c00";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, yPx);
        ctx.lineTo(chart.chartArea.right, yPx);
        ctx.stroke();
        ctx.fillStyle = "#ff8c00";
        ctx.font = "11px sans-serif";
        ctx.fillText(threshold.label, chart.chartArea.left + 4, yPx - 4);
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
            pointRadius: labels.length > 200 ? 0 : 2,
            tension: 0.3,
            spanGaps: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            meta: ds.meta as any,
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#fff", boxWidth: 12 } },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label: (ctx: any) => {
                  const val = ctx.parsed.y;
                  let line = `${ctx.dataset.label}: ${val ?? "N/A"}`;
                  const meta = ctx.dataset.meta?.[ctx.dataIndex];
                  if (meta) {
                    if (meta.error != null) line += ` · error ${meta.error.toFixed(2)}`;
                    if (meta.confidence != null) line += ` · confidence ${meta.confidence.toFixed(0)}%`;
                  }
                  return line;
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
