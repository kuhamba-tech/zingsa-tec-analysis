"use client";

import { useEffect, useMemo, useState } from "react";
import { getLiveVtecByStation } from "@/lib/api";
import type { LiveStationVtecSeries } from "@/lib/types";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { isSurveyorGeneral } from "@/lib/liveStationStatus";
import { formatUtcAxisTick, startOfUtcDay } from "@/lib/chartTimeAxis";

const LOOKBACK_HOURS = 168;
const BIN_MINUTES = 30;
/** Do not draw across a hole longer than one missing bin. */
const GAP_MS = 45 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATION_COLORS = [
  "#38bdf8",
  "#f97316",
  "#a3e635",
  "#e879f9",
  "#facc15",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
  "#4ade80",
  "#60a5fa",
  "#f472b6",
  "#2dd4bf",
  "#fdba74",
  "#a78bfa",
  "#bef264",
  "#67e8f9",
  "#fca5a5",
  "#86efac",
];

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatStamp(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${hours}:${minutes} UTC`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export default function LiveTecMultiDayChart() {
  const [rows, setRows] = useState<LiveStationVtecSeries[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLiveVtecByStation(LOOKBACK_HOURS, BIN_MINUTES, 120_000)
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

  const chart = useMemo(() => {
    const measured = (rows ?? []).filter(
      (row) => row.points.length > 0 && !isSurveyorGeneral(row.station),
    );
    const stamps = new Set<number>();
    for (const row of measured) {
      for (const point of row.points) {
        const ms = Date.parse(point.time);
        if (Number.isFinite(ms)) stamps.add(ms);
      }
    }
    const real = [...stamps].sort((a, b) => a - b);
    const axis: number[] = [];
    for (let i = 0; i < real.length; i += 1) {
      axis.push(real[i]);
      if (i + 1 < real.length && real[i + 1] - real[i] > GAP_MS) {
        axis.push(real[i] + 1);
      }
    }
    if (axis.length === 0) return null;
    const index = new Map(axis.map((ms, i) => [ms, i]));
    const xMin = startOfUtcDay(axis[0]);
    const xMax = startOfUtcDay(axis[axis.length - 1]) + DAY_MS;
    const days = [...new Set(real.map(dayKey))];
    const datasets = measured.map((row, seriesIndex) => {
      const data: (number | null)[] = axis.map(() => null);
      for (const point of row.points) {
        const at = index.get(Date.parse(point.time));
        if (at == null || !Number.isFinite(point.vtec_tecu)) continue;
        data[at] = point.vtec_tecu;
      }
      return {
        label: row.station.toUpperCase(),
        data,
        color: STATION_COLORS[seriesIndex % STATION_COLORS.length],
        borderWidth: 1.5,
        tension: 0,
        spanGaps: false,
      };
    });
    return { axis, xMin, xMax, days, datasets, stations: measured.length };
  }, [rows]);

  const analysis = useMemo(() => {
    const measured = (rows ?? []).filter(
      (row) => row.points.length > 0 && !isSurveyorGeneral(row.station),
    );
    let samples = 0;
    let peak: { vtec: number; station: string; ms: number } | null = null;
    const dayPeak = new Map<string, { vtec: number; station: string; ms: number }>();
    const dayValues: number[] = [];
    const nightValues: number[] = [];
    for (const row of measured) {
      for (const point of row.points) {
        const ms = Date.parse(point.time);
        if (!Number.isFinite(ms) || !Number.isFinite(point.vtec_tecu)) continue;
        samples += 1;
        const hit = { vtec: point.vtec_tecu, station: row.station.toUpperCase(), ms };
        if (!peak || hit.vtec > peak.vtec) peak = hit;
        const day = dayKey(ms);
        const current = dayPeak.get(day);
        if (!current || hit.vtec > current.vtec) dayPeak.set(day, hit);
        const hour = new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
        if (hour >= 8 && hour < 16) dayValues.push(hit.vtec);
        else if (hour >= 20 || hour < 4) nightValues.push(hit.vtec);
      }
    }
    const days = [...dayPeak.keys()].sort();
    const highestDay = [...dayPeak.entries()].sort((a, b) => b[1].vtec - a[1].vtec)[0];
    const dayMedian = median(dayValues);
    const nightMedian = median(nightValues);
    const coverage = days.length
      ? `${measured.length} stations reported in this window, from ${days[0]} to ${days[days.length - 1]} UTC, across ${days.length} day${days.length === 1 ? "" : "s"} and ${samples} half-hour samples.`
      : "No measured GOPI samples are available for this window.";
    const highest = peak && highestDay
      ? `The highest sample is ${peak.vtec.toFixed(1)} TECU at ${peak.station} on ${formatStamp(peak.ms)}. The day with the highest peak is ${highestDay[0]}, ${highestDay[1].vtec.toFixed(1)} TECU at ${highestDay[1].station}.`
      : "No peak can be read until a station sample is drawn.";
    const diurnal = dayMedian != null && nightMedian != null
      ? `The median of the 08:00–16:00 UTC samples is ${dayMedian.toFixed(1)} TECU. The median of the 20:00–04:00 UTC samples is ${nightMedian.toFixed(1)} TECU. ${dayMedian > nightMedian + 2 ? "Daytime sits above the night, which is the ordinary solar-EUV rise." : "Day and night are close in this window, so the ordinary sunrise rise is weak or the coverage is uneven."} A spike above that curve is a storm only when the same hours also show southward Bz and Kp at or above 5.`
      : "Day and night medians need samples in both parts of the UTC day before the sunrise curve can be read.";
    return {
      lead: "This graph means measured GOPI code TEC at each Zimbabwe CORS station over the last 7 days. Each coloured line is one station, and each point is a 30-minute bin. A gap longer than 45 minutes stays open, so a missing hour is not joined into a smooth curve. Surveyor General sites are left out. Its importance is the ionosphere day after day: a rise that repeats after sunrise is the quiet solar-EUV curve, not a storm by itself.",
      bullets: [coverage, highest, diurnal],
    };
  }, [rows]);

  return (
    <section className="station-vtec-plots" aria-label="Live TEC across days">
      <div className="station-vtec-plots-header">
        <div>
          <h2 className="metric-label" style={{ marginBottom: 4, whiteSpace: "normal", overflow: "visible" }}>
            Live TEC across days
          </h2>
          <p className="sw-supporting-text" style={{ margin: 0 }}>
            Measured GOPI code TEC at each Zimbabwe CORS station, one line per station,
            for the last 7 days. Each point is a 30-minute bin. A gap longer than 45
            minutes stays open. Surveyor General sites are not included. A rise that
            repeats after sunrise is the quiet EUV curve, higher near the 2024 maximum
            than in the 2020 minimum. Call it a storm only when the same hours also show
            southward Bz and Kp at or above 5.
          </p>
        </div>
      </div>
      {failed && <p className="station-vtec-plots-sub">The multi-day live TEC graph could not be loaded.</p>}
      {!failed && rows == null && (
        <p className="station-vtec-plots-sub">Loading measured TEC for the last 7 days.</p>
      )}
      {!failed && rows != null && chart == null && (
        <p className="station-vtec-plots-sub">No measured GOPI in the last 7 days.</p>
      )}
      {chart && (
        <>
          <p className="station-vtec-plots-sub">
            {chart.stations} stations · {chart.days[0]} to {chart.days[chart.days.length - 1]} UTC
            · {chart.days.length} day{chart.days.length === 1 ? "" : "s"} with samples
          </p>
          <LineChart
            preserveSamples
            labels={chart.axis.map((ms) => new Date(ms).toISOString())}
            xValues={chart.axis}
            epochMs={chart.axis}
            datasets={chart.datasets}
            yLabel="TEC (TECU)"
            xLabel="Time (UTC)"
            xMin={chart.xMin}
            xMax={chart.xMax}
            xStepSize={DAY_MS}
            formatXTick={(ms) => formatUtcAxisTick(ms, { majorHours: 24 })}
            toggleableLegend
            pointRadius={3}
            height={380}
          />
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
