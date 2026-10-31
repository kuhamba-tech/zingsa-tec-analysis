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
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getGlobalVtecByStation, getLiveVtecByStation } from "@/lib/api";
import type { LiveStationVtecSeries } from "@/lib/types";
import {
  latBandDiurnalMeanStd,
  utcDaysInStationSeries,
  type LatBandDiurnalStats,
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

type RegionChoice = "all" | ZimbabweLatBandId;

type MeanPoint = {
  x: number;
  y: number | null;
  std: number | null;
  observed: number | null;
  source: "observed" | "global";
};

const REGION_CHOICES: { id: RegionChoice; label: string }[] = [
  { id: "all", label: "All regions" },
  { id: "northern", label: "North" },
  { id: "central", label: "Central" },
  { id: "southern", label: "South" },
];

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDayChip(day: string, today: string): string {
  if (day === today) return "Today";
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) return day;
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function pointAt(
  hour: number,
  observed: number | null,
  std: number | null,
  source: MeanPoint["source"] = "observed",
): MeanPoint {
  return { x: hour, y: observed, std, observed, source };
}

function hourReading(values: (number | null)[], pick: "last" | "peak"): { hour: number; value: number } | null {
  let best: { hour: number; value: number } | null = null;
  values.forEach((value, hour) => {
    if (value == null || !Number.isFinite(value)) return;
    if (pick === "last") {
      best = { hour, value };
      return;
    }
    if (!best || value > best.value) best = { hour, value };
  });
  return best;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00 UT`;
}

function globalRowsFromPayload(payload: {
  available?: boolean;
  epoch?: string | null;
  stations?: { station: string; points?: { time: string; vtec_tecu: number }[]; latest_vtec?: number | null }[];
  latest?: { station: string; vtec_tecu: number }[];
} | null): LiveStationVtecSeries[] {
  if (!payload?.available) return [];
  const epoch = payload.epoch || new Date().toISOString();
  const byStation = new Map<string, LiveStationVtecSeries>();
  for (const row of payload.stations ?? []) {
    // Global-map values have no receiver observation count.
    const points = (row.points ?? []).filter((point) => Number.isFinite(point.vtec_tecu) && point.vtec_tecu > 0)
      .map(point => ({ ...point, obs_count: 0 }));
    if (!points.length) continue;
    byStation.set(row.station, {
      station: row.station,
      name: row.station,
      points,
      latest_vtec: row.latest_vtec ?? null,
      mean_vtec: null,
    });
  }
  for (const row of payload.latest ?? []) {
    if (!Number.isFinite(row.vtec_tecu) || row.vtec_tecu <= 0) continue;
    const sample = { time: epoch, vtec_tecu: row.vtec_tecu, obs_count: 0 };
    const existing = byStation.get(row.station);
    if (!existing) {
      byStation.set(row.station, {
        station: row.station,
        name: row.station,
        points: [sample],
        latest_vtec: row.vtec_tecu,
        mean_vtec: null,
      });
      continue;
    }
    if (!existing.points.some((point) => point.time === epoch)) {
      existing.points = [...existing.points, sample];
    }
    existing.latest_vtec = row.vtec_tecu;
  }
  return [...byStation.values()];
}

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

function bandDatasets(
  stats: LatBandDiurnalStats,
  globalStats: LatBandDiurnalStats | null,
  region: RegionChoice,
) {
  const bands = region === "all" ? BANDS : BANDS.filter((band) => band.id === region);
  const datasets: {
    label: string;
    data: MeanPoint[];
    borderColor: string;
    backgroundColor: string;
    borderWidth: number;
    borderDash?: number[];
    pointRadius: number;
    pointHoverRadius: number;
    tension: number;
    spanGaps: boolean;
  }[] = [];

  for (const band of bands) {
    const observed = stats[band.id];
    datasets.push({
      label: region === "all" ? band.label : "Observed",
      data: stats.hours.map((hour, index) => pointAt(hour, observed[index], stats.std[band.id][index])),
      borderColor: band.color,
      backgroundColor: band.color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      spanGaps: false,
    });
    const globalValues = globalStats?.[band.id];
    if (!globalValues?.some((value) => value != null)) continue;
    datasets.push({
      label: region === "all" ? `${band.label.replace(" Zimbabwe", "")} global` : "Global TEC",
      data: stats.hours.map((hour, index) => pointAt(hour, globalValues[index] ?? null, null, "global")),
      borderColor: band.color,
      backgroundColor: "transparent",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.25,
      spanGaps: false,
    });
  }
  return datasets;
}

export default function ZimbabweMeanDiurnalTec() {
  const [rows, setRows] = useState<LiveStationVtecSeries[] | null>(null);
  const [globalRows, setGlobalRows] = useState<LiveStationVtecSeries[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dayChoice, setDayChoice] = useState<string>("latest");
  const [region, setRegion] = useState<RegionChoice>("all");
  const [explainOpen, setExplainOpen] = useState(false);

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
    const applyGlobal = (payload: Parameters<typeof globalRowsFromPayload>[0]) => {
      const incoming = globalRowsFromPayload(payload);
      if (!incoming.length) return;
      setGlobalRows((current) => {
        const map = new Map<string, LiveStationVtecSeries>();
        for (const row of current ?? []) {
          map.set(row.station, { ...row, points: [...row.points] });
        }
        for (const row of incoming) {
          const existing = map.get(row.station);
          if (!existing) {
            map.set(row.station, row);
            continue;
          }
          const seen = new Set(existing.points.map((point) => point.time));
          existing.points = [
            ...existing.points,
            ...row.points.filter((point) => !seen.has(point.time)),
          ];
          if (row.latest_vtec != null) existing.latest_vtec = row.latest_vtec;
        }
        return [...map.values()];
      });
    };
    getGlobalVtecByStation(2, true)
      .then((payload) => {
        if (!cancelled) applyGlobal(payload);
      })
      .catch(() => null);
    getGlobalVtecByStation(24)
      .then((payload) => {
        if (cancelled) return;
        applyGlobal(payload);
        setGlobalRows((current) => current ?? []);
      })
      .catch(() => {
        if (!cancelled) setGlobalRows((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => (rows ? utcDaysInStationSeries(rows) : []), [rows]);
  const today = utcToday();
  const selectedDay = dayChoice === "all"
    ? null
    : dayChoice === "latest"
      ? days[days.length - 1] ?? null
      : days.includes(dayChoice)
        ? dayChoice
        : days[days.length - 1] ?? null;
  const dayIndex = selectedDay ? days.indexOf(selectedDay) : -1;

  const stats = useMemo(
    () => (rows ? latBandDiurnalMeanStd(rows, undefined, selectedDay) : null),
    [rows, selectedDay],
  );
  const globalStats = useMemo(
    () => (globalRows && globalRows.length ? latBandDiurnalMeanStd(globalRows, undefined, selectedDay) : null),
    [globalRows, selectedDay],
  );

  const visibleBands = region === "all" ? BANDS : BANDS.filter((band) => band.id === region);
  const datasets = useMemo(
    () => (stats ? bandDatasets(stats, globalStats, region) : []),
    [stats, globalStats, region],
  );

  const yMax = useMemo(() => {
    let high = 8;
    for (const dataset of datasets) {
      for (const point of dataset.data) {
        if (point.y != null) high = Math.max(high, point.y + (point.std ?? 0));
      }
    }
    return Math.ceil(high + 1);
  }, [datasets]);

  const period = selectedDay
    ? `${selectedDay} UTC`
    : stats?.period
      ? `${stats.period[0]} to ${stats.period[1]} UTC`
      : "the measured window";
  const regionTitle = region === "all"
    ? "northern, central and southern Zimbabwe"
    : BANDS.find((band) => band.id === region)?.label ?? "Zimbabwe";
  const regionNote = region === "all"
    ? "Blue is northern Zimbabwe (latitude north of −18.2°), orange is central (north of −20.2°), and yellow is southern."
    : region === "northern"
      ? "Northern Zimbabwe is latitude north of −18.2°."
      : region === "central"
        ? "Central Zimbabwe is latitude from −20.2° to −18.2°."
        : "Southern Zimbabwe is latitude south of −20.2°.";
  const hasSamples = visibleBands.some((band) => stats?.[band.id].some((value) => value != null));
  const analysis = useMemo(() => {
    if (!stats) return { lead: "", bullets: [] as string[] };
    const coverage = visibleBands
      .map((band) => `${stats.stationCounts[band.id]} ${band.label.replace(" Zimbabwe", "").toLowerCase()}`)
      .join(", ");
    const observedLines = visibleBands.map((band) => {
      const latest = hourReading(stats[band.id], "last");
      const peak = hourReading(stats[band.id], "peak");
      if (!latest || !peak) return `${band.label} has no measured hour in this plot.`;
      const latestStd = stats.std[band.id][latest.hour];
      const spread = latestStd != null ? `, with a standard deviation of ${latestStd.toFixed(1)} TECU` : "";
      return `${band.label} latest is ${latest.value.toFixed(1)} TECU at ${hourLabel(latest.hour)}${spread}. Its highest hour in this plot is ${peak.value.toFixed(1)} TECU at ${hourLabel(peak.hour)}.`;
    });
    const globalLines = visibleBands.map((band) => {
      const observed = hourReading(stats[band.id], "last");
      const globalLatest = globalStats ? hourReading(globalStats[band.id], "last") : null;
      if (!observed) return null;
      if (globalRows == null) return `${band.label}: the DLR global line is still loading.`;
      if (!globalLatest) {
        return `${band.label}: the dashed global line is omitted. The DLR log on this chart covers the last 24 hours, and this day has no map sample for the region.`;
      }
      const sameHour = globalStats?.[band.id][observed.hour];
      if (sameHour == null) {
        const gap = globalLatest.value - observed.value;
        const direction = gap >= 0 ? "above" : "below";
        return `${band.label}: the DLR map at ${hourLabel(globalLatest.hour)} is ${globalLatest.value.toFixed(1)} TECU. The observed mean at ${hourLabel(observed.hour)} is ${observed.value.toFixed(1)} TECU, so the map is ${Math.abs(gap).toFixed(1)} TECU ${direction} that local hour. Those are neighbouring hours, not the same bin. The map is a smooth large-scale product, so that offset is not a storm rating.`;
      }
      const gap = sameHour - observed.value;
      const direction = gap >= 0 ? "above" : "below";
      return `${band.label}: at ${hourLabel(observed.hour)} the DLR map is ${sameHour.toFixed(1)} TECU, ${Math.abs(gap).toFixed(1)} TECU ${direction} the observed mean of ${observed.value.toFixed(1)} TECU. The map is a smooth large-scale product, so that offset is not a storm rating.`;
    }).filter((line): line is string => line != null);
    return {
      lead: `This graph means the mean GOPI code TEC at each Universal Time hour for ${regionTitle}. ${regionNote} The solid line is that observed mean. The bars are the standard deviation of the measured samples in that hour. The dashed line, when it is drawn, is the DLR global TEC map sampled at the same stations and averaged in the same hour. Surveyor General sites are left out. Its importance is the diurnal shape: the rise through the morning is the ordinary solar-EUV curve. Compare a disturbed day with a quiet day in the same region before writing a geomagnetic sentence. Period: ${period}.`,
      bullets: [
        `${coverage} stations contribute to this plot.`,
        ...observedLines,
        ...globalLines,
      ],
    };
  }, [globalRows, globalStats, period, regionNote, regionTitle, stats, visibleBands]);

  return (
    <section className="station-vtec-plots" aria-label="Mean daily TEC by Zimbabwe region">
      <div className="station-vtec-plots-header">
        <div>
          <h2 className="metric-label" style={{ marginBottom: 4, whiteSpace: "normal", overflow: "visible" }}>
            Mean daily TEC — {regionTitle}
          </h2>
          <p className="sw-supporting-text" style={{ margin: 0 }}>
            Mean GOPI code TEC at each Universal Time hour. {regionNote} The solid line is the
            observed mean. The bars are the standard deviation of the measured samples in that
            hour. The dashed line is DLR global TEC at the same stations. Surveyor General sites
            are not included. Period: {period}.
          </p>
        </div>
      </div>
      {days.length > 0 && (
        <div className="station-vtec-plots-controls">
          <div className="station-vtec-day-filters" role="group" aria-label="UTC day">
            <button
              type="button"
              className={selectedDay == null ? "active" : ""}
              onClick={() => setDayChoice("all")}
            >
              All days
            </button>
            <button
              type="button"
              disabled={dayIndex <= 0}
              onClick={() => {
                if (dayIndex > 0) setDayChoice(days[dayIndex - 1]);
              }}
            >
              Previous day
            </button>
            {days.map((day) => (
              <button
                key={day}
                type="button"
                className={selectedDay === day ? "active" : ""}
                title={`${day} UTC`}
                onClick={() => setDayChoice(day)}
              >
                {formatDayChip(day, today)}
              </button>
            ))}
            <button
              type="button"
              disabled={dayIndex < 0 || dayIndex >= days.length - 1}
              onClick={() => {
                if (dayIndex >= 0 && dayIndex < days.length - 1) setDayChoice(days[dayIndex + 1]);
              }}
            >
              Next day
            </button>
          </div>
          <div className="station-vtec-hour-filters" role="group" aria-label="Zimbabwe region">
            {REGION_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={region === choice.id ? "active" : ""}
                onClick={() => setRegion(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {failed && (
        <p className="station-vtec-plots-sub">The regional daily TEC graph could not be loaded.</p>
      )}
      {!failed && rows == null && (
        <p className="station-vtec-plots-sub">Loading measured TEC for the regional daily mean.</p>
      )}
      {!failed && stats && !hasSamples && (
        <p className="station-vtec-plots-sub">
          No measured GOPI for {region === "all" ? "these regions" : regionTitle} on {period}.
        </p>
      )}
      {stats && hasSamples && (
        <>
          <p className="station-vtec-plots-sub">
            {visibleBands
              .map((band) => `${stats.stationCounts[band.id]} ${band.label.replace(" Zimbabwe", "").toLowerCase()}`)
              .join(" · ")}{" "}
            stations
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
                interaction: { mode: "nearest", intersect: false },
                plugins: {
                  legend: {
                    labels: { color: "#ffffff", boxWidth: 12, font: { size: 11 } },
                  },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        const hour = Number(items[0]?.parsed.x);
                        if (!Number.isInteger(hour)) return "";
                        const clock = `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00 UT`;
                        return selectedDay ? `${selectedDay} ${clock}` : clock;
                      },
                      label: (item) => {
                        const point = item.raw as MeanPoint;
                        const lines = [`${item.dataset.label}`];
                        if (point.source === "global") {
                          lines.push(
                            point.observed == null ? "Global TEC: —" : `Global TEC: ${point.observed.toFixed(1)} TECU`,
                          );
                          return lines;
                        }
                        lines.push(
                          point.observed == null ? "Observed: —" : `Observed: ${point.observed.toFixed(1)} TECU`,
                        );
                        if (point.std != null) {
                          lines.push(`Standard deviation: ${point.std.toFixed(1)} TECU`);
                        }
                        return lines;
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
          <button
            type="button"
            onClick={() => setExplainOpen((open) => !open)}
            aria-expanded={explainOpen}
            style={{
              marginTop: "0.55rem",
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--accent)",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {explainOpen ? "Hide what this graph means" : "What this graph means"}
          </button>
          {explainOpen && (
            <ChartAnalysisBox
              block={analysis}
              title="What this graph means"
              afterLeadTitle="Scientific explanation"
            />
          )}
        </>
      )}
    </section>
  );
}
