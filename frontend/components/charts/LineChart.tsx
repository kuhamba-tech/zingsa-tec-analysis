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

interface Dataset {
  label: string;
  data: number[];
  color?: string;
  fill?: boolean;
}

interface Props {
  labels: string[];
  datasets: Dataset[];
  yLabel?: string;
  height?: number;
  threshold?: { value: number; label: string };
}

export default function LineChart({ labels, datasets, yLabel = "VTEC (TECU)", height = 300, threshold }: Props) {
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
            pointRadius: labels.length > 200 ? 0 : 2,
            tension: 0.3,
          })),
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#fff", boxWidth: 12 } },
            tooltip: { mode: "index", intersect: false },
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
