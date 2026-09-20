"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGlobalVtecByStation, getLiveVtecByStation, getTecMethodComparison } from "@/lib/api";
import type {
  GlobalTecStationSeries,
  LiveStationVtecSeries,
  TecMethodStationCompare,
} from "@/lib/types";
import LineChart from "@/components/charts/LineChart";

const HOUR_OPTIONS = [2, 6, 12, 24] as const;
const REFRESH_MS = 90_000;
const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#f59e0b";
const OBS_COLOR = "#3d8bfd";
const GLOBAL_COLOR = "#f0a202";

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

/** Align observed + global series onto a shared UTC timeline (null where missing). */
function mergeSeries(
  observed: LiveStationVtecSeries,
  global: GlobalTecStationSeries | undefined,
  hours: number,
): {
  labels: string[];
  observed: (number | null)[];
  global: (number | null)[];
  hasObserved: boolean;
  hasGlobal: boolean;
  xValues?: number[];
  xMin?: number;
  xMax?: number;
  xStepSize?: number;
  formatXTick?: (value: number) => string;
  xLabel?: string;
} {
  const obsMap = new Map(observed.points.map((p) => [p.time, p.vtec_tecu]));
  const globMap = new Map((global?.points ?? []).map((p) => [p.time, p.vtec_tecu]));
  const { windowStartMs, windowEndMs, spanHours } = resolveChartWindow(hours);
  const times = Array.from(new Set([...obsMap.keys(), ...globMap.keys()]))
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
    hasObserved: times.some((t) => obsMap.has(t)),
    hasGlobal: times.some((t) => globMap.has(t)),
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
  hours,
  methodRow,
}: {
  series: LiveStationVtecSeries;
  globalSeries?: GlobalTecStationSeries;
  hours: number;
  methodRow?: TecMethodStationCompare;
}) {
  const merged = mergeSeries(series, globalSeries, hours);
  const hasData = merged.hasObserved || merged.hasGlobal;
  const latestGlobal = globalSeries?.latest_vtec ?? null;

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
          {methodRow?.gg_latest != null && (
            <>
              <em style={{ color: GG_COLOR }}>{methodRow.gg_latest.toFixed(1)} TECU</em>
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
        <div className="station-vtec-plot-empty">No live or Global TEC in this window.</div>
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

        const [globalPayload, methodPayload] = await Promise.all([
          getGlobalVtecByStation(hours).catch(() => null),
          getTecMethodComparison(2, undefined, 300, 60_000).catch(() => null),
        ]);
        if (cancelled) return;

        setSeries(rows);
        if (globalPayload?.available) {
          const map: Record<string, GlobalTecStationSeries> = {};
          for (const row of globalPayload.stations ?? []) {
            map[row.station.toLowerCase().replace(/_+$/, "")] = row;
          }
          if (Object.keys(map).length === 0 && (globalPayload.latest?.length ?? 0) > 0) {
            const epoch = globalPayload.epoch ?? new Date().toISOString();
            for (const row of globalPayload.latest) {
              const code = row.station.toLowerCase().replace(/_+$/, "");
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
            map[row.station.toLowerCase().replace(/_+$/, "")] = row;
          }
          setMethodByStation(map);
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
            Global TEC at each station. Station cards also show Gg (notebook) window means when the
            live calibration finishes. Start with 6h for a fast load; open 24h (day) for the full UTC
            day. EKF predicted lines stay off until a real per-station EKF series exists.
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
              <span>Same live samples; Gg = TEC_GNSS_Notebook_v5 / PyTECGg calibration</span>
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
        {orderedSeries.map((row) => (
          <StationChartCard
            key={row.station}
            series={row}
            globalSeries={globalByStation[row.station.toLowerCase().replace(/_+$/, "")]}
            methodRow={methodByStation[row.station.toLowerCase().replace(/_+$/, "")]}
            hours={hours}
          />
        ))}
      </div>
    </section>
  );
}
