"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { getLiveVtecByStation, getStations, getTecMethodComparison } from "@/lib/api";
import { getLoadProfile } from "@/lib/loadBudget";
import { getTecMethodCmpParams } from "@/lib/tecMethodCompareParams";
import type { LiveStationVtecSeries, Station, TecMethodComparisonResponse } from "@/lib/types";
import {
  LAT_BAND_DIURNAL_HOURS,
  ZIMBABWE_LAT_BANDS,
  latBandDiurnalFromStationSeries,
  latBandDiurnalGgFromGopiPlusDelta,
  stationLatLookup,
  type LatBandDiurnalSeries,
} from "@/lib/zimbabweLatBands";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

type Props = {
  /** Optional preloaded GOPI station series (skips a second by-station fetch). */
  stationSeries?: LiveStationVtecSeries[] | null;
  /** Optional preloaded comparison payload. */
  methodCmp?: TecMethodComparisonResponse | null;
  /** Optional station catalog for latitudes. */
  catalog?: Station[] | null;
  /** When true, this component fetches what it needs. */
  autoload?: boolean;
};

function chartOptions(title: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    color: "#ffffff",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: "#ffffff",
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          padding: 16,
          font: { size: 12 },
        },
      },
      title: {
        display: true,
        text: title,
        color: "#ffffff",
        font: { size: 15, weight: "bold" as const },
        padding: { bottom: 4 },
      },
      subtitle: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => {
            const y = ctx.parsed.y;
            if (y == null || !Number.isFinite(y)) return `${ctx.dataset.label}: —`;
            return `${ctx.dataset.label}: ${y.toFixed(1)} TECU`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear" as const,
        min: 0,
        max: 23,
        title: { display: true, text: "UT [hours]", color: "#ffffff", font: { size: 12 } },
        ticks: {
          color: "#ffffff",
          stepSize: 3,
          callback: (v: string | number) => {
            const n = Number(v);
            return LAT_BAND_DIURNAL_HOURS.includes(n as (typeof LAT_BAND_DIURNAL_HOURS)[number])
              ? String(n).padStart(2, "0")
              : "";
          },
        },
        grid: { color: "rgba(148, 163, 184, 0.28)", borderDash: [4, 4] },
      },
      y: {
        min: 0,
        suggestedMax: 45,
        title: { display: true, text: "VTEC [TECU]", color: "#ffffff", font: { size: 12 } },
        ticks: { color: "#ffffff", stepSize: 15 },
        grid: { color: "rgba(148, 163, 184, 0.28)", borderDash: [4, 4] },
      },
    },
  };
}

function bandDatasets(series: LatBandDiurnalSeries) {
  return ZIMBABWE_LAT_BANDS.map((band) => ({
    label: band.label,
    data: series.hours.map((h, i) => ({ x: h, y: series[band.id][i] })),
    borderColor: band.color,
    backgroundColor: band.color,
    borderWidth: 2.25,
    pointRadius: 4,
    pointHoverRadius: 5,
    tension: 0.25,
    spanGaps: false,
  }));
}

function BandChart({
  title,
  badge,
  series,
  footer,
  empty,
}: {
  title: string;
  badge: string;
  series: LatBandDiurnalSeries | null;
  footer: string;
  empty: string;
}) {
  const hasData = series != null && series.hoursWithData > 0;
  return (
    <div
      style={{
        background: "#0a1929",
        borderRadius: 10,
        border: "1px solid var(--border)",
        padding: "0.85rem 0.85rem 0.55rem",
        color: "#ffffff",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: 6 }}>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 600,
            color: "#ffffff",
            background: "rgba(22, 139, 210, 0.22)",
            borderRadius: 999,
            padding: "0.2rem 0.65rem",
          }}
        >
          {badge}
        </span>
        {series && (
          <span style={{ fontSize: "0.72rem", color: "#ffffff" }}>
            N {series.stationCounts.northern} · C {series.stationCounts.central} · S{" "}
            {series.stationCounts.southern} stations
          </span>
        )}
      </div>
      <div style={{ height: 300 }}>
        {hasData ? (
          <Line data={{ datasets: bandDatasets(series!) }} options={chartOptions(title)} />
        ) : (
          <div
            className="banner banner-info"
            style={{ margin: "2rem 0.5rem" }}
          >
            {empty}
          </div>
        )}
      </div>
      <p style={{ margin: "0.45rem 0 0.15rem", fontSize: "0.75rem", color: "#ffffff", lineHeight: 1.45 }}>
        {footer}
      </p>
    </div>
  );
}

