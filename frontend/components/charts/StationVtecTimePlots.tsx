"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGlobalVtecByStation, getLiveVtecByStation, getStations, getTecMethodComparison } from "@/lib/api";
import type {
  GlobalTecStationSeries,
  LiveObservation,
  LiveStationVtecSeries,
  Station,
  TecMethodStationCompare,
} from "@/lib/types";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { idwFillByStation, type LatLonSite } from "@/lib/idwSurface";
import { isSurveyorGeneral, ZINGSA_STATION_TOTAL } from "@/lib/liveStationStatus";
import { runMeanVtecEkf } from "@/lib/meanVtecEkf";

const HOUR_OPTIONS = [2, 6, 12, 24] as const;
/** Live history query is capped at 7 days. */
const DAY_FILTER_COUNT = 7;
const REFRESH_MS = 90_000;
const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#eab308";
/** Chart stroke — pink so Gg stays distinct from Global TEC amber. */
const GG_LINE_COLOR = "#f472b6";
const OBS_COLOR = "#3d8bfd";
const GLOBAL_COLOR = "#f0a202";
/** Separate from GOPI blue, Gg pink, and Global amber. */
const INTERP_COLOR = "#c084fc";
/** API caps tec-method-comparison at 8h / 600 samples. */
const GG_COMPARE_HOURS_CAP = 8;
const GG_COMPARE_LIMIT = 600;

type GgStationPoint = { time: string; vtec_tecu: number };

function normalizeStationCode(code: string): string {
  return code.toLowerCase().replace(/_+$/, "");
}

function sitesFromCatalog(rows: Station[] | null | undefined): LatLonSite[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      code: normalizeStationCode(row.code),
      lat: row.lat,
      lon: row.lon,
    }))
    .filter((site) => site.code && Number.isFinite(site.lat) && Number.isFinite(site.lon));
}

function resampleMinutesForHours(hours: number): number {
  // Coarser bins = faster SQL under concurrent dashboard load.
  if (hours <= 2) return 2;
  if (hours <= 6) return 5;
  if (hours <= 12) return 10;
  return 15;
}

function timeoutForHours(hours: number): number {
  if (hours >= 24) return 90_000;
  if (hours >= 12) return 60_000;
  if (hours >= 6) return 45_000;
  return 30_000;
}

