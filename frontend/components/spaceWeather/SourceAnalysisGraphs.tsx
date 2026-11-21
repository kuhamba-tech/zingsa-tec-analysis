"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MultiSourceComparisonPanel from "@/components/timeSeries/MultiSourceComparisonPanel";
import ComparisonDriverCharts from "@/components/timeSeries/ComparisonDriverCharts";
import {
  getCelestrakAnalysis,
  getGfzKpAnalysis,
  getOmniAnalysis,
  getTimeSeries,
  getWdcKyotoAnalysis,
} from "@/lib/api";
import {
  readSourceAnalysisRequest,
  subscribeSourceAnalysisRequest,
  type SourceAnalysisRequest,
} from "@/lib/sourceAnalysisBridge";
import type {
  CelestrakAnalysisResponse,
  GfzKpAnalysisResponse,
  OmniAnalysisResponse,
  TecObservation,
  WdcKyotoAnalysisResponse,
} from "@/lib/types";

type Dataset = { label: string; data: (number | null)[]; color: string };
type LoadedSources = {
  omni: OmniAnalysisResponse | null;
  celestrak: CelestrakAnalysisResponse | null;
  gfz: GfzKpAnalysisResponse | null;
  kyoto: WdcKyotoAnalysisResponse | null;
  dates: string[];
  datasets: Dataset[];
};

const COLORS = ["#168bd2", "#ff4444", "#00ff88", "#ff8c00", "#a78bfa", "#ffcc00", "#34d399", "#f472b6"];
const DAY_MS = 86_400_000;

function dailyVtec(observations: TecObservation[], start: string, end: string): { dates: string[]; datasets: Dataset[] } {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const dates = Array.from({ length: Math.floor((endMs - startMs) / DAY_MS) + 1 }, (_, index) =>
    new Date(startMs + index * DAY_MS).toISOString().slice(0, 10),
  );
  const dateSet = new Set(dates);
  const byStation = new Map<string, Map<string, number[]>>();
  for (const observation of observations) {
    const value = observation.vtec;
    const date = observation.timestamp.slice(0, 10);
    if (value == null || !Number.isFinite(value) || !dateSet.has(date)) continue;
    const station = observation.station || "unknown";
    let days = byStation.get(station);
    if (!days) {
      days = new Map();
      byStation.set(station, days);
    }
    const values = days.get(date) ?? [];
    values.push(value);
    days.set(date, values);
  }
  const stations = [...byStation.keys()].sort();
  return {
    dates,
    datasets: stations.map((station, index) => {
      const byDay = byStation.get(station)!;
      return {
        label: station,
        color: COLORS[index % COLORS.length],
        data: dates.map(date => {
          const values = byDay.get(date);
          return values?.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        }),
      };
    }),
  };
}

function errorText(name: string, reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return `${name}: ${detail || "could not be loaded"}`;
}