export default function ZimbabweLatBandTecCharts({
  stationSeries: stationSeriesProp,
  methodCmp: methodCmpProp,
  catalog: catalogProp,
  autoload = true,
}: Props) {
  const [stations, setStations] = useState<LiveStationVtecSeries[] | null>(stationSeriesProp ?? null);
  const [methodCmp, setMethodCmp] = useState<TecMethodComparisonResponse | null>(methodCmpProp ?? null);
  const [catalog, setCatalog] = useState<Station[] | null>(catalogProp ?? null);
  const [loading, setLoading] = useState(autoload && !stationSeriesProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stationSeriesProp) setStations(stationSeriesProp);
  }, [stationSeriesProp]);
  useEffect(() => {
    if (methodCmpProp) setMethodCmp(methodCmpProp);
  }, [methodCmpProp]);
  useEffect(() => {
    if (catalogProp) setCatalog(catalogProp);
  }, [catalogProp]);

  useEffect(() => {
    if (!autoload) return;
    let cancelled = false;
    const load = () => {
      const profile = getLoadProfile();
      // Always refresh a dedicated 12–24 h station window for lat-band diurnal
      // (teaching lab may only hold a shorter series for other graphs).
      setLoading(true);
      const hours = profile.constrained ? 12 : 24;
      const resample = profile.constrained ? 20 : 15;
      const tasks: Promise<unknown>[] = [
        getLiveVtecByStation(hours, resample, profile.constrained ? 50_000 : 90_000)
          .then((rows) => {
            if (!cancelled && Array.isArray(rows) && rows.length) setStations(rows);
          })
          .catch(() => {
            if (!cancelled && !stationSeriesProp) {
              setError("Station VTEC series unavailable for lat-band chart.");
            }
          }),
      ];

      if (!methodCmpProp) {
        const cmp = getTecMethodCmpParams();
        tasks.push(
          getTecMethodComparison(cmp.hours, undefined, cmp.limit, cmp.timeoutMs)
            .then((payload) => {
              if (!cancelled) setMethodCmp(payload);
            })
            .catch(() => {}),
        );
      }
      if (!catalogProp) {
        tasks.push(
          getStations(false)
            .then((rows) => {
              if (!cancelled && Array.isArray(rows)) setCatalog(rows);
            })
            .catch(() => {}),
        );
      }

      Promise.allSettled(tasks).finally(() => {
        if (!cancelled) setLoading(false);
      });
    };
    load();
    const id = window.setInterval(load, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [autoload, stationSeriesProp, methodCmpProp, catalogProp]);

  const lats = useMemo(() => stationLatLookup(catalog), [catalog]);

  const gopiBands = useMemo(() => {
    if (!stations?.length) return null;
    return latBandDiurnalFromStationSeries(stations, lats);
  }, [stations, lats]);

  const ggBands = useMemo(() => {
    if (!stations?.length) return null;
    const gopiRows = methodCmp?.gopi ?? [];
    const ggRows = methodCmp?.gg ?? [];
    return latBandDiurnalGgFromGopiPlusDelta(stations, gopiRows, ggRows, lats);
  }, [stations, methodCmp, lats]);

  const ggFooter =
    ggBands?.mode === "offset"
      ? `Measured Gg−GOPI station offsets (mean Δ ${
          ggBands.meanDeltaTecu != null ? `${ggBands.meanDeltaTecu >= 0 ? "+" : ""}${ggBands.meanDeltaTecu} TECU` : "n/a"
        }) applied to the CORS station diurnal series so both methods share the same latitudinal comparison layout. Ordering reflects live observations — northern Zimbabwe is not assumed highest.`
      : "Hourly mean VTEC from Gg = Cesaroni calibrated samples, grouped by CORS station latitude (north > −18.2°, central > −20.2°, else south). Magnitudes and ordering come from measured data.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>
          Proposed ZINGSA TEC comparison — northern / central / southern Zimbabwe
        </div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Same layout as the illustrative latitudinal graph, now filled with measured Zimbabwe CORS
          VTEC for both calibrations: Method 1 (GOPI / Seemala) and Method 2 (Gg = Cesaroni).
        </p>
        {loading && (
          <p className="sw-supporting-text" style={{ margin: "0.45rem 0 0" }}>
            Loading measured lat-band series…
          </p>
        )}
        {error && (
          <div className="banner banner-warn" style={{ marginTop: "0.55rem" }}>
            {error}
          </div>
        )}
      </div>

      <BandChart
        title="Proposed ZINGSA TEC comparison — GOPI"
        badge="Measured · Method 1 (GOPI / Seemala)"
        series={gopiBands}
        footer="Hourly mean vertical TEC from live Zimbabwe CORS stations, binned by latitude band. Curves use actual observations; gaps appear where no stations in that band reported yet."
        empty={
          loading
            ? "Waiting for live station VTEC…"
            : "No measured GOPI station VTEC available yet for northern / central / southern bins."
        }
      />

      <BandChart
        title="Proposed ZINGSA TEC comparison — Gg"
        badge={
          ggBands?.mode === "offset"
            ? "Measured offsets · Method 2 (Gg = Cesaroni)"
            : "Measured · Method 2 (Gg = Cesaroni)"
        }
        series={ggBands}
        footer={ggFooter}
        empty={
          loading
            ? "Waiting for Gg calibration samples…"
            : "No Gg samples yet — open the comparison feed once Cesaroni calibration has enough live arcs."
        }
      />
    </div>
  );
}