function formatTick(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16) || iso;
  return d.toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatUtcTick(windowStartMs: number, hourOffset: number): string {
  if (hourOffset >= 24) return "24:00";
  const d = new Date(windowStartMs + hourOffset * 3_600_000);
  return d.toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Snap sample time to the same bin grid as live VTEC-by-station (`…:00Z`). */
function snapIsoToBin(iso: string, resampleMinutes: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = d.getUTCMinutes();
  const snapped = Math.floor(mins / resampleMinutes) * resampleMinutes;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(snapped).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${m}:00Z`;
}

/** Normalize any ISO timestamp to a stable Map key matching GOPI bins. */
function timeKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${m}:00Z`;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function recentUtcDays(count: number): string[] {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: string[] = [];
  for (let i = 0; i < count; i += 1) {
    days.push(new Date(start - i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

function parseUtcDay(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function formatDayChip(day: string, today: string): string {
  if (day === today) return "Today";
  const ms = parseUtcDay(day);
  if (ms == null) return day;
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** Hours of history required so a chosen UTC day is inside the API lookback. */
function fetchHoursFor(hours: number, day: string | null): number {
  if (!day) return hours;
  const start = parseUtcDay(day);
  if (start == null) return hours;
  const elapsed = (Date.now() - start) / 3_600_000;
  return Math.min(168, Math.max(hours, Math.ceil(elapsed + 0.5)));
}

/** A chosen day is 00:00–24:00 UTC. 24h with no day is today. Shorter ranges stay rolling. */
function resolveChartWindow(hours: number, day?: string | null): {
  windowStartMs: number;
  windowEndMs: number;
  spanHours: number;
} {
  const selected = day ? parseUtcDay(day) : null;
  if (selected != null) {
    return {
      windowStartMs: selected,
      windowEndMs: selected + 24 * 3_600_000,
      spanHours: 24,
    };
  }
  const now = Date.now();
  if (hours >= 24) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const windowStartMs = start.getTime();
    return {
      windowStartMs,
      windowEndMs: windowStartMs + 24 * 3_600_000,
      spanHours: 24,
    };
  }
  return {
    windowStartMs: now - hours * 3_600_000,
    windowEndMs: now,
    spanHours: hours,
  };
}

/** Station-mean Gg VTEC bins from Cesaroni-calibrated comparison samples. */
function buildGgSeriesByStation(
  ggRows: LiveObservation[],
  hours: number,
  resampleMinutes: number,
  day?: string | null,
): Record<string, GgStationPoint[]> {
  const { windowStartMs, windowEndMs } = resolveChartWindow(hours, day);
  const buckets = new Map<string, Map<string, number[]>>();
  for (const o of ggRows) {
    if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu) || o.vtec_tecu <= 0) continue;
    const ms = new Date(o.time).getTime();
    if (!Number.isFinite(ms) || ms < windowStartMs || ms > windowEndMs) continue;
    const bin = snapIsoToBin(o.time, resampleMinutes);
    if (!bin) continue;
    const code = normalizeStationCode(o.station);
    let byTime = buckets.get(code);
    if (!byTime) {
      byTime = new Map();
      buckets.set(code, byTime);
    }
    const vals = byTime.get(bin) ?? [];
    vals.push(o.vtec_tecu);
    byTime.set(bin, vals);
  }
  const out: Record<string, GgStationPoint[]> = {};
  for (const [code, byTime] of buckets) {
    out[code] = Array.from(byTime.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([time, vals]) => ({
        time,
        vtec_tecu: vals.reduce((a, b) => a + b, 0) / vals.length,
      }));
  }
  return out;
}

/**
 * Prefer direct Gg bins; when sparse (or chart window longer than comparison),
 * reconstruct Gg ≈ GOPI + Δmean so the Cesaroni method still appears on the plot.
 */
function resolveGgPoints(
  observed: LiveStationVtecSeries,
  ggDirect: GgStationPoint[] | undefined,
  methodRow: TecMethodStationCompare | undefined,
): GgStationPoint[] {
  const direct = ggDirect ?? [];
  if (direct.length >= 3) return direct;

  const delta =
    methodRow?.delta_mean ??
    (methodRow?.gg_mean != null && methodRow?.gopi_mean != null
      ? methodRow.gg_mean - methodRow.gopi_mean
      : null);
  if (delta != null && Number.isFinite(delta) && observed.points.length > 0) {
    return observed.points.map((p) => ({
      time: timeKey(p.time),
      vtec_tecu: Math.round((p.vtec_tecu + delta) * 100) / 100,
    }));
  }
  return direct;
}

/**
 * Time series of inverse-distance GOPI for sites that have no own sample at
 * that minute. Measured values are never copied into this series.
 */
function buildInterpolatedByStation(
  series: LiveStationVtecSeries[],
  sites: LatLonSite[],
  hours: number,
  day?: string | null,
): Record<string, GgStationPoint[]> {
  const targets = sites.filter((site) => !isSurveyorGeneral(site.code));
  if (targets.length < 2) return {};
  const { windowStartMs, windowEndMs } = resolveChartWindow(hours, day);
  const measuredAtTime = new Map<string, Record<string, number>>();
  for (const row of series) {
    const code = normalizeStationCode(row.station);
    if (isSurveyorGeneral(code)) continue;
    for (const point of row.points) {
      if (!Number.isFinite(point.vtec_tecu) || point.vtec_tecu <= 0) continue;
      const ms = new Date(point.time).getTime();
      if (!Number.isFinite(ms) || ms < windowStartMs || ms > windowEndMs) continue;
      const key = timeKey(point.time);
      const bucket = measuredAtTime.get(key) ?? {};
      bucket[code] = point.vtec_tecu;
      measuredAtTime.set(key, bucket);
    }
  }

  const out: Record<string, GgStationPoint[]> = {};
  const times = [...measuredAtTime.keys()].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  for (const time of times) {
    const fill = idwFillByStation(targets, measuredAtTime.get(time) ?? {});
    for (const code of Object.keys(fill.interpolated)) {
      const value = fill.values[code];
      if (value == null || !Number.isFinite(value)) continue;
      const list = out[code] ?? [];
      list.push({ time, vtec_tecu: value });
      out[code] = list;
    }
  }
  return out;
}

/** Align observed + global + Gg + interpolated onto a shared UTC timeline. */
function mergeSeries(
  observed: LiveStationVtecSeries,
  global: GlobalTecStationSeries | undefined,
  ggPoints: GgStationPoint[] | undefined,
  interpolated: GgStationPoint[] | undefined,
  hours: number,
  day?: string | null,
): {
  labels: string[];
  observed: (number | null)[];
  global: (number | null)[];
  gg: (number | null)[];
  interpolated: (number | null)[];
  hasObserved: boolean;
  hasGlobal: boolean;
  hasGg: boolean;
  hasInterpolated: boolean;
  xValues?: number[];
  xMin?: number;
  xMax?: number;
  xStepSize?: number;
  formatXTick?: (value: number) => string;
  xLabel?: string;
} {
  const obsMap = new Map(observed.points.map((p) => [timeKey(p.time), p.vtec_tecu]));
  const globMap = new Map((global?.points ?? []).map((p) => [timeKey(p.time), p.vtec_tecu]));
  const ggMap = new Map((ggPoints ?? []).map((p) => [timeKey(p.time), p.vtec_tecu]));
  const interpMap = new Map((interpolated ?? []).map((p) => [timeKey(p.time), p.vtec_tecu]));
  const { windowStartMs, windowEndMs, spanHours } = resolveChartWindow(hours, day);
  const times = Array.from(new Set([...obsMap.keys(), ...globMap.keys(), ...ggMap.keys(), ...interpMap.keys()]))
    .filter((t) => {
      const ms = new Date(t).getTime();
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs;
    })
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const useFullWindow = Boolean(day) || hours >= 12;
  const xValues = useFullWindow
    ? times.map((t) => (new Date(t).getTime() - windowStartMs) / 3_600_000)
    : undefined;
  return {
    labels: times.map(formatTick),
    observed: times.map((t) => (obsMap.has(t) ? (obsMap.get(t) as number) : null)),
    global: times.map((t) => (globMap.has(t) ? (globMap.get(t) as number) : null)),
    gg: times.map((t) => (ggMap.has(t) ? (ggMap.get(t) as number) : null)),
    interpolated: times.map((t) => (interpMap.has(t) ? (interpMap.get(t) as number) : null)),
    hasObserved: times.some((t) => obsMap.has(t)),
    hasGlobal: times.some((t) => globMap.has(t)),
    hasGg: times.some((t) => ggMap.has(t)),
    hasInterpolated: times.some((t) => interpMap.has(t)),
    xValues,
    xMin: useFullWindow ? 0 : undefined,
    xMax: useFullWindow ? spanHours : undefined,
    xStepSize: useFullWindow ? (spanHours >= 24 ? 4 : 2) : undefined,
    formatXTick: useFullWindow
      ? (value: number) => formatUtcTick(windowStartMs, value)
      : undefined,
    xLabel: useFullWindow ? "Time (UTC)" : undefined,
  };
}

function buildNetworkMeanSeries(
  series: LiveStationVtecSeries[],
  hours: number,
  day?: string | null,
): {
  labels: string[];
  values: (number | null)[];
  xValues?: number[];
  xMin?: number;
  xMax?: number;
  xStepSize?: number;
  formatXTick?: (value: number) => string;
  xLabel?: string;
  stationCount: number;
} {
  const { windowStartMs, windowEndMs, spanHours } = resolveChartWindow(hours, day);
  const bucket = new Map<string, number[]>();
  let stationCount = 0;
  for (const row of series) {
    const usable = row.points.filter((p) => {
      const ms = new Date(p.time).getTime();
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs && p.vtec_tecu > 0 && p.vtec_tecu <= 50;
    });
    if (!usable.length) continue;
    stationCount += 1;
    for (const p of usable) {
      const list = bucket.get(p.time) ?? [];
      list.push(p.vtec_tecu);
      bucket.set(p.time, list);
    }
  }
  const times = Array.from(bucket.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  const useFullWindow = Boolean(day) || hours >= 12;
  return {
    labels: times.map(formatTick),
    values: times.map((t) => {
      const vals = bucket.get(t) ?? [];
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }),
    xValues: useFullWindow
      ? times.map((t) => (new Date(t).getTime() - windowStartMs) / 3_600_000)
      : undefined,
    xMin: useFullWindow ? 0 : undefined,
    xMax: useFullWindow ? spanHours : undefined,
    xStepSize: useFullWindow ? (spanHours >= 24 ? 4 : 2) : undefined,
    formatXTick: useFullWindow
      ? (value: number) => formatUtcTick(windowStartMs, value)
      : undefined,
    xLabel: useFullWindow ? "Time (UTC)" : undefined,
    stationCount,
  };
}

function StationChartCard({
  series,
  globalSeries,
  ggDirect,
  interpolatedPoints,
  hours,
  day,
  methodRow,
}: {
  series: LiveStationVtecSeries;
  globalSeries?: GlobalTecStationSeries;
  ggDirect?: GgStationPoint[];
  interpolatedPoints?: GgStationPoint[];
  hours: number;
  day?: string | null;
  methodRow?: TecMethodStationCompare;
}) {
  const ggPoints = resolveGgPoints(series, ggDirect, methodRow);
  const merged = mergeSeries(series, globalSeries, ggPoints, interpolatedPoints, hours, day);
  const hasData = merged.hasObserved || merged.hasGlobal || merged.hasGg || merged.hasInterpolated;
  const latestInterpolated = interpolatedPoints?.length
    ? interpolatedPoints[interpolatedPoints.length - 1]?.vtec_tecu ?? null
    : null;
  const latestGlobal = globalSeries?.latest_vtec ?? null;
  const latestGg =
    methodRow?.gg_latest ??
    (ggPoints.length ? ggPoints[ggPoints.length - 1]?.vtec_tecu ?? null : null);

  // A station with its own GOPI samples opens on the observed chart.
  // A station with none (Binga, Chimanimani, any other silent site) opens on
  // the interpolated series, with the global map beside it.
  const interpolatedDataset = {
    label: "Interpolated data",
    data: merged.interpolated,
    color: INTERP_COLOR,
    borderDash: [8, 3, 2, 3] as number[],
    borderWidth: 2.5,
    fill: false,
    spanGaps: true,
  };
  const globalDataset = {
    label: "Global TEC (DLR)",
    data: merged.global,
    color: GLOBAL_COLOR,
    dashed: true,
    fill: false,
    spanGaps: true,
  };
  const datasets = merged.hasObserved
    ? [
        ...(merged.hasInterpolated ? [interpolatedDataset] : []),
        {
          label: "Observed GOPI (NTRIP)",
          data: merged.observed,
          color: OBS_COLOR,
          fill: true,
          spanGaps: true,
        },
        ...(merged.hasGlobal ? [globalDataset] : []),
        ...(merged.hasGg
          ? [
              {
                label: "Gg = Cesaroni",
                data: merged.gg,
                color: GG_LINE_COLOR,
                borderDash: [2, 3] as number[],
                borderWidth: 2.5,
                fill: false,
                spanGaps: true,
              },
            ]
          : []),
      ]
    : [
        ...(merged.hasInterpolated ? [interpolatedDataset] : []),
        ...(merged.hasGlobal ? [globalDataset] : []),
      ];

  return (
    <article className="card station-vtec-plot-card" aria-label={`${series.station} VTEC time series`}>
      <div className="station-vtec-plot-head">
        <div>
          <strong>{series.station.toUpperCase()}</strong>
          <span>{series.name}</span>
        </div>
        <div className="station-vtec-plot-stats">
          {series.latest_vtec != null ? (
            <>
              <em>{series.latest_vtec.toFixed(1)} TECU</em>
              <small>GOPI</small>
            </>
          ) : latestInterpolated != null ? (
            <>
              <em style={{ color: INTERP_COLOR }}>{latestInterpolated.toFixed(1)} TECU</em>
              <small>Interpolated data</small>
            </>
          ) : (
            <small>No live VTEC</small>
          )}
          {latestGlobal != null && (
            <>
              <em style={{ color: GLOBAL_COLOR }}>{latestGlobal.toFixed(1)} TECU</em>
              <small>global</small>
            </>
          )}
          {merged.hasObserved && latestGg != null && (
            <>
              <em style={{ color: GG_COLOR }}>{latestGg.toFixed(1)} TECU</em>
              <small>Gg</small>
            </>
          )}
        </div>
      </div>
      {merged.hasObserved && methodRow && (methodRow.gopi_mean != null || methodRow.gg_mean != null) && (
        <div className="station-vtec-method-chip" title="Live window means from GOPI vs Gg calibration">
          <span style={{ color: GOPI_COLOR }}>
            GOPI mean {methodRow.gopi_mean != null ? methodRow.gopi_mean.toFixed(1) : "—"}
          </span>
          <span aria-hidden>·</span>
          <span style={{ color: GG_COLOR }}>
            Gg mean {methodRow.gg_mean != null ? methodRow.gg_mean.toFixed(1) : "—"}
          </span>
          {methodRow.delta_mean != null && (
            <>
              <span aria-hidden>·</span>
              <span>Δ {methodRow.delta_mean >= 0 ? "+" : ""}{methodRow.delta_mean.toFixed(1)}</span>
            </>
          )}
        </div>
      )}
      {hasData ? (
        <LineChart
          labels={merged.labels}
          datasets={datasets}
          yLabel="VTEC (TECU)"
          height={200}
          compact
          preserveSamples
          xValues={merged.xValues}
          xMin={merged.xMin}
          xMax={merged.xMax}
          xStepSize={merged.xStepSize}
          formatXTick={merged.formatXTick}
          xLabel={merged.xLabel}
        />
      ) : (
        <div className="station-vtec-plot-empty">No live, Global, or Gg TEC in this window.</div>
      )}
    </article>
  );
}

interface Props {
  /** Optional title override for embedding contexts. */
  title?: string;
  className?: string;
}

export default function StationVtecTimePlots({
  title = "Live VTEC vs time — every CORS station",
  className,
}: Props) {
  // 24h opens today's UTC day. The day chips plot any of the last 7 days.
  const [hours, setHours] = useState<(typeof HOUR_OPTIONS)[number]>(24);
  const [selectedDay, setSelectedDay] = useState<string | null>(utcToday);
  const [series, setSeries] = useState<LiveStationVtecSeries[]>([]);
  const [globalByStation, setGlobalByStation] = useState<Record<string, GlobalTecStationSeries>>({});
  const [sites, setSites] = useState<LatLonSite[]>([]);
  const [ggByStation, setGgByStation] = useState<Record<string, GgStationPoint[]>>({});
  const [methodByStation, setMethodByStation] = useState<Record<string, TecMethodStationCompare>>({});
  const [globalSource, setGlobalSource] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "ok" | "down">("pending");
  const [meanExplainOpen, setMeanExplainOpen] = useState(false);
  const [compareExplainOpen, setCompareExplainOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seriesRef = useRef<LiveStationVtecSeries[]>([]);
  seriesRef.current = series;

  useEffect(() => {
    let cancelled = false;
    const load = async (background = false) => {
      if (!background) setStatus("pending");
      try {
        const lookback = fetchHoursFor(hours, selectedDay);
        const resample = resampleMinutesForHours(selectedDay ? 24 : hours);
        const timeoutMs = timeoutForHours(lookback);
        const loadRows = () => getLiveVtecByStation(lookback, resample, timeoutMs);
        let rows: LiveStationVtecSeries[];
        try {
          rows = await loadRows();
        } catch {
          // One retry with extra headroom — concurrent map/lab traffic can stall the first call.
          await new Promise((r) => setTimeout(r, 600));
          if (cancelled) return;
          rows = await getLiveVtecByStation(lookback, resample, timeoutMs + 30_000);
        }
        if (rows.length === 0) {
          await new Promise((r) => setTimeout(r, 800));
          if (cancelled) return;
          rows = await getLiveVtecByStation(lookback, resample, timeoutMs + 30_000);
        }
        // [] is a failed history read. A real empty day is the station catalog with no points.
        if (rows.length === 0) {
          throw new Error("Live GOPI history did not return samples");
        }
        if (cancelled) return;
        // Draw GOPI immediately. Global TEC and Gg can take much longer and must
        // not keep the 24-hour graph on the loading message.
        setSeries(rows);
        setError(null);
        setStatus("ok");

        const cmpHours = Math.min(hours, GG_COMPARE_HOURS_CAP);
        const [globalPayload, methodPayload, catalog] = await Promise.all([
          getGlobalVtecByStation(Math.min(48, lookback)).catch(() => null),
          getTecMethodComparison(
            cmpHours,
            undefined,
            GG_COMPARE_LIMIT,
            timeoutForHours(cmpHours),
          ).catch(() => null),
          getStations(false).catch(() => null),
        ]);
        if (cancelled) return;

        setSeries(rows);
        if (globalPayload?.available) {
          const map: Record<string, GlobalTecStationSeries> = {};
          for (const row of globalPayload.stations ?? []) {
            map[normalizeStationCode(row.station)] = row;
          }
          if (Object.keys(map).length === 0 && (globalPayload.latest?.length ?? 0) > 0) {
            const epoch = globalPayload.epoch ?? new Date().toISOString();
            for (const row of globalPayload.latest) {
              const code = normalizeStationCode(row.station);
              map[code] = {
                station: code,
                points: [{ time: epoch, vtec_tecu: row.vtec_tecu }],
                latest_vtec: row.vtec_tecu,
              };
            }
          }
          setGlobalByStation(map);
          setGlobalSource(globalPayload.source);
          const located = (globalPayload.latest ?? [])
            .map((row) => ({
              code: normalizeStationCode(row.station),
              lat: row.lat,
              lon: row.lon,
            }))
            .filter((site) => Number.isFinite(site.lat) && Number.isFinite(site.lon));
          if (located.length) setSites(located);
        } else {
          setGlobalByStation({});
          setGlobalSource(null);
        }
        const catalogSites = sitesFromCatalog(catalog);
        if (catalogSites.length) setSites(catalogSites);

        if (methodPayload?.stations?.length) {
          const map: Record<string, TecMethodStationCompare> = {};
          for (const row of methodPayload.stations) {
            map[normalizeStationCode(row.station)] = row;
          }
          setMethodByStation(map);
        } else {
          setMethodByStation({});
        }

        if (methodPayload?.gg?.length) {
          setGgByStation(
            buildGgSeriesByStation(methodPayload.gg, hours, resample, selectedDay),
          );
        } else {
          setGgByStation({});
        }

        setError(null);
        setStatus("ok");
      } catch (err) {
        if (cancelled) return;
        if (!background) {
          // Keep previous charts visible when a refresh times out.
          const hadSeries = seriesRef.current.length > 0;
          setStatus(hadSeries ? "ok" : "down");
          setError(err instanceof Error ? err.message : "Failed to load live VTEC series");
        }
      }
    };
    void load(false);
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hours, selectedDay]);

  const loadingSlow = status === "pending" && hours >= 12;
  const networkMean = useMemo(
    () => buildNetworkMeanSeries(series, hours, selectedDay),
    [series, hours, selectedDay],
  );
  const networkEkf = useMemo(() => runMeanVtecEkf(networkMean.values), [networkMean.values]);
  const networkEkfReady = networkEkf.predicted.some((value) => value != null);
  const networkMeanAnalysis = useMemo(() => {
    let latest: number | null = null;
    let latestAt = "";
    let peak: number | null = null;
    let peakAt = "";
    let pairedEkf: number | null = null;
    for (const [index, value] of networkMean.values.entries()) {
      if (value == null || !Number.isFinite(value)) continue;
      latest = value;
      latestAt = networkMean.labels[index] ?? "";
      const forecast = networkEkf.predicted[index];
      if (forecast != null && Number.isFinite(forecast)) pairedEkf = forecast;
      if (peak == null || value > peak) {
        peak = value;
        peakAt = networkMean.labels[index] ?? "";
      }
    }
    const windowLabel = selectedDay
      ? `${selectedDay} UTC, 00:00–24:00`
      : `the last ${hours} h`;
    const measured = latest != null
      ? `The latest network mean is ${latest.toFixed(1)} TECU${latestAt ? ` at ${latestAt} UTC` : ""}, from ${networkMean.stationCount} stations.${peak != null ? ` The highest mean in this plot is ${peak.toFixed(1)} TECU${peakAt ? ` at ${peakAt} UTC` : ""}.` : ""}`
      : "No measured network mean is available in this window.";
    const filter = pairedEkf != null && latest != null
      ? `The filter forecast beside the latest sample is ${pairedEkf.toFixed(1)} TECU, so the observed mean differs by ${Math.abs(latest - pairedEkf).toFixed(1)} TECU. A single-bin spike stays on the solid line. The filter coasts until that new level holds for two further samples.`
      : "The dashed forecast stays off until the filter has a real observed start. No prediction is invented for a window the filter cannot run.";
    return {
      lead: `This graph means the average vertical TEC of the Zimbabwe CORS stations that reported live GOPI in ${windowLabel}. The solid green line is that observed mean. The dashed line, when it is drawn, is the Extended Kalman Filter forecast made before each sample is seen. Elevation below 30° and TEC outside 0–50 TECU are left out. Its importance is the ionosphere over the network: a quiet day rises through the morning, and a jump the filter does not follow is the first local sign that the mean has left that smooth curve.`,
      bullets: [measured, filter],
    };
  }, [hours, networkEkf.predicted, networkMean.labels, networkMean.stationCount, networkMean.values, selectedDay]);
  const interpolatedByStation = useMemo(
    () => buildInterpolatedByStation(series, sites, hours, selectedDay),
    [series, sites, hours, selectedDay],
  );

  const orderedSeries = useMemo(() => {
    return [...series].sort((a, b) => {
      const aPts = a.points.length;
      const bPts = b.points.length;
      if (aPts > 0 && bPts === 0) return -1;
      if (bPts > 0 && aPts === 0) return 1;
      return a.station.localeCompare(b.station);
    });
  }, [series]);

  const methodCompareChart = useMemo(() => {
    const codes = new Set<string>([
      ...Object.keys(methodByStation),
      ...Object.keys(globalByStation),
    ]);
    const labels = [...codes].sort((a, b) => a.localeCompare(b));
    if (!labels.length) return null;
    return {
      labels: labels.map((code) => code.toUpperCase()),
      gopi: labels.map((code) => methodByStation[code]?.gopi_latest ?? null),
      gg: labels.map((code) => methodByStation[code]?.gg_latest ?? null),
      global: labels.map((code) => globalByStation[code]?.latest_vtec ?? null),
    };
  }, [methodByStation, globalByStation]);

  const methodCompareAnalysis = useMemo(() => {
    if (!methodCompareChart) return { lead: "", bullets: [] as string[] };
    const finite = (value: number | null): value is number => value != null && Number.isFinite(value);
    const average = (values: (number | null)[]) => {
      const kept = values.filter(finite);
      if (!kept.length) return null;
      return kept.reduce((sum, value) => sum + value, 0) / kept.length;
    };
    let widestCal: { station: string; gap: number; gopi: number; gg: number } | null = null;
    let widestMap: { station: string; gap: number; gopi: number; global: number } | null = null;
    for (const [index, station] of methodCompareChart.labels.entries()) {
      const gopi = methodCompareChart.gopi[index];
      const gg = methodCompareChart.gg[index];
      const globalTec = methodCompareChart.global[index];
      if (finite(gopi) && finite(gg)) {
        const gap = Math.abs(gopi - gg);
        if (!widestCal || gap > widestCal.gap) widestCal = { station, gap, gopi, gg };
      }
      if (finite(gopi) && finite(globalTec)) {
        const gap = Math.abs(gopi - globalTec);
        if (!widestMap || gap > widestMap.gap) widestMap = { station, gap, gopi, global: globalTec };
      }
    }
    const gopiMean = average(methodCompareChart.gopi);
    const ggMean = average(methodCompareChart.gg);
    const globalMean = average(methodCompareChart.global);
    const paired = methodCompareChart.labels.filter((_, index) =>
      finite(methodCompareChart.gopi[index]) && finite(methodCompareChart.gg[index]),
    ).length;
    const mapped = methodCompareChart.labels.filter((_, index) =>
      finite(methodCompareChart.gopi[index]) && finite(methodCompareChart.global[index]),
    ).length;
    const levelParts: string[] = [];
    if (gopiMean != null) levelParts.push(`the latest GOPI averages ${gopiMean.toFixed(1)} TECU`);
    if (ggMean != null) levelParts.push(`Gg averages ${ggMean.toFixed(1)} TECU`);
    if (globalMean != null) levelParts.push(`the DLR map at those sites averages ${globalMean.toFixed(1)} TECU`);
    const joinedLevels = levelParts.length <= 1
      ? (levelParts[0] ?? "")
      : levelParts.length === 2
        ? `${levelParts[0]} and ${levelParts[1]}`
        : `${levelParts.slice(0, -1).join(", ")}, and ${levelParts[levelParts.length - 1]}`;
    const levels = joinedLevels
      ? `Across the stations drawn, ${joinedLevels}.`
      : "No latest station values are available for this comparison.";
    const calibration = widestCal
      ? `GOPI and Gg are paired at ${paired} stations. The widest calibration gap is ${widestCal.gap.toFixed(1)} TECU at ${widestCal.station} (GOPI ${widestCal.gopi.toFixed(1)}, Gg ${widestCal.gg.toFixed(1)}). A gap of that size at one site is a calibration or sample-quality question. It is not, by itself, a geomagnetic storm.`
      : "No station has both a GOPI and a Gg latest value in this comparison.";
    const mapGap = widestMap && gopiMean != null && globalMean != null
      ? `GOPI and the global map are paired at ${mapped} stations. The widest local-minus-map gap is ${widestMap.gap.toFixed(1)} TECU at ${widestMap.station} (GOPI ${widestMap.gopi.toFixed(1)}, map ${widestMap.global.toFixed(1)}). The map is a smooth large-scale product, so it can sit above or below the local code TEC without a storm. Zimbabwe is checked with the network mean and S4, not with this gap alone.`
      : "No station has both a GOPI sample and a DLR map value in this comparison.";
    return {
      lead: "This graph means the latest vertical TEC at each Zimbabwe CORS station. It is not a time series: the horizontal axis is the station. Blue is GOPI, the live code TEC from the NTRIP pipeline. Yellow is Gg, the Cesaroni calibration of those samples. Orange is the DLR global TEC map read at the same site. Its importance is agreement. GOPI and Gg should track each other, and both are the local ionosphere. The orange line is the large-scale map, so a steady offset from the local lines is a product difference, not a storm rating.",
      bullets: [levels, calibration, mapGap],
    };
  }, [methodCompareChart]);

  const reporting = useMemo(() => {
    const { windowStartMs, windowEndMs } = resolveChartWindow(hours, selectedDay);
    return series.filter((row) => {
      if (isSurveyorGeneral(row.station)) return false;
      return row.points.some((point) => {
        const ms = new Date(point.time).getTime();
        return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs && point.vtec_tecu > 0;
      });
    }).length;
  }, [series, hours, selectedDay]);
  const globalReporting = useMemo(() => Object.keys(globalByStation).length, [globalByStation]);

  return (
    <section className={`station-vtec-plots ${className ?? ""}`.trim()} aria-label={title}>
      <div className="station-vtec-plots-header">
        <div>
          <h2 className="home-section-heading">{title}</h2>
          <p className="station-vtec-plots-sub">
            Absolute code TEC from the live NTRIP pipeline (GOPI) — solid blue, joined across the minutes between samples. Dashed amber is DLR
            Global TEC at each station. Dotted pink is Method 2 (Gg = Cesaroni). Purple dash-dot is
            interpolated data: inverse-distance GOPI for red (offline) sites and for any gap with no
            own sample, drawn as a continuous line from the stations that are measuring. 24h plots one
            UTC day from 00:00 to 24:00. Choose another day to display that graph. EKF predicted lines
            stay off until a real per-station EKF series exists.
          </p>
        </div>
      </div>
      <div className="station-vtec-plots-controls">
        <div className="station-vtec-hour-filters" role="group" aria-label="VTEC history window">
          {HOUR_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              className={hours === h ? "active" : ""}
              onClick={() => {
                setHours(h);
                setSelectedDay(h === 24 ? utcToday() : null);
              }}
            >
              {h === 24 ? "24h" : `${h}h`}
            </button>
          ))}
        </div>
        {hours >= 24 && (
          <div className="station-vtec-day-filters" role="group" aria-label="UTC day">
            {recentUtcDays(DAY_FILTER_COUNT).map((day) => (
              <button
                key={day}
                type="button"
                className={selectedDay === day ? "active" : ""}
                title={`${day} UTC`}
                onClick={() => {
                  setHours(24);
                  setSelectedDay(day);
                }}
              >
                {formatDayChip(day, utcToday())}
              </button>
            ))}
          </div>
        )}
      </div>

      {status === "pending" && series.length === 0 && (
        <div className="banner banner-info">
          {loadingSlow
            ? "Loading full-day VTEC history from the local database (can take up to ~90s under load)…"
            : "Loading live VTEC time series for all CORS stations…"}
        </div>
      )}
      {status === "pending" && series.length > 0 && (
        <div className="banner banner-info">Refreshing VTEC charts… previous window still shown.</div>
      )}
      {error && (
        <div className={`banner ${series.length ? "banner-info" : "banner-warn"}`}>
          {series.length
            ? `Refresh issue: ${error}. Showing last successful charts.`
            : error}
        </div>
      )}
      {status === "ok" && (
        <p className="station-vtec-plots-meta">
          {reporting} of {ZINGSA_STATION_TOTAL} stations reporting{" "}
          {selectedDay ? `on ${selectedDay} UTC (00:00–24:00)` : `in the last ${hours} h`}
          {globalReporting > 0
            ? ` · Global TEC overlay on ${globalReporting} sites${globalSource ? ` (${globalSource})` : ""}`
            : ""}
          {Object.keys(methodByStation).length > 0
            ? ` · Gg = Cesaroni overlay on ${Object.keys(methodByStation).length} sites`
            : ""}{" "}
          · auto-refresh every {REFRESH_MS / 1000}s
        </p>
      )}

      {(networkMean.values.some((v) => v != null) || hours >= 24 || status !== "pending") && (
        <article
          className="card station-vtec-plot-card station-vtec-plot-card--wide"
          aria-label="Network mean VTEC"
          aria-expanded={meanExplainOpen}
          onClick={() => setMeanExplainOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setMeanExplainOpen((open) => !open);
            }
          }}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
        >
          <div className="station-vtec-plot-head">
            <div>
              <strong>Network mean VTEC</strong>
              <span>
                Average of stations with live GOPI samples
                {selectedDay ? ` on ${selectedDay} UTC, plotted across 00:00–24:00` : ` for the last ${hours} h`}.
                Elevation below 30° and TEC outside 0–50 TECU are excluded.
                The dashed line is the Extended Kalman Filter forecast; a one-bin jump stays on the solid line.
              </span>
            </div>
            <div className="station-vtec-plot-stats">
              <em>
                {(
                  [...networkMean.values].reverse().find((v) => v != null) as number | undefined
                )?.toFixed(1) ?? "—"}{" "}
                TECU
              </em>
              <small>{networkMean.stationCount} stations</small>
            </div>
          </div>
          {networkMean.values.some((value) => value != null) ? (
          <LineChart
            labels={networkMean.labels}
            datasets={[
              {
                label: "Observed",
                data: networkMean.values,
                color: "#00ff88",
                fill: true,
                spanGaps: true,
                tension: 0,
              },
              ...(networkEkfReady
                ? [
                    {
                      label: "EKF Predicted",
                      data: networkEkf.predicted,
                      color: "#e2e8f0",
                      dashed: true,
                      fill: false,
                      spanGaps: false,
                      tension: 0,
                      meta: networkEkf.meta,
                    },
                  ]
                : []),
            ]}
            yLabel="VTEC (TECU)"
            height={220}
            preserveSamples
            xValues={networkMean.xValues}
            xMin={networkMean.xMin}
            xMax={networkMean.xMax}
            xStepSize={networkMean.xStepSize}
            formatXTick={networkMean.formatXTick}
            xLabel={networkMean.xLabel}
          />
          ) : (
            <div className="station-vtec-plot-empty">
              {status === "pending"
                ? "Loading the 24-hour graph…"
                : status === "down"
                  ? "Live GOPI history did not load. The chart will retry."
                  : `No measured GOPI on ${selectedDay ?? "this window"}.`}
            </div>
          )}
          <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.45rem", fontWeight: 700 }}>
            {meanExplainOpen ? "Click the graph to hide the explanation" : "Click the graph for what it means"}
          </div>
          {meanExplainOpen && (
            <ChartAnalysisBox
              block={networkMeanAnalysis}
              title="What this graph means"
              afterLeadTitle="Scientific explanation"
            />
          )}
        </article>
      )}

      {methodCompareChart && (
        <article
          className="card station-vtec-plot-card station-vtec-plot-card--wide"
          aria-label="GOPI vs Gg latest VTEC"
          aria-expanded={compareExplainOpen}
          onClick={() => setCompareExplainOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setCompareExplainOpen((open) => !open);
            }
          }}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
        >
          <div className="station-vtec-plot-head">
            <div>
              <strong>GOPI, Gg and Global TEC by station</strong>
              <span>Measured GOPI and Gg against DLR global TEC at the same site</span>
            </div>
          </div>
          <LineChart
            labels={methodCompareChart.labels}
            datasets={[
              {
                label: "GOPI latest",
                data: methodCompareChart.gopi,
                color: GOPI_COLOR,
                fill: false,
                spanGaps: true,
              },
              {
                label: "Gg latest",
                data: methodCompareChart.gg,
                color: GG_COLOR,
                fill: false,
                spanGaps: true,
              },
              {
                label: "Global TEC",
                data: methodCompareChart.global,
                color: GLOBAL_COLOR,
                fill: false,
                spanGaps: true,
              },
            ]}
            yLabel="VTEC (TECU)"
            height={220}
            compact
          />
          <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.45rem", fontWeight: 700 }}>
            {compareExplainOpen ? "Click the graph to hide the explanation" : "Click the graph for what it means"}
          </div>
          {compareExplainOpen && (
            <ChartAnalysisBox
              block={methodCompareAnalysis}
              title="What this graph means"
              afterLeadTitle="Scientific explanation"
            />
          )}
        </article>
      )}

      <div className="station-vtec-plots-grid">
        {orderedSeries.map((row) => {
          const code = normalizeStationCode(row.station);
          return (
            <StationChartCard
              key={row.station}
              series={row}
              globalSeries={globalByStation[code]}
              ggDirect={ggByStation[code]}
              interpolatedPoints={interpolatedByStation[code]}
              methodRow={methodByStation[code]}
              hours={hours}
              day={selectedDay}
            />
          );
        })}
      </div>
    </section>
  );
}
