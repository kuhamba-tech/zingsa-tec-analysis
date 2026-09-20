"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGlobalVtecByStation, getLiveVtecByStation, getTecMethodComparison } from "@/lib/api";
import type {
  GlobalTecStationSeries,
  LiveObservation,
  LiveStationVtecSeries,
  TecMethodStationCompare,
} from "@/lib/types";
import LineChart from "@/components/charts/LineChart";

const HOUR_OPTIONS = [2, 6, 12, 24] as const;
const REFRESH_MS = 90_000;
const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#eab308";
const OBS_COLOR = "#3d8bfd";
const GLOBAL_COLOR = "#f0a202";
/** API caps tec-method-comparison at 8h / 600 samples. */
const GG_COMPARE_HOURS_CAP = 8;
const GG_COMPARE_LIMIT = 600;

type GgStationPoint = { time: string; vtec_tecu: number };

function normalizeStationCode(code: string): string {
  return code.toLowerCase().replace(/_+$/, "");
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

/** 24h (day) = current UTC calendar day 00:00–24:00; shorter ranges stay rolling. */
function resolveChartWindow(hours: number): {
  windowStartMs: number;
  windowEndMs: number;
  spanHours: number;
} {
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
): Record<string, GgStationPoint[]> {
  const { windowStartMs, windowEndMs } = resolveChartWindow(hours);
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

/** Align observed + global + Gg onto a shared UTC timeline (null where missing). */
function mergeSeries(
  observed: LiveStationVtecSeries,
  global: GlobalTecStationSeries | undefined,
  ggPoints: GgStationPoint[] | undefined,
  hours: number,
): {
  labels: string[];
  observed: (number | null)[];
  global: (number | null)[];
  gg: (number | null)[];
  hasObserved: boolean;
  hasGlobal: boolean;
  hasGg: boolean;
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
  const { windowStartMs, windowEndMs, spanHours } = resolveChartWindow(hours);
  const times = Array.from(new Set([...obsMap.keys(), ...globMap.keys(), ...ggMap.keys()]))
    .filter((t) => {
      const ms = new Date(t).getTime();
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs;
    })
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const useFullWindow = hours >= 12;
  const xValues = useFullWindow
    ? times.map((t) => (new Date(t).getTime() - windowStartMs) / 3_600_000)
    : undefined;
  return {
    labels: times.map(formatTick),
    observed: times.map((t) => (obsMap.has(t) ? (obsMap.get(t) as number) : null)),
    global: times.map((t) => (globMap.has(t) ? (globMap.get(t) as number) : null)),
    gg: times.map((t) => (ggMap.has(t) ? (ggMap.get(t) as number) : null)),
    hasObserved: times.some((t) => obsMap.has(t)),
    hasGlobal: times.some((t) => globMap.has(t)),
    hasGg: times.some((t) => ggMap.has(t)),
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
  const { windowStartMs, windowEndMs, spanHours } = resolveChartWindow(hours);
  const bucket = new Map<string, number[]>();
  let stationCount = 0;
  for (const row of series) {
    const usable = row.points.filter((p) => {
      const ms = new Date(p.time).getTime();
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs && p.vtec_tecu > 0;
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
  const useFullWindow = hours >= 12;
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
  hours,
  methodRow,
}: {
  series: LiveStationVtecSeries;
  globalSeries?: GlobalTecStationSeries;
  ggDirect?: GgStationPoint[];
  hours: number;
  methodRow?: TecMethodStationCompare;
}) {
  const ggPoints = resolveGgPoints(series, ggDirect, methodRow);
  const merged = mergeSeries(series, globalSeries, ggPoints, hours);
  const hasData = merged.hasObserved || merged.hasGlobal || merged.hasGg;
  const latestGlobal = globalSeries?.latest_vtec ?? null;
  const latestGg =
    methodRow?.gg_latest ??
    (ggPoints.length ? ggPoints[ggPoints.length - 1]?.vtec_tecu ?? null : null);

  const datasets = [
    ...(merged.hasObserved
      ? [
          {
            label: "Observed GOPI (NTRIP)",
            data: merged.observed,
            color: OBS_COLOR,
            fill: true,
            spanGaps: true,
          },
        ]
      : []),
    ...(merged.hasGlobal
      ? [
          {
            label: "Global TEC (DLR)",
            data: merged.global,
            color: GLOBAL_COLOR,
            dashed: true,
            fill: false,
            spanGaps: true,
          },
        ]
      : []),
    ...(merged.hasGg
      ? [
          {
            label: "Gg = Cesaroni",
            data: merged.gg,
            color: GG_COLOR,
            fill: false,
            spanGaps: true,
          },
        ]
      : []),
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
          ) : (
            <small>No live VTEC</small>
          )}
          {latestGlobal != null && (
            <>
              <em style={{ color: GLOBAL_COLOR }}>{latestGlobal.toFixed(1)} TECU</em>
              <small>global</small>
            </>
          )}
          {latestGg != null && (
            <>
              <em style={{ color: GG_COLOR }}>{latestGg.toFixed(1)} TECU</em>
              <small>Gg</small>
            </>
          )}
        </div>
      </div>
      {methodRow && (methodRow.gopi_mean != null || methodRow.gg_mean != null) && (
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
  // Default 6h so first paint succeeds under load; user can open 24h after.
  const [hours, setHours] = useState<(typeof HOUR_OPTIONS)[number]>(6);
  const [series, setSeries] = useState<LiveStationVtecSeries[]>([]);
  const [globalByStation, setGlobalByStation] = useState<Record<string, GlobalTecStationSeries>>({});
  const [ggByStation, setGgByStation] = useState<Record<string, GgStationPoint[]>>({});
  const [methodByStation, setMethodByStation] = useState<Record<string, TecMethodStationCompare>>({});
  const [globalSource, setGlobalSource] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "ok" | "down">("pending");
  const [error, setError] = useState<string | null>(null);
  const seriesRef = useRef<LiveStationVtecSeries[]>([]);
  seriesRef.current = series;

  useEffect(() => {
    let cancelled = false;
    const load = async (background = false) => {
      if (!background) setStatus("pending");
      try {
        const resample = resampleMinutesForHours(hours);
        const timeoutMs = timeoutForHours(hours);
        const loadRows = () => getLiveVtecByStation(hours, resample, timeoutMs);
        let rows: LiveStationVtecSeries[];
        try {
          rows = await loadRows();
        } catch {
          // One retry with extra headroom — concurrent map/lab traffic can stall the first call.
          await new Promise((r) => setTimeout(r, 600));
          if (cancelled) return;
          rows = await getLiveVtecByStation(hours, resample, timeoutMs + 30_000);
        }

        const cmpHours = Math.min(hours, GG_COMPARE_HOURS_CAP);
        const [globalPayload, methodPayload] = await Promise.all([
          getGlobalVtecByStation(hours).catch(() => null),
          getTecMethodComparison(
            cmpHours,
            undefined,
            GG_COMPARE_LIMIT,
            timeoutForHours(cmpHours),
          ).catch(() => null),
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
        } else {
          setGlobalByStation({});
          setGlobalSource(null);
        }

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
            buildGgSeriesByStation(methodPayload.gg, hours, resample),
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
  }, [hours]);

  const loadingSlow = status === "pending" && hours >= 12;
  const networkMean = useMemo(() => buildNetworkMeanSeries(series, hours), [series, hours]);

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
    const rows = Object.values(methodByStation).sort((a, b) =>
      a.station.localeCompare(b.station),
    );
    if (!rows.length) return null;
    return {
      labels: rows.map((r) => r.station),
      gopi: rows.map((r) => r.gopi_latest),
      gg: rows.map((r) => r.gg_latest),
    };
  }, [methodByStation]);

  const reporting = useMemo(
    () => series.filter((s) => s.points.length > 0).length,
    [series],
  );
  const globalReporting = useMemo(() => Object.keys(globalByStation).length, [globalByStation]);

  return (
    <section className={`station-vtec-plots ${className ?? ""}`.trim()} aria-label={title}>
      <div className="station-vtec-plots-header">
        <div>
          <h2 className="home-section-heading">{title}</h2>
          <p className="station-vtec-plots-sub">
            Absolute code TEC from the live NTRIP pipeline (GOPI) — solid blue. Dashed amber is DLR
            Global TEC at each station. Solid gold is Method 2 (Gg = Cesaroni) from the live
            calibration (direct samples when available, otherwise GOPI + measured Δ). Start with 6h
            for a fast load; open 24h (day) for the full UTC day. EKF predicted lines stay off until a
            real per-station EKF series exists.
          </p>
        </div>
        <div className="station-vtec-plots-controls" role="group" aria-label="VTEC history window">
          {HOUR_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              className={hours === h ? "active" : ""}
              onClick={() => setHours(h)}
            >
              {h === 24 ? "24h (day)" : `${h}h`}
            </button>
          ))}
        </div>
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
          {reporting} of {series.length || 25} stations reporting in the last{" "}
          {hours === 24 ? "UTC day (00:00-24:00)" : `${hours} h`}
          {globalReporting > 0
            ? ` · Global TEC overlay on ${globalReporting} sites${globalSource ? ` (${globalSource})` : ""}`
            : ""}
          {Object.keys(methodByStation).length > 0
            ? ` · Gg calibration on ${Object.keys(methodByStation).length} sites`
            : ""}{" "}
          · auto-refresh every {REFRESH_MS / 1000}s
        </p>
      )}

      {networkMean.stationCount > 0 && networkMean.values.some((v) => v != null) && (
        <article className="card station-vtec-plot-card station-vtec-plot-card--wide" aria-label="Network mean VTEC">
          <div className="station-vtec-plot-head">
            <div>
              <strong>Network mean VTEC</strong>
              <span>Average of stations with live GOPI samples</span>
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
          <LineChart
            labels={networkMean.labels}
            datasets={[
              {
                label: "Network mean (GOPI)",
                data: networkMean.values,
                color: "#00ff88",
                fill: true,
                spanGaps: true,
              },
            ]}
            yLabel="VTEC (TECU)"
            height={220}
            compact
            xValues={networkMean.xValues}
            xMin={networkMean.xMin}
            xMax={networkMean.xMax}
            xStepSize={networkMean.xStepSize}
            formatXTick={networkMean.formatXTick}
            xLabel={networkMean.xLabel}
          />
        </article>
      )}

      {methodCompareChart && (
        <article className="card station-vtec-plot-card station-vtec-plot-card--wide" aria-label="GOPI vs Gg latest VTEC">
          <div className="station-vtec-plot-head">
            <div>
              <strong>GOPI vs Gg — latest VTEC by station</strong>
              <span>Same live samples; Gg = Cesaroni calibration</span>
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
            ]}
            yLabel="VTEC (TECU)"
            height={220}
            compact
          />
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
              methodRow={methodByStation[code]}
              hours={hours}
            />
          );
        })}
      </div>
    </section>
  );
}
