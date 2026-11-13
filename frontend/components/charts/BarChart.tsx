"use client";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  labels: string[];
  values: (number | null)[];
  errors?: number[];
  yLabel?: string;
  color?: string;
  height?: number;
  barColors?: string[];
  yMin?: number;
  yMax?: number;
  yStep?: number;
  xLabel?: string;
}

export default function BarChart({ labels, values, errors, yLabel = "VTEC (TECU)", color = "#168bd2", height = 280, barColors, yMin, yMax, yStep, xLabel }: Props) {
  return (
    <div style={{ height, position: "relative", minWidth: 0, width: "100%" }}>
      <Bar
        data={{
          labels,
          datasets: [{
            label: yLabel,
            data: values,
            backgroundColor: barColors ?? color + "cc",
            borderColor: barColors ?? color,
            borderWidth: 1,
            ...(errors ? { errorBars: errors } : {}),
          }],
        }}
        options={{
          responsive: true,
          // Chart.js does not cancel delayed resize updates on destroy.
          resizeDelay: 0,
          animation: false,
          devicePixelRatio: typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2),
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: Boolean(xLabel), text: xLabel, color: "#ffffff" }, ticks: { color: "#ffffff", maxRotation: 45, autoSkip: true, maxTicksLimit: 10 }, grid: { color: "#244d73" } },
            y: { min: yMin, max: yMax, title: { display: true, text: yLabel, color: "#ffffff" }, ticks: { color: "#ffffff", stepSize: yStep }, grid: { color: "#244d73" } },
          },
        }}
      />
    </div>
  );
}
