"use client";

import { useEffect, useState } from "react";
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
import { getReceiverBias } from "@/lib/api";
import { biasHistogramExplanation, biasSeriesExplanation } from "@/lib/matambaChartExplanation";
import type { ReceiverBiasStation } from "@/lib/types";
import MatambaChartPanel from "./MatambaChartPanel";

ChartJS.register(LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

function epoch(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function doyLabel(ms: number): string {
  const date = new Date(ms);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = Math.floor((date.getTime() - start) / 86_400_000);
  return String(doy);
}

function titleFor(station: ReceiverBiasStation): string {
  const code = station.station.toUpperCase();
  const mean = station.mean_bias_tecu.toFixed(2);
  if (station.std_bias_tecu == null) return `${code} ${mean}`;
  return `${code} ${mean} +/- ${station.std_bias_tecu.toFixed(2)}`;
}

function StationPanel({ station }: { station: ReceiverBiasStation }) {
  const points = station.points.map((point) => ({ x: epoch(point.day), y: point.bias_tecu, day: point.day, doy: point.doy }));
  const xs = points.map((point) => point.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const span = xMax === xMin ? 86_400_000 : xMax - xMin;
  const left = xMin - span * 0.04;
  const right = xMax + span * 0.04;
  const mean = station.mean_bias_tecu;
  const datasets = [
    {
      label: "Daily bias",
      data: points,
      borderColor: "#38bdf8",
      backgroundColor: "#38bdf8",
      borderWidth: 1.4,
      pointRadius: points.length > 24 ? 0 : 2,
      tension: 0,
    },
    {
      label: "Mean",
      data: [{ x: left, y: mean }, { x: right, y: mean }],
      borderColor: "#ef4444",
      borderDash: [6, 4],
      borderWidth: 1.4,
      pointRadius: 0,
    },
  ];
  if (station.std_bias_tecu != null) {
    for (const sign of [1, -1]) {
      const level = mean + sign * station.std_bias_tecu;
      datasets.push({
        label: sign > 0 ? "+1 standard deviation" : "−1 standard deviation",
        data: [{ x: left, y: level }, { x: right, y: level }],
        borderColor: "#e5e7eb",
        borderDash: [2, 3],
        borderWidth: 1.2,
        pointRadius: 0,
      });
    }
  }
  if (station.product_bias_tecu != null) {
    datasets.push({
      label: "Map product bias",
      data: [{ x: left, y: station.product_bias_tecu }, { x: right, y: station.product_bias_tecu }],
      borderColor: "#4ade80",
      borderDash: [2, 3],
      borderWidth: 1.4,
      pointRadius: 0,
    });
  }

  const yValues = [
    ...points.map((point) => point.y),
    mean,
    ...(station.std_bias_tecu == null ? [] : [mean - station.std_bias_tecu, mean + station.std_bias_tecu]),
    ...(station.product_bias_tecu == null ? [] : [station.product_bias_tecu]),
  ];
  const ySpan = Math.max(...yValues) - Math.min(...yValues);
  const yPad = Math.max(2, ySpan * 0.25);
  const yMin = Math.min(...yValues) - yPad;
  const yMax = Math.max(...yValues) + yPad;

  return (
    <MatambaChartPanel label={`${station.station.toUpperCase()} receiver bias`} analysis={biasSeriesExplanation(station)}>
    <div className="matamba-bias-card">
      <div className="matamba-bias-title">{titleFor(station)}</div>
      <div className="matamba-chart matamba-chart--bias">
        <Chart
          type="line"
          data={{ datasets }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (items) => {
                    const raw = items[0]?.raw as { day?: string; doy?: number } | undefined;
                    return raw?.day ? `${raw.day}  DOY ${raw.doy}` : "";
                  },
                  label: (item) => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)} TECU`,
                },
              },
            },
            scales: {
              x: {
                type: "linear",
                min: left,
                max: right,
                ticks: {
                  color: "#ffffff",
                  maxTicksLimit: 4,
                  callback: (value) => doyLabel(Number(value)),
                },
                title: { display: true, text: "Day of year", color: "#ffffff", font: { size: 10 } },
                grid: { color: "#1e3a5f" },
              },
              y: {
                min: yMin,
                max: yMax,
                ticks: { color: "#ffffff", maxTicksLimit: 4 },
                title: { display: true, text: "Receiver Bias [TECU]", color: "#ffffff", font: { size: 10 } },
                grid: { color: "#1e3a5f" },
              },
            },
          }}
        />
      </div>
    </div>
    </MatambaChartPanel>
  );
}

const BIN_TECU = 1;

function biasBins(values: number[]) {
  const low = Math.floor(Math.min(...values) / BIN_TECU) * BIN_TECU;
  const high = Math.ceil(Math.max(...values) / BIN_TECU) * BIN_TECU;
  const count = Math.max(1, Math.round(Math.max(BIN_TECU, high - low) / BIN_TECU));
  const bins = Array.from({ length: count }, (_, index) => {
    const from = low + index * BIN_TECU;
    return { x: from + BIN_TECU / 2, y: 0, from, to: from + BIN_TECU };
  });
  for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - low) / BIN_TECU)));
    bins[index].y += 1;
  }
  return bins;
}

/** Gaussian density scaled so its area matches the histogram counts. */
function gaussianCount(x: number, mean: number, sigma: number, n: number): number {
  const z = (x - mean) / sigma;
  return (n * BIN_TECU * Math.exp(-0.5 * z * z)) / (sigma * Math.sqrt(2 * Math.PI));
}

function HistogramPanel({ station }: { station: ReceiverBiasStation }) {
  const values = station.points.map((point) => point.bias_tecu);
  const bins = biasBins(values);
  const mean = station.mean_bias_tecu;
  const sigma = station.std_bias_tecu != null && station.std_bias_tecu > 0 ? station.std_bias_tecu : null;
  const fit = sigma != null;
  const xMin = bins[0].from - BIN_TECU;
  const xMax = bins[bins.length - 1].to + BIN_TECU;
  const curve = fit
    ? Array.from({ length: 80 }, (_, index) => {
        const x = xMin + ((xMax - xMin) * index) / 79;
        return { x, y: gaussianCount(x, mean, sigma ?? 1, values.length) };
      })
    : [];
  const yMax = Math.max(1, ...bins.map((bin) => bin.y), ...curve.map((point) => point.y)) * 1.12;

  return (
    <MatambaChartPanel label={`${station.station.toUpperCase()} receiver-bias histogram`} analysis={biasHistogramExplanation(station)}>
    <div className="matamba-bias-card">
      <div className="matamba-bias-title">
        {station.station.toUpperCase()}
        {sigma != null ? `  μ ${mean.toFixed(2)}  σ ${sigma.toFixed(2)}` : ""}
        {`  n ${values.length}`}
      </div>
      <div className="matamba-chart matamba-chart--bias">
        <Chart
          type="bar"
          data={{
            datasets: [
              {
                type: "bar" as const,
                label: "Count",
                data: bins,
                backgroundColor: "rgba(45, 212, 191, 0.85)",
                borderWidth: 0,
                barPercentage: 1,
                categoryPercentage: 1,
                order: 2,
              },
              ...(fit
                ? [{
                    type: "line" as const,
                    label: "Gaussian fit",
                    data: curve,
                    borderColor: "#ef4444",
                    borderWidth: 2,
                    pointRadius: 0,
                    order: 1,
                  }]
                : []),
            ],
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
                    const bin = bins[items[0]?.dataIndex ?? -1];
                    if (items[0]?.dataset.type === "bar" && bin) {
                      return `${bin.from.toFixed(0)} to ${bin.to.toFixed(0)} TECU`;
                    }
                    return "Gaussian fit";
                  },
                  label: (item) => item.dataset.type === "bar"
                    ? `Count: ${item.parsed.y}`
                    : `Fit: ${Number(item.parsed.y).toFixed(2)}`,
                },
              },
            },
            scales: {
              x: {
                type: "linear",
                min: xMin,
                max: xMax,
                ticks: { color: "#ffffff", maxTicksLimit: 5 },
                title: { display: true, text: "Receiver Bias [TECU]", color: "#ffffff", font: { size: 10 } },
                grid: { color: "#1e3a5f" },
              },
              y: {
                min: 0,
                max: yMax,
                ticks: { color: "#ffffff", maxTicksLimit: 4, precision: 0 },
                title: { display: true, text: "Counts", color: "#ffffff", font: { size: 10 } },
                grid: { color: "#1e3a5f" },
              },
            },
          }}
        />
      </div>
    </div>
    </MatambaChartPanel>
  );
}

/** Peak height of the red Gaussian, in histogram counts. */
function gaussianAmplitude(station: ReceiverBiasStation): number | null {
  const sigma = station.std_bias_tecu;
  const n = station.points.length;
  if (sigma == null || sigma <= 0 || n < 2) return null;
  return (n * BIN_TECU) / (sigma * Math.sqrt(2 * Math.PI));
}

function formatFit(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}
export default function ReceiverBiasCharts() {
  const [stations, setStations] = useState<ReceiverBiasStation[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getReceiverBias(120)
        .then((payload) => {
          if (cancelled) return;
          setStations(payload.stations);
          setNote(payload.note);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError("Receiver bias log could not be loaded.");
        });
    };
    load();
    const timer = window.setInterval(load, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="matamba-figures">
      <div className="matamba-figures-title">Receiver bias by station</div>
      <div className="matamba-figures-note">
        Daily receiver bias for the near-real-time TEC maps. The search follows the Matamba and
        Gopi method: satellite differential code bias removed, then the receiver bias that minimises
        the standard deviation of vertical TEC above 30° elevation. Blue is that daily value. Red
        dashed is the mean. Light dotted lines are one standard deviation from the mean. Green dotted
        is the bias held for the map product. The title is the mean and standard deviation. A day is
        logged only when several multi-satellite epochs identify the minimum, and the current UTC day
        is replaced as new code TEC arrives. Surveyor General sites are not included.
        Click a graph for the Matamba and Danskin explanation.
      </div>
      {!stations.length && !error && (
        <div className="banner banner-info" role="status">
          {note || "Logging daily receiver bias from the live code TEC…"}
        </div>
      )}
      {error && !stations.length && <div className="banner banner-warn">{error}</div>}
      {stations.length > 0 && (
        <div className="matamba-bias-grid">
          {stations.map((station) => (
            <StationPanel key={station.station} station={station} />
          ))}
        </div>
      )}
      {stations.length > 0 && (
        <div style={{ marginTop: "0.9rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.12rem" }}>Receiver bias histograms</div>
          <div style={{ fontSize: "0.7rem", color: "#ffffff", marginBottom: "0.55rem" }}>
            Each histogram counts every logged daily bias for that station, across the record, not one
            UTC day. The red line is the Gaussian fit to those days: μ is the mean and σ is the sample
            standard deviation. The current UTC day stays in the histogram and is replaced as new code
            TEC arrives. A station with only one logged day has no curve yet.
          </div>
          <div className="matamba-bias-grid">
            {stations.map((station) => (
              <HistogramPanel key={station.station} station={station} />
            ))}
          </div>
          <div style={{ fontWeight: 700, margin: "0.9rem 0 0.12rem" }}>
            Gaussian parameters for the ZINGSA stations used in the near-real-time TEC maps
          </div>
          <div style={{ fontSize: "0.7rem", color: "#ffffff", marginBottom: "0.45rem" }}>
            Amplitude is the peak of the red Gaussian, in counts. Mean and standard deviation are the
            fit to every logged day for that station. The row updates as new days are stored. A station
            with only one logged day does not yet have an amplitude or a standard deviation.
          </div>
          <div className="matamba-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr>
                  {["Station", "Amplitude", "Mean", "Standard deviation"].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: heading === "Station" ? "left" : "right",
                        padding: "0.35rem 0.6rem",
                        borderBottom: "1px solid #334155",
                        fontWeight: 700,
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => {
                  const amplitude = gaussianAmplitude(station);
                  return (
                    <tr key={station.station}>
                      <td style={{ padding: "0.32rem 0.6rem", borderBottom: "1px solid #1e293b", textAlign: "left" }}>
                        {station.station.toUpperCase()}
                      </td>
                      <td style={{ padding: "0.32rem 0.6rem", borderBottom: "1px solid #1e293b", textAlign: "right" }}>
                        {formatFit(amplitude)}
                      </td>
                      <td style={{ padding: "0.32rem 0.6rem", borderBottom: "1px solid #1e293b", textAlign: "right" }}>
                        {formatFit(station.mean_bias_tecu)}
                      </td>
                      <td style={{ padding: "0.32rem 0.6rem", borderBottom: "1px solid #1e293b", textAlign: "right" }}>
                        {formatFit(station.std_bias_tecu)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
