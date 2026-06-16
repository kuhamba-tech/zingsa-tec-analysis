"use client";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  labels: string[];
  values: number[];
  errors?: number[];
  yLabel?: string;
  color?: string;
  height?: number;
}

export default function BarChart({ labels, values, errors, yLabel = "VTEC (TECU)", color = "#168bd2", height = 280 }: Props) {
  return (
    <div style={{ height, position: "relative" }}>
      <Bar
        data={{
          labels,
          datasets: [{
            label: yLabel,
            data: values,
            backgroundColor: color + "cc",
            borderColor: color,
            borderWidth: 1,
            ...(errors ? { errorBars: errors } : {}),
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#ffffff" }, grid: { color: "#244d73" } },
            y: { title: { display: true, text: yLabel, color: "#ffffff" }, ticks: { color: "#ffffff" }, grid: { color: "#244d73" } },
          },
        }}
      />
    </div>
  );
}
