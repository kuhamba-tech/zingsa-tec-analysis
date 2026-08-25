"use client";

import { useEffect, useMemo, useState } from "react";
import { getLiveVtecByStation } from "@/lib/api";
import type { LiveStationVtecSeries } from "@/lib/types";
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

function StationChartCard({ series }: { series: LiveStationVtecSeries }) {
  const hasData = series.points.length > 0;
  const labels = series.points.map((p) => formatTick(p.time));
  const values = series.points.map((p) => p.vtec_tecu);

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
              <small>latest</small>
            </>
          ) : (
            <small>No live VTEC</small>
          )}
        </div>
      </div>
      {hasData ? (
        <LineChart
          labels={labels}
          datasets={[
            {
              label: "Observed",
              data: values,
              color: "#3d8bfd",
              fill: true,
            },
          ]}
          yLabel="VTEC (TECU)"
          height={180}
          compact
        />
      ) : (
        <div className="station-vtec-plot-empty">No live pipeline VTEC in this window.</div>
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
  const [status, setStatus] = useState<"pending" | "ok" | "down">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (background = false) => {
      if (!background) setStatus("pending");
      try {
        const rows = await getLiveVtecByStation(hours, hours <= 2 ? 1 : 2);
        if (cancelled) return;
        setSeries(rows);
        setError(null);
        setStatus("ok");
      } catch (err) {
        if (cancelled) return;
        if (!background) {
          setSeries([]);
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

  return (
    <section className={`station-vtec-plots ${className ?? ""}`.trim()} aria-label={title}>
      <div className="station-vtec-plots-header">
        <div>
          <h2 className="home-section-heading">{title}</h2>
          <p className="station-vtec-plots-sub">
            Absolute code TEC from the live NTRIP pipeline (median per bin). Use these traces to check whether
            heat-map station values are stable and physically reasonable. EKF predicted lines are omitted until a
            real per-station EKF series is available.
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
          {reporting} of {series.length || 25} stations reporting in the last {hours} h · auto-refresh every{" "}
          {REFRESH_MS / 1000}s
        </p>
      )}

      <div className="station-vtec-plots-grid">
        {series.map((row) => (
          <StationChartCard key={row.station} series={row} />
        ))}
      </div>
    </section>
  );
}
