"use client";

import { useEffect, useMemo, useState } from "react";
import { getLiveVtecByStation } from "@/lib/api";
import type { LiveStationVtecSeries } from "@/lib/types";
import LineChart from "@/components/charts/LineChart";
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

export default function LiveTecMultiDayChart() {
  const [rows, setRows] = useState<LiveStationVtecSeries[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  return (
    <section className="station-vtec-plots" aria-label="Live TEC across days">
      <div className="station-vtec-plots-header">
        <div>
          <h2>Live TEC across days</h2>
          <p className="station-vtec-plots-sub">
            Measured GOPI code TEC at each Zimbabwe CORS station, one line per station,
            for the last 7 days. Each point is a 30-minute bin. A gap longer than 45
            minutes stays open. Surveyor General sites are not included.
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
        </>
      )}
    </section>
  );
}