export default function SourceAnalysisGraphs() {
  const [request, setRequest] = useState<SourceAnalysisRequest | null>(null);
  const [loaded, setLoaded] = useState<LoadedSources | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState(0);

  useEffect(() => {
    setRequest(readSourceAnalysisRequest());
    return subscribeSourceAnalysisRequest(setRequest);
  }, []);

  useEffect(() => {
    if (!request) {
      setLoaded(null);
      setErrors({});
      setLoading(false);
      return;
    }
    let active = true;
    setLoaded(null);
    setErrors({});
    setLoading(true);
    const endMs = Date.parse(`${request.end}T23:59:00Z`);
    setSelectedTime(endMs);

    Promise.allSettled([
      getOmniAnalysis(request.start, request.end, request.station || undefined),
      getCelestrakAnalysis(request.start, request.end, request.station || undefined),
      getGfzKpAnalysis(request.start, request.end, request.station || undefined),
      getWdcKyotoAnalysis(request.start, request.end, request.station || undefined),
      getTimeSeries({
        station: request.station || undefined,
        start: request.start,
        end: request.end,
        limit: 10000,
      }),
    ]).then(([omniResult, celestrakResult, gfzResult, kyotoResult, vtecResult]) => {
      if (!active) return;
      const failures: Record<string, string> = {};
      if (omniResult.status === "rejected") failures.omni = errorText("NASA OMNIWeb", omniResult.reason);
      if (celestrakResult.status === "rejected") failures.celestrak = errorText("CelesTrak", celestrakResult.reason);
      if (gfzResult.status === "rejected") failures.gfz = errorText("GFZ Potsdam", gfzResult.reason);
      if (kyotoResult.status === "rejected") failures.kyoto = errorText("WDC Kyoto", kyotoResult.reason);
      if (vtecResult.status === "rejected") failures.vtec = errorText("Archived VTEC", vtecResult.reason);
      const observations = vtecResult.status === "fulfilled" ? vtecResult.value : [];
      const vtec = dailyVtec(observations, request.start, request.end);
      setErrors(failures);
      setLoaded({
        omni: omniResult.status === "fulfilled" ? omniResult.value : null,
        celestrak: celestrakResult.status === "fulfilled" ? celestrakResult.value : null,
        gfz: gfzResult.status === "fulfilled" ? gfzResult.value : null,
        kyoto: kyotoResult.status === "fulfilled" ? kyotoResult.value : null,
        dates: vtec.dates,
        datasets: vtec.datasets,
      });
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [request]);

  const domain = useMemo(() => {
    if (!request) return null;
    const min = Date.parse(`${request.start}T00:00:00Z`);
    const max = Date.parse(`${request.end}T23:59:00Z`);
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
  }, [request]);
  const driverRequest = useMemo(
    () => request ? { start: request.start, end: request.end, revision: request.requestedAt } : null,
    [request],
  );
  const markerTime = domain
    ? Math.max(domain.min, Math.min(selectedTime || domain.max, domain.max))
    : null;
  const sourceErrors = {
    omni: errors.omni,
    celestrak: errors.celestrak,
    gfz: errors.gfz,
    kyoto: errors.kyoto,
  };

  return (
    <section className="card" aria-label="Time Series source graphs in Analysis" style={{ display: "grid", gap: "0.85rem" }}>
      <div>
        <h2 style={{ margin: 0 }}>Source Comparison · Analysis graphs</h2>
        <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>
          Date-matched geomagnetic, solar-driver and archived VTEC graphs from Time Series → Source Comparison.
          VTEC is plotted as daily means from the selected archived station observations. Load another range there to refresh this section.
        </p>
      </div>
      {!request ? (
        <div className="banner banner-info">
          Select a date range in <Link href="/time-series">TEC Time Series Viewer</Link> and click <strong>Load all sources</strong> to show its graphs here.
        </div>
      ) : (
        <>
          <div style={{ fontSize: "0.82rem" }}>
            Loaded range: <strong>{request.start} to {request.end} UTC</strong>
            {request.station ? ` · Station ${request.station.toUpperCase()}` : " · All stations / network mean"}
          </div>
          {domain && (
            <label style={{ display: "grid", gap: ".35rem", fontSize: ".85rem" }}>
              Pink analysis marker: <strong>{new Date(markerTime ?? domain.max).toISOString().replace("T", " ").replace("Z", " UTC")}</strong>
              <input
                aria-label="Move pink source analysis marker"
                type="range"
                min={domain.min}
                max={domain.max}
                step={60_000}
                value={markerTime ?? domain.max}
                onChange={event => setSelectedTime(Number(event.target.value))}
                style={{ width: "100%", margin: 0, accentColor: "#ff00d4", minHeight: 44 }}
              />
            </label>
          )}
          {errors.vtec && <div className="banner banner-warn" role="status">{errors.vtec}</div>}
          <MultiSourceComparisonPanel
            drivers={stormDates => driverRequest && <ComparisonDriverCharts request={driverRequest} stormDates={stormDates} selectedTime={markerTime ?? undefined} />}
            omni={loaded?.omni ?? null}
            celestrak={loaded?.celestrak ?? null}
            gfz={loaded?.gfz ?? null}
            kyoto={loaded?.kyoto ?? null}
            vtecLabels={loaded?.dates ?? []}
            vtecDatasets={loaded?.datasets ?? []}
            loading={loading}
            errors={sourceErrors}
            markerTime={markerTime ?? undefined}
          />
        </>
      )}
    </section>
  );
}
