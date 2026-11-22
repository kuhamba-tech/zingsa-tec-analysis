"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getEquatorialElectricField } from "@/lib/api";
import { loadLineChart } from "@/lib/loadLineChart";
import { utcTimeAxisProps } from "@/lib/chartTimeAxis";
import type { EquatorialElectricFieldPoint, EquatorialElectricFieldResponse } from "@/lib/types";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), {
  ssr: false,
  loading: () => <div className="banner banner-info" role="status">Loading chart…</div>,
});

const WINDOW_MS = 24 * 60 * 60_000;

function mergePoints(
  current: EquatorialElectricFieldPoint[],
  incoming: EquatorialElectricFieldPoint[],
): EquatorialElectricFieldPoint[] {
  const points = new Map(current.map(point => [point.time, point]));
  for (const point of incoming) points.set(point.time, point);
  const cutoff = Date.now() - WINDOW_MS;
  return [...points.values()]
    .filter(point => Date.parse(point.time) >= cutoff)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export default function EquatorialElectricFieldChart() {
  const [data, setData] = useState<EquatorialElectricFieldResponse | null>(null);
  const [points, setPoints] = useState<EquatorialElectricFieldPoint[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await getEquatorialElectricField();
        if (!active) return;
        setData(response);
        setPoints(current => mergePoints(current, response.points));
        setError(false);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const chart = useMemo(() => {
    if (!points.some(point =>
      point.prompt_penetration_mvm != null || point.climatological_mvm != null
    )) return null;
    const epochs = points.map(point => Date.parse(point.time));
    const first = epochs[0];
    const last = epochs[epochs.length - 1];
    if (first == null || last == null) return null;
    const now = Date.now();
    const min = Math.max(first, now - WINDOW_MS);
    const max = Math.max(now, last);
    const domain = max > min ? { min, max } : { min: min - 30 * 60_000, max: max + 30 * 60_000 };
    return {
      epochs,
      domain,
      datasets: [
        {
          label: "Prompt penetration",
          data: points.map(point => point.prompt_penetration_mvm),
          color: "#38bdf8",
          fill: false,
          omitMissingPoints: true,
          spanGaps: false,
          tension: 0,
        },
        {
          label: "Quiet-time climatology",
          data: points.map(point => point.climatological_mvm),
          color: "#f59e0b",
          fill: false,
          omitMissingPoints: true,
          spanGaps: false,
          tension: 0,
        },
      ],
    };
  }, [points]);

  return (
    <section className="card" aria-label="Equatorial ionospheric electric field model">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".65rem" }}>
        <strong>Equatorial ionospheric eastward electric field</strong>
        <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
          Model longitude: {data?.longitude_deg ?? 28}°E · mV/m
        </span>
      </div>
      <p style={{ fontSize: ".8rem", margin: ".35rem 0" }}>
        Colorado real-time model output at five-minute cadence. This is an equatorial model estimate, not a local Zimbabwe measurement.
      </p>
      {loading && !data && <p role="status">Fetching real model output…</p>}
      {error && (
        <p className="banner banner-warn" role="status">
          The University of Colorado model is temporarily unavailable. This chart retries automatically.
          {chart ? " Showing the last received model values." : ""}
        </p>
      )}
      {data?.note && <p className="banner banner-info" role="status">{data.note}</p>}
      {chart && (
        <LineChart
          labels={points.map(point => point.time)}
          xValues={chart.epochs}
          epochMs={chart.epochs}
          datasets={chart.datasets}
          yLabel="Eastward electric field (mV/m)"
          height={300}
          pointRadius={2}
          preserveSamples
          toggleableLegend
          {...utcTimeAxisProps(chart.domain, { majorHours: 3 })}
        />
      )}
      {!loading && !error && !chart && (
        <p role="status">
          {data?.note ?? "The Colorado model returned no usable time-series points."}
        </p>
      )}
      <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 0 }}>
        Source: <a href={data?.source_url ?? "https://geomag.colorado.edu/online-calculators/real-time-model-ionospheric-electric-fields"} target="_blank" rel="noreferrer">University of Colorado model</a>
        {" · "}Last model update: {data?.updated_utc?.replace("T", " ").replace("Z", " UTC") ?? "unavailable"}
        {" · "}The prompt-penetration component depends on upstream solar-wind data; unavailable components remain blank.
      </p>
    </section>
  );
}
