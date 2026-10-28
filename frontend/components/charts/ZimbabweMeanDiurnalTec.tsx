"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type Chart,
  type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { getLiveVtecByStation } from "@/lib/api";
import type { LiveStationVtecSeries } from "@/lib/types";
import {
  latBandDiurnalMeanStd,
  type ZimbabweLatBandId,
} from "@/lib/zimbabweLatBands";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

/** Same roles as the Italian latitude figure: nearer the equator, middle, further south. */
const BANDS: { id: ZimbabweLatBandId; label: string; color: string }[] = [
  { id: "northern", label: "Northern Zimbabwe", color: "#3b82f6" },
  { id: "central", label: "Central Zimbabwe", color: "#f97316" },
  { id: "southern", label: "Southern Zimbabwe", color: "#eab308" },
];

type MeanPoint = { x: number; y: number | null; std: number | null };

const errorBars: Plugin<"line"> = {
  id: "zimbabweLatStd",
  afterDatasetsDraw(chart: Chart) {
    const yScale = chart.scales.y;
    if (!yScale) return;
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      const color = typeof dataset.borderColor === "string" ? dataset.borderColor : "#ffffff";
      meta.data.forEach((element, index) => {
        const point = dataset.data[index] as MeanPoint | undefined;
        if (!point || point.y == null || point.std == null || point.std <= 0) return;
        const x = element.x;
        const top = yScale.getPixelForValue(point.y + point.std);
        const bottom = yScale.getPixelForValue(point.y - point.std);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.moveTo(x - 4, top);
        ctx.lineTo(x + 4, top);
        ctx.moveTo(x - 4, bottom);
        ctx.lineTo(x + 4, bottom);
        ctx.stroke();
        ctx.restore();
      });
    });
  },
};

export default function ZimbabweMeanDiurnalTec() {
  const [rows, setRows] = useState<LiveStationVtecSeries[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLiveVtecByStation(168, 30, 120_000)
      .then((payload) => {
        if (!cancelled) {
          setRows(Array.isArray(payload) ? payload : []);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => (rows ? latBandDiurnalMeanStd(rows) : null), [rows]);

  const yMax = useMemo(() => {
    if (!stats) return 20;
    let high = 8;
    for (const band of BANDS) {
      stats.hours.forEach((_, index) => {
        const mean = stats[band.id][index];
        const std = stats.std[band.id][index] ?? 0;
        if (mean != null) high = Math.max(high, mean + std);
      });
    }
    return Math.ceil(high + 1);
  }, [stats]);

  const datasets = useMemo(() => {
    if (!stats) return [];
    return BANDS.map((band) => ({
      label: band.label,
      data: stats.hours.map((hour, index) => ({
        x: hour,
        y: stats[band.id][index],
        std: stats.std[band.id][index],
      })),
      borderColor: band.color,
      backgroundColor: band.color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      spanGaps: false,
    }));
  }, [stats]);

  const period = stats?.period ? `${stats.period[0]} to ${stats.period[1]} UTC` : "the measured window";

  return (
    <section className="station-vtec-plots" aria-label="Mean daily TEC by Zimbabwe region">
      <div className="station-vtec-plots-header">
        <div>
          <h2>Mean daily TEC — northern, central and southern Zimbabwe</h2>
          <p className="station-vtec-plots-sub">
            Mean GOPI code TEC at each Universal Time hour. Blue is northern Zimbabwe
            (latitude north of −18.2°), orange is central (north of −20.2°), and yellow is
            southern. The bars are the standard deviation of the measured samples in that
            hour. Surveyor General sites are not included. Period: {period}.
          </p>
        </div>
      </div>
      {failed && (
        <p className="station-vtec-plots-sub">The regional daily TEC graph could not be loaded.</p>
      )}
      {!failed && rows == null && (
        <p className="station-vtec-plots-sub">Loading measured TEC for the regional daily mean.</p>
      )}
      {!failed && stats && stats.hoursWithData === 0 && (
        <p className="station-vtec-plots-sub">No measured GOPI in the northern, central or southern bands.</p>
      )}
      {stats && stats.hoursWithData > 0 && (
        <>
          <p className="station-vtec-plots-sub">
            {stats.stationCounts.northern} northern · {stats.stationCounts.central} central ·{" "}
            {stats.stationCounts.southern} southern stations
          </p>
          <div style={{ height: 380 }}>
            <Line
              data={{ datasets }}
              plugins={[errorBars]}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                color: "#ffffff",
                animation: false,
                plugins: {
                  legend: {
                    labels: { color: "#ffffff", boxWidth: 12, font: { size: 11 } },
                  },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        const hour = Number(items[0]?.parsed.x);
                        if (!Number.isInteger(hour)) return "";
                        return `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00 UT`;
                      },
                      label: (item) => {
                        const point = item.raw as MeanPoint;
                        if (point.y == null) return `${item.dataset.label}: —`;
                        const spread = point.std == null ? "" : ` ± ${point.std.toFixed(1)}`;
                        return `${item.dataset.label}: ${point.y.toFixed(1)}${spread} TECU`;
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    type: "linear",
                    min: 0,
                    max: 23,
                    title: { display: true, text: "UT", color: "#ffffff", font: { weight: "bold" } },
                    ticks: {
                      color: "#ffffff",
                      stepSize: 1,
                      autoSkip: false,
                      maxRotation: 0,
                      callback: (value) => {
                        const hour = Number(value);
                        return Number.isInteger(hour) ? String(hour) : "";
                      },
                    },
                    grid: { color: "#1e3a5f" },
                  },
                  y: {
                    min: 0,
                    max: yMax,
                    title: { display: true, text: "TEC (TECU)", color: "#ffffff", font: { weight: "bold" } },
                    ticks: { color: "#ffffff" },
                    grid: { color: "#1e3a5f" },
                  },
                },
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
