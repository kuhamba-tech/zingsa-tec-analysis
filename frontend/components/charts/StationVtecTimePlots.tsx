"use client";

import { useEffect, useMemo, useState } from "react";
import { getGlobalVtecByStation, getLiveVtecByStation } from "@/lib/api";
import type { GlobalTecStationSeries, LiveStationVtecSeries } from "@/lib/types";
import LineChart from "@/components/charts/LineChart";

const HOUR_OPTIONS = [2, 6, 12] as const;
const REFRESH_MS = 90_000;

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

/** Align observed + global series onto a shared UTC timeline (null where missing). */
function mergeSeries(
  observed: LiveStationVtecSeries,
  global: GlobalTecStationSeries | undefined,
): {
  labels: string[];
  observed: (number | null)[];
  global: (number | null)[];
  hasObserved: boolean;
  hasGlobal: boolean;
} {
  const obsMap = new Map(observed.points.map((p) => [p.time, p.vtec_tecu]));
  const globMap = new Map((global?.points ?? []).map((p) => [p.time, p.vtec_tecu]));
  const times = Array.from(new Set([...obsMap.keys(), ...globMap.keys()])).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  return {
    labels: times.map(formatTick),
    observed: times.map((t) => (obsMap.has(t) ? (obsMap.get(t) as number) : null)),
    global: times.map((t) => (globMap.has(t) ? (globMap.get(t) as number) : null)),
    hasObserved: obsMap.size > 0,
    hasGlobal: globMap.size > 0,
  };
}

function StationChartCard({
  series,
  globalSeries,
}: {
  series: LiveStationVtecSeries;
  globalSeries?: GlobalTecStationSeries;
}) {
  const merged = mergeSeries(series, globalSeries);
  const hasData = merged.hasObserved || merged.hasGlobal;
  const latestGlobal = globalSeries?.latest_vtec ?? null;

  const datasets = [
    ...(merged.hasObserved
      ? [
          {
            label: "Observed (NTRIP)",
            data: merged.observed,
            color: "#3d8bfd",
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
            color: "#f0a202",
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
              <small>observed</small>
            </>
          ) : (
            <small>No live VTEC</small>
          )}
          {latestGlobal != null && (
            <>
              <em style={{ color: "#f0a202" }}>{latestGlobal.toFixed(1)} TECU</em>
              <small>global</small>
            </>
          )}
        </div>
      </div>
      {hasData ? (
        <LineChart
          labels={merged.labels}
          datasets={datasets}
          yLabel="VTEC (TECU)"
          height={180}
          compact
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
  const [hours, setHours] = useState<(typeof HOUR_OPTIONS)[number]>(6);
  const [series, setSeries] = useState<LiveStationVtecSeries[]>([]);
  const [globalByStation, setGlobalByStation] = useState<Record<string, GlobalTecStationSeries>>({});
  const [globalSource, setGlobalSource] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "ok" | "down">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (background = false) => {
      if (!background) setStatus("pending");
      try {
        const [rows, globalPayload] = await Promise.all([
          getLiveVtecByStation(hours, hours <= 2 ? 1 : 2),
          getGlobalVtecByStation(hours).catch(() => null),
        ]);
        if (cancelled) return;
        setSeries(rows);
        if (globalPayload?.available) {
          const map: Record<string, GlobalTecStationSeries> = {};
          for (const row of globalPayload.stations ?? []) {
            map[row.station.toLowerCase().replace(/_+$/, "")] = row;
          }
          // If history is empty but we just sampled "latest", seed one-point series.
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
        setError(null);
        setStatus("ok");
      } catch (err) {
        if (cancelled) return;
        if (!background) {
          setSeries([]);
          setGlobalByStation({});
          setStatus("down");
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
            Absolute code TEC from the live NTRIP pipeline (solid) with DLR Global TEC sampled at each station
            (dashed). Global values are logged whenever the dashboard refreshes so the overlay builds a real
            history over time. EKF predicted lines are omitted until a real per-station EKF series is available.
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
              {h}h
            </button>
          ))}
        </div>
      </div>

      {status === "pending" && series.length === 0 && (
        <div className="banner banner-info">Loading live VTEC time series…</div>
      )}
      {status === "down" && (
        <div className="banner banner-warn">
          {error ?? "Live VTEC time series unavailable — check that the NTRIP collector is writing to the database."}
        </div>
      )}
      {status === "ok" && (
        <p className="station-vtec-plots-meta">
          {reporting} of {series.length || 25} stations reporting in the last {hours} h
          {globalReporting > 0
            ? ` · Global TEC overlay on ${globalReporting} sites${globalSource ? ` (${globalSource})` : ""}`
            : ""}{" "}
          · auto-refresh every {REFRESH_MS / 1000}s
        </p>
      )}

      <div className="station-vtec-plots-grid">
        {series.map((row) => (
          <StationChartCard
            key={row.station}
            series={row}
            globalSeries={globalByStation[row.station.toLowerCase().replace(/_+$/, "")]}
          />
        ))}
      </div>
    </section>
  );
}
