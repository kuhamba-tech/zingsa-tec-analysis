"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import LocalIonosphereObservations from "./LocalIonosphereObservations";
import DeferredMount from "./DeferredMount";
import GoesXrayLastDayChart from "./GoesXrayLastDayChart";
import SpaceWeatherCorsMap from "./SpaceWeatherCorsMap";
import SwSectionBanner from "./SwSectionBanner";
import TecPrimerBlock from "./TecPrimerBlock";
import dynamic from "next/dynamic";
import { getHeliosphericMonitor, getLiveVtecByStation, getTimelines } from "@/lib/api";
import { getLoadProfile } from "@/lib/loadBudget";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import {
  ONE_H_MS,
  SIX_H_MS,
  alignTimeDomain,
  parseTimelineEpoch,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import type {
  HeliosphericMonitorResponse,
  LiveStationVtecSeries,
  SpaceWeatherTimelines,
} from "@/lib/types";

const LineChart = dynamic(() => import("@/components/charts/LineChart"), {
  ssr: false,
  loading: () => (
    <div className="banner banner-info" role="status">
      Loading chart…
    </div>
  ),
});
const ChartAnalysisBox = dynamic(() => import("@/components/dashboard/ChartAnalysisBox"), {
  ssr: false,
});

const PRIORITY_STATIONS = ["hara", "bula", "masv", "kari", "beit"] as const;
const STATION_COLORS: Record<string, string> = {
  hara: "#38bdf8",
  bula: "#fbbf24",
  masv: "#a78bfa",
  kari: "#34d399",
  beit: "#f97316",
};

const FLARE_THRESHOLDS = [
  { value: 1e-6, label: "C", color: "#f97316" },
  { value: 1e-5, label: "M", color: "#ef4444" },
  { value: 1e-4, label: "X", color: "#a855f7" },
];

const FAST_STREAM_KMS = 500;

/** Match Live NOAA Solar Wind Timeline: keep Fast stream (500) visible with ≥600 headroom. */
function solarWindSpeedScale(speeds: (number | null)[]): { ySuggestedMin: number; ySuggestedMax: number } {
  const vals = speeds.filter((v): v is number => v != null && Number.isFinite(v));
  const dMin = vals.length ? Math.min(...vals) : 400;
  const dMax = vals.length ? Math.max(...vals) : 550;
  // Image-1 style: room below ~400–440 and top at least 600 so the Fast stream band reads clearly.
  const ySuggestedMin = Math.floor(Math.min(dMin, 400) / 20) * 20 - 20;
  const ySuggestedMax = Math.ceil(Math.max(dMax, 600, FAST_STREAM_KMS) / 20) * 20;
  return {
    ySuggestedMin: Math.max(200, ySuggestedMin),
    ySuggestedMax,
  };
}

type GeoTab = "kp" | "dst";

function Panel({
  title,
  subtitle,
  children,
  analysis,
  open,
  onToggle,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  analysis: ChartAnalysisBlock;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        background: open ? "rgba(22, 139, 210, 0.1)" : "#0a1929",
        border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "0.75rem 0.85rem 0.45rem",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.45rem" }}>
        {subtitle}
      </div>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
      {open && <ChartAnalysisBox block={analysis} title="Scientific interpretation" />}
    </div>
  );
}

function parseLocalEpoch(t: string): number | null {
  return parseTimelineEpoch(t);
}

/** Prefer API epoch_ms; fall back to ISO times so sync works if the field is absent. */
function seriesEpochMs(
  epochMs: (number | null)[] | undefined,
  times: string[] | undefined,
  labels: string[],
): (number | null)[] {
  if (epochMs && epochMs.length === labels.length && epochMs.some((v) => v != null)) {
    return epochMs;
  }
  if (times && times.length === labels.length) {
    return times.map((t) => parseLocalEpoch(t));
  }
  return labels.map(() => null);
}

function chronologicalSeries<T extends Record<string, (number | null)[] | string[]>>(
  labels: string[],
  epochs: (number | null)[],
  series: T,
): { labels: string[]; epochs: number[]; series: T } {
  const order = labels
    .map((_, i) => i)
    .filter((i) => epochs[i] != null && Number.isFinite(epochs[i] as number))
    .sort((a, b) => (epochs[a] as number) - (epochs[b] as number));
  const outSeries = {} as T;
  for (const key of Object.keys(series) as (keyof T)[]) {
    const arr = series[key];
    outSeries[key] = order.map((i) => arr[i]) as T[keyof T];
  }
  return {
    labels: order.map((i) => labels[i]),
    epochs: order.map((i) => epochs[i] as number),
    series: outSeries,
  };
}

function panelOrNull<T extends Record<string, (number | null)[] | string[]>>(
  panel: { labels: string[]; epochs: number[]; series: T } | null,
): { labels: string[]; epochs: number[]; series: T } | null {
  if (!panel || panel.labels.length === 0) return null;
  return panel;
}

/** Prefer clipped series; if the live window empties the panel, keep unclipped. */
function clipOrFallback<T extends Record<string, (number | null)[] | string[]>>(
  raw: { labels: string[]; epochs: number[]; series: T } | null,
  domain: { min: number; max: number } | null,
): { labels: string[]; epochs: number[]; series: T } | null {
  const base = panelOrNull(raw);
  if (!base) return null;
  const clipped = panelOrNull(clipSeriesToDomain(base, domain));
  return clipped ?? base;
}

/** Keep only points inside the shared L1 UTC window so Kp/Dst match wind/IMF. */
function clipSeriesToDomain<T extends Record<string, (number | null)[] | string[]>>(
  panel: { labels: string[]; epochs: number[]; series: T } | null,
  domain: { min: number; max: number } | null,
): { labels: string[]; epochs: number[]; series: T } | null {
  if (!panel) return null;
  if (!domain) return panel;
  const keep = panel.epochs
    .map((ms, i) => (ms >= domain.min && ms <= domain.max ? i : -1))
    .filter((i) => i >= 0);
  if (keep.length === 0) return null;
  const outSeries = {} as T;
  for (const key of Object.keys(panel.series) as (keyof T)[]) {
    const arr = panel.series[key];
    outSeries[key] = keep.map((i) => arr[i]) as T[keyof T];
  }
  return {
    labels: keep.map((i) => panel.labels[i]),
    epochs: keep.map((i) => panel.epochs[i]),
    series: outSeries,
  };
}

function timelinePointsToSeries(points: { t: string; v: number | null }[]) {
  if (!points.length) return null;
  const labels = points.map((p) => p.t);
  const epochs = points.map((p) => parseTimelineEpoch(p.t));
  if (!epochs.some((ms) => ms != null)) return null;
  return chronologicalSeries(labels, epochs, {
    values: points.map((p) => p.v),
  });
}

export type CauseEffectVariant = "full" | "drivers" | "local" | "liveMetric" | "overview";

/**
 * full — National Dashboard: observations + map + drivers 1–4 + Zimbabwe 5–6
 * drivers — Sun→Earth panels 1–4 only
 * local — Zimbabwe VTEC + scintillation/GNSS panels only (no Kp scale / driver panels)
 * liveMetric — Live Metric Timelines: chronological Sun→Earth→Zimbabwe (slots for F10.7 + CORS)
 * overview — Space Weather page above tabs: observations + CORS map only
 */
export default function CauseEffectTimelineStack({
  variant = "full",
  afterSun = null,
  afterVtec = null,
  localStartNumber = 1,
}: {
  variant?: CauseEffectVariant;
  /** Inserted after GOES X-ray (e.g. F10.7 sun metric on Live Metric). */
  afterSun?: ReactNode;
  /** Inserted after Zimbabwe VTEC (e.g. CORS online timeline on Live Metric). */
  afterVtec?: ReactNode;
  /** First panel number for local VTEC/GNSS when drivers are omitted (default 1). */
  localStartNumber?: number;
}) {
  const showDrivers = variant === "full" || variant === "drivers" || variant === "liveMetric";
  const showLocal = variant === "full" || variant === "local" || variant === "liveMetric";
  const showChrome = variant === "full" || variant === "overview";
  const showTimelineSection = variant !== "overview";
  const fetchVtec = showLocal || showChrome;
  const isLiveMetric = variant === "liveMetric";
  // Live Metric chronological numbers: 1 X-ray · 2 F10.7 · 3 wind · 4 IMF · 5 geo · 6 VTEC · 7 CORS · 8 GNSS
  const nWind = isLiveMetric ? 3 : 2;
  const nImf = isLiveMetric ? 4 : 3;
  const nGeo = isLiveMetric ? 5 : 4;
  const nVtec = isLiveMetric ? 6 : showDrivers ? 5 : localStartNumber;
  const nGnss = isLiveMetric ? 8 : showDrivers ? 6 : localStartNumber + (afterVtec ? 2 : 1);

  const [helio, setHelio] = useState<HeliosphericMonitorResponse | null>(null);
  const [timelines, setTimelines] = useState<SpaceWeatherTimelines | null>(null);
  const [vtec, setVtec] = useState<LiveStationVtecSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [vtecLoading, setVtecLoading] = useState(true);
  const [syncHoverMs, setSyncHoverMs] = useState<number | null>(null);
  const [geoTab, setGeoTab] = useState<GeoTab>("kp");
  const [rangeHours, setRangeHours] = useState<6 | 24 | 72>(24);
  // Overview only needs a light station snapshot for the readings strip — keep it cheap.
  const vtecHours = showChrome && !showLocal ? Math.min(rangeHours, 6) : Math.min(rangeHours, 48);
  const vtecResample = showChrome && !showLocal ? 10 : 2;
  const [now, setNow] = useState(0);
  const [vtecRefreshFailed, setVtecRefreshFailed] = useState(false);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let feedCount = 0;
    const cached = peekHeliosphericMonitor();
    if (showDrivers && cached) { setHelio(cached); setLoading(false); }
    const markPainted = () => {
      if (!cancelled) setLoading(false);
    };
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      failures = 0;
      feedCount = 0;
      if (showLocal && !cancelled) setVtecLoading(true);
      // Resolve each feed independently so Zimbabwe VTEC / GNSS panels paint
      // as soon as their JSON arrives instead of waiting on the slowest feed.
      const tasks: Promise<void>[] = [];
      if (showDrivers) {
        feedCount += 1;
        tasks.push(
          getHeliosphericMonitor(false, false)
            .then((h) => {
              if (cancelled) return;
              setHelio(h);
              markPainted();
            })
            .catch(() => { failures += 1; })
            .then(() => undefined),
        );
      }
      if (showDrivers || showLocal) {
        feedCount += 1;
        tasks.push(
          getTimelines(getLoadProfile().timelineMaxPoints)
            .then((t) => {
              if (cancelled) return;
              setTimelines(t);
              markPainted();
            })
            .catch(() => { failures += 1; })
            .then(() => undefined),
        );
      }
      if (fetchVtec) {
        feedCount += 1;
        if (!cancelled && showChrome && !showLocal) setVtecLoading(true);
        tasks.push(
          getLiveVtecByStation(vtecHours, vtecResample)
            .then((v) => {
              if (cancelled) return;
              setVtec(Array.isArray(v) ? v : []);
              setVtecRefreshFailed(false);
              markPainted();
            })
            .catch(() => {
              failures += 1;
              if (!cancelled) setVtecRefreshFailed(true);
            })
            .finally(() => {
              if (!cancelled) setVtecLoading(false);
            })
            .then(() => undefined),
        );
      } else if (!cancelled) {
        setVtecLoading(false);
      }
      await Promise.allSettled(tasks);
      inFlight = false;
      if (cancelled) return;
      setError(
        failures
          ? `${failures} of ${feedCount || 1} timeline feeds could not refresh. Retained observations may lag; check their timestamps.`
          : null,
      );
      setLoading(false);
    };
    setNow(Date.now());
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(clock); };
  }, [rangeHours, showDrivers, showLocal, fetchVtec, showChrome, vtecHours, vtecResample]);

  const plottedStations = useMemo(() => {
    const available = vtec.filter((station) => station.points?.length);
    return [...available].sort((a, b) => {
      const rank = (code: string) => {
        const index = (PRIORITY_STATIONS as readonly string[]).indexOf(code.toLowerCase().replace(/_+$/, ""));
        return index < 0 ? PRIORITY_STATIONS.length : index;
      };
      return rank(a.station) - rank(b.station);
    }).slice(0, 5);
  }, [vtec]);

  const syncProps = {
    syncHoverMs,
    onSyncHoverMs: setSyncHoverMs,
  };

  const xrayPanel = useMemo(() => {
    const raw = helio?.xray;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return panelOrNull(chronologicalSeries(raw.labels, epochs, { flux: raw.flux }));
  }, [helio]);

  const windPanel = useMemo(() => {
    const raw = helio?.solar_wind;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return panelOrNull(chronologicalSeries(raw.labels, epochs, {
      speed: raw.speed,
      density: raw.density ?? raw.speed.map(() => null),
      temperature: raw.temperature ?? raw.speed.map(() => null),
    }));
  }, [helio]);

  const imfPanel = useMemo(() => {
    const raw = helio?.imf;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return panelOrNull(chronologicalSeries(raw.labels, epochs, { bt: raw.bt, bz: raw.bz }));
  }, [helio]);

  const kpPanelRaw = useMemo(() => {
    const raw = helio?.kp;
    if (raw?.labels?.length) {
      const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
      return chronologicalSeries(raw.labels, epochs, {
        observed: raw.observed,
        estimated: raw.estimated,
        predicted: raw.predicted,
      });
    }
    // Fallback: live /space-weather/timelines Kp history
    const tl = timelinePointsToSeries(timelines?.kp ?? []);
    if (!tl) return null;
    return {
      labels: tl.labels,
      epochs: tl.epochs,
      series: {
        observed: tl.series.values,
        estimated: tl.series.values.map(() => null),
        predicted: tl.series.values.map(() => null),
      },
    };
  }, [helio, timelines]);

  const dstPanelRaw = useMemo(() => {
    const raw = helio?.dst;
    if (raw?.labels?.length) {
      const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
      return chronologicalSeries(raw.labels, epochs, { dst: raw.dst });
    }
    const tl = timelinePointsToSeries(timelines?.dst ?? []);
    if (!tl) return null;
    return {
      labels: tl.labels,
      epochs: tl.epochs,
      series: { dst: tl.series.values },
    };
  }, [helio, timelines]);

  const gnssPanel = useMemo(() => {
    const s4 = timelines?.s4 ?? [];
    const risk = timelines?.gnss_risk ?? [];
    const byTime = new Map<string, { s4: number | null; risk: number | null }>();
    for (const p of s4) byTime.set(p.t, { s4: p.v, risk: null });
    for (const p of risk) {
      const prev = byTime.get(p.t) ?? { s4: null, risk: null };
      prev.risk = p.v;
      byTime.set(p.t, prev);
    }
    const times = [...byTime.keys()].sort();
    if (!times.length) return null;
    const labels = times.map((t) => t);
    const epochs = times.map((t) => parseTimelineEpoch(t));
    return chronologicalSeries(labels, epochs, {
      s4: times.map((t) => byTime.get(t)?.s4 ?? null),
      risk: times.map((t) => byTime.get(t)?.risk ?? null),
    });
  }, [timelines]);

  const vtecPanelRaw = useMemo(() => {
    const set = new Set<string>();
    for (const s of plottedStations) for (const p of s.points) set.add(p.time);
    const times = [...set].sort();
    if (!times.length || !plottedStations.length) return null;
    const labels = times;
    const epochs = times.map((t) => parseTimelineEpoch(t));
    const series: Record<string, (number | null)[]> = {};
    for (const s of plottedStations) {
      const byTime = new Map(s.points.map((p) => [p.time, p.vtec_tecu]));
      series[s.station] = times.map((t) => byTime.get(t) ?? null);
    }
    return chronologicalSeries(labels, epochs, series);
  }, [plottedStations]);

  const timeDomain = useMemo(() => {
    if (!now) return null;
    return alignTimeDomain(now - rangeHours * ONE_H_MS, now, rangeHours <= 8 ? ONE_H_MS : SIX_H_MS);
  }, [now, rangeHours]);

  // Clip Kp/Dst/VTEC/GNSS to the same live UTC window as solar wind / IMF.
  // If the window empties a panel (stale cache), fall back to unclipped series.
  const kpPanel = useMemo(
    () => clipOrFallback(kpPanelRaw, timeDomain),
    [kpPanelRaw, timeDomain],
  );
  const dstPanel = useMemo(
    () => clipOrFallback(dstPanelRaw, timeDomain),
    [dstPanelRaw, timeDomain],
  );
  const vtecPanel = useMemo(
    () => clipOrFallback(vtecPanelRaw, timeDomain),
    [vtecPanelRaw, timeDomain],
  );
  const gnssPanelClipped = useMemo(
    () => clipOrFallback(gnssPanel, timeDomain),
    [gnssPanel, timeDomain],
  );

  const timeAxis = useMemo(
    () => utcTimeAxisProps(timeDomain, { rangeHours }),
    [timeDomain, rangeHours],
  );

  const analyses: Record<string, ChartAnalysisBlock> = {
    xray: {
      lead: "GOES X-ray flux identifies solar flares (A/B/C/M/X). Flare X-rays reach Earth in ~8 minutes and can disturb the dayside ionosphere.",
      bullets: [
        "Horizontal lines mark C (10⁻⁶), M (10⁻⁵) and X (10⁻⁴) W/m² thresholds.",
        "If Zimbabwe TEC jumps at the same UTC minute as an X-ray peak, investigate a flare response before assuming a geomagnetic storm.",
      ],
    },
    wind: {
      lead: "Solar-wind speed, density and proton temperature at L1 show arriving streams/shocks that can precede IMF and geomagnetic changes.",
      bullets: [
        "Sudden jumps (e.g. 380→620 km/s with density rising and temperature changing) often mark a shock/CME arrival.",
        "Speed or temperature alone does not make a storm — always read with IMF Bz and Kp/Dst.",
      ],
    },
    imf: {
      lead: "IMF Bz controls magnetospheric coupling. Sustained southward (negative) Bz is the key storm driver.",
      bullets: [
        "Bz > 0 (northward) usually weak coupling; Bz < 0 (southward) favours reconnection.",
        "Sustained Bz ≈ −12 to −18 nT for hours is far more important than a momentary spike.",
      ],
    },
    geo: {
      lead: "Kp summarises global geomagnetic activity; Dst/SYM-H tracks the ring-current storm intensity.",
      bullets: [
        "Kp ≥ 5 = G1+ storm conditions. More negative Dst = stronger storm.",
        "Compare these global indices with Zimbabwe VTEC and GNSS quality in the panels below.",
      ],
    },
    vtec: {
      lead: "TEC is the line integral of electron density Ne along the GNSS path (1 TECU = 10¹⁶ el/m²). Zimbabwe CORS VTEC is the local ionospheric response after Sun→Earth drivers.",
      bullets: [
        "Typical quiet values: night 1–10 TECU, day 10–40 TECU; high solar activity 50–100 TECU; extreme storms can exceed 200 TECU.",
        "Selected operational stations are plotted together on the same UTC axis.",
        "Daytime TEC rise can be quiet-time EUV behaviour. Storm evidence needs supporting Bz/Kp/Dst plus TEC departure from baseline (ΔTEC / ROTI under development).",
        "Full quiet-day vs disturbed ΔTEC envelopes remain on the Anomaly Detection page.",
      ],
    },
    gnss: {
      lead: "Scintillation observations and estimated GNSS risk provide context; they do not verify local positioning performance.",
      bullets: [
        "S4 is amplitude scintillation (when observed). GNSS risk is a provisional estimate from indices, not a receiver accuracy measurement.",
        "Live station-mean ROTI timelines are not yet ingested; PRN Explorer provides archive ROTI for research events.",
        "Investigate timing and propagation delays alongside local observations. Correlated signals do not establish causation or a positioning outage.",
      ],
    },
  };

  const bannerTitle =
    variant === "drivers"
      ? "Sun → Earth driver timelines"
      : variant === "local"
        ? "Zimbabwe ionosphere response"
        : variant === "liveMetric"
          ? "Sun → Earth → Zimbabwe timelines"
          : "Solar Drivers and Zimbabwe Response";
  const bannerSupport =
    variant === "drivers"
      ? "Measurement flow: GOES X-ray → solar wind → IMF → geomagnetic activity. Shared UTC window and synchronized crosshair across panels 1–4."
      : variant === "local"
        ? "Zimbabwe CORS VTEC, station online counts, and scintillation / GNSS risk only — shared UTC window with synchronized crosshair. Up to five station traces; VTEC history up to 48 hours. Planetary Kp colour bands are on the Kp Scale tab."
        : variant === "liveMetric"
          ? "Measurement flow: GOES X-ray → F10.7 → Heliospheric Monitor → Zimbabwe VTEC → CORS online → scintillation / GNSS risk."
          : "Shared UTC window and synchronized crosshair. Compare observations and propagation delays; alignment alone does not establish cause and effect. Up to five station traces are shown; coverage above includes all returned stations. Local VTEC history is available for up to 48 hours.";

  const hasDriverData = Boolean(helio || timelines);
  const hasLocalData = Boolean(timelines || vtec.length > 0);
  const showTimelineBody =
    showTimelineSection && (
      (showDrivers && (hasDriverData || !loading)) ||
      (showLocal && (hasLocalData || !loading))
    );

  return (
    <>
    {showChrome && (
      <>
        <LocalIonosphereObservations stations={vtec} now={now} refreshFailed={vtecRefreshFailed} loading={vtecLoading} />
        {/* CORS map is heavier than the readings — mount when near viewport. */}
        <DeferredMount
          className="sw-deferred-block"
          minHeight={260}
          rootMargin="240px 0px"
          eager
          fallback={
            <div className="home-map-loading" role="status" aria-live="polite">
              <span className="home-map-loading-spinner" aria-hidden="true" />
              <span>Loading CORS map…</span>
            </div>
          }
        >
          <SpaceWeatherCorsMap />
        </DeferredMount>
      </>
    )}
    {showTimelineSection && (
    <section className="card sw-driver-timelines" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} aria-labelledby="driver-timelines-title">
      <SwSectionBanner
        icon="🔗"
        title={bannerTitle}
        titleId="driver-timelines-title"
        tone={error ? "warn" : loading ? "warn" : "ok"}
        meta={
          <div className="sw-range-controls" role="group" aria-label="Shared chart time range">
            {([6, 24, 72] as const).map((hours) => (
              <button
                type="button"
                key={hours}
                aria-pressed={rangeHours === hours}
                onClick={() => {
                  setRangeHours(hours);
                  setSyncHoverMs(null);
                }}
              >
                {hours === 72 ? "3 days" : `${hours} hours`}
              </button>
            ))}
          </div>
        }
      />
      <p className="sw-supporting-text">{bannerSupport}</p>

      {loading && !helio && !timelines && vtec.length === 0 && (
        <div className="banner banner-info">Loading synchronized timelines…</div>
      )}
      {error && <div className="banner banner-warn">{error}</div>}

      {showTimelineBody && (
        <>
          {showDrivers && (
            <>
              <Panel
                title="1 · GOES X-ray flux"
                subtitle="Solar flares · logarithmic W/m² · C/M/X thresholds"
                analysis={analyses.xray}
                open={openPanel === "xray"}
                onToggle={() => setOpenPanel((p) => (p === "xray" ? null : "xray"))}
              >
                {xrayPanel ? (
                  <LineChart
                    labels={xrayPanel.labels}
                    datasets={[{ label: "0.1–0.8 nm", data: xrayPanel.series.flux, color: "#60a5fa", fill: true }]}
                    yLabel="X-ray flux (W/m²)"
                    height={180}
                    yLogScale
                    thresholds={FLARE_THRESHOLDS}
                    xValues={xrayPanel.epochs}
                    epochMs={xrayPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                  />
                ) : (
                  <div className="banner banner-info">X-ray series unavailable.</div>
                )}
              </Panel>

              <GoesXrayLastDayChart />

              {afterSun}

              <Panel
                title={`${nWind} · Solar wind speed + density + proton temp.`}
                subtitle="L1 RTSW · km/s, cm⁻³ and K · oldest → newest · toggle series in the legend"
                analysis={analyses.wind}
                open={openPanel === "wind"}
                onToggle={() => setOpenPanel((p) => (p === "wind" ? null : "wind"))}
              >
                {windPanel ? (
                  <LineChart
                    labels={windPanel.labels}
                    toggleableLegend
                    secondaryYLabel="Density (cm⁻³)"
                    tertiaryYLabel="Proton temp. (K)"
                    yLabel="Speed (km/s)"
                    height={180}
                    xValues={windPanel.epochs}
                    epochMs={windPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                    {...solarWindSpeedScale(windPanel.series.speed)}
                    thresholds={[
                      {
                        value: FAST_STREAM_KMS,
                        label: "Fast stream (500 km/s)",
                        color: "#ff8c00",
                        fillAbove: true,
                      },
                    ]}
                    datasets={[
                      { label: "Speed", data: windPanel.series.speed, color: "#eab308", fill: true, yAxisId: "y" },
                      {
                        label: "Density",
                        data: windPanel.series.density,
                        color: "#38bdf8",
                        yAxisId: "y2",
                      },
                      {
                        label: "Proton Temp.",
                        data: windPanel.series.temperature,
                        color: "#f97316",
                        yAxisId: "y3",
                      },
                    ]}
                  />
                ) : (
                  <div className="banner banner-info">Solar-wind series unavailable.</div>
                )}
              </Panel>

              <Panel
                title={`${nImf} · IMF Bz + Bt`}
                subtitle="L1 magnetometer · clear 0 nT line · southward Bz drives storms"
                analysis={analyses.imf}
                open={openPanel === "imf"}
                onToggle={() => setOpenPanel((p) => (p === "imf" ? null : "imf"))}
              >
                {imfPanel ? (
                  <LineChart
                    labels={imfPanel.labels}
                    yLabel="IMF (nT)"
                    height={180}
                    toggleableLegend
                    thresholds={[{ value: 0, label: "Bz = 0", color: "#94a3b8" }]}
                    xValues={imfPanel.epochs}
                    epochMs={imfPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                    datasets={[
                      { label: "Bt", data: imfPanel.series.bt, color: "#f8fafc" },
                      { label: "Bz (GSM)", data: imfPanel.series.bz, color: "#ef4444", fill: true },
                    ]}
                  />
                ) : (
                  <div className="banner banner-info">IMF series unavailable.</div>
                )}
              </Panel>

              <Panel
                title={`${nGeo} · Geomagnetic activity`}
                subtitle="Live NOAA Kp / Kyoto Dst — same UTC window as solar wind & IMF"
                analysis={analyses.geo}
                open={openPanel === "geo"}
                onToggle={() => setOpenPanel((p) => (p === "geo" ? null : "geo"))}
              >
                <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                  {(["kp", "dst"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setGeoTab(tab)}
                      style={{
                        padding: "0.2rem 0.7rem",
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        borderRadius: 5,
                        border: `1px solid ${geoTab === tab ? "var(--accent)" : "var(--border)"}`,
                        background: geoTab === tab ? "var(--accent)" : "var(--surface)",
                        color: "#fff",
                        cursor: "pointer",
                        textTransform: "uppercase",
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {geoTab === "kp" && kpPanel ? (
                  <LineChart
                    labels={kpPanel.labels}
                    yLabel="Kp"
                    height={170}
                    toggleableLegend
                    thresholds={[{ value: 5, label: "Storm threshold (Kp 5)", color: "#ff8c00" }]}
                    xValues={kpPanel.epochs}
                    epochMs={kpPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                    datasets={[
                      { label: "Observed", data: kpPanel.series.observed, color: "#22c55e" },
                      { label: "Estimated", data: kpPanel.series.estimated, color: "#eab308" },
                      { label: "Predicted", data: kpPanel.series.predicted, color: "#38bdf8", dashed: true },
                    ]}
                  />
                ) : geoTab === "dst" && dstPanel ? (
                  <LineChart
                    labels={dstPanel.labels}
                    yLabel="Dst (nT)"
                    height={170}
                    thresholds={[
                      { value: -50, label: "Storm threshold (−50 nT)", color: "#ff8c00" },
                      { value: -100, label: "Intense (−100 nT)", color: "#ef4444" },
                    ]}
                    xValues={dstPanel.epochs}
                    epochMs={dstPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                    datasets={[{ label: "Dst", data: dstPanel.series.dst, color: "#34d399", fill: true }]}
                  />
                ) : (
                  <div className="banner banner-info">Geomagnetic series unavailable for this tab.</div>
                )}
              </Panel>
            </>
          )}

          {showLocal && (
            <>
              <Panel
                title={`${nVtec} · Zimbabwe VTEC`}
                subtitle="Live CORS stations · local ionospheric response"
                analysis={analyses.vtec}
                open={openPanel === "vtec"}
                onToggle={() => setOpenPanel((p) => (p === "vtec" ? null : "vtec"))}
              >
                {vtecPanel ? (
                  <LineChart
                    labels={vtecPanel.labels}
                    yLabel="VTEC (TECU)"
                    height={190}
                    toggleableLegend
                    xValues={vtecPanel.epochs}
                    epochMs={vtecPanel.epochs}
                    {...timeAxis}
                    {...syncProps}
                    datasets={Object.entries(vtecPanel.series).map(([station, data]) => {
                      const code = station.toLowerCase().replace(/_+$/, "");
                      return {
                        label: `${station.toUpperCase()} VTEC`,
                        data,
                        color: STATION_COLORS[code] ?? "#94a3b8",
                      };
                    })}
                  />
                ) : (
                  <div className="banner banner-info">
                    {loading
                      ? "Loading station VTEC…"
                      : vtecRefreshFailed
                        ? "Station VTEC observations are unavailable. Retrying automatically."
                        : "No station VTEC points in the selected time range yet."}
                  </div>
                )}
                {openPanel === "vtec" && (
                  <div style={{ marginTop: "0.65rem" }}>
                    <TecPrimerBlock compact />
                  </div>
                )}
              </Panel>

              {afterVtec}

              <Panel
                title={`${nGnss} · Scintillation observations and estimated GNSS risk`}
                subtitle="S4 archive + provisional risk estimate · local positioning impact not verified"
                analysis={analyses.gnss}
                open={openPanel === "gnss"}
                onToggle={() => setOpenPanel((p) => (p === "gnss" ? null : "gnss"))}
              >
                {gnssPanelClipped ? (
                  <LineChart
                    labels={gnssPanelClipped.labels}
                    yLabel="S4"
                    height={180}
                    toggleableLegend
                    secondaryYLabel="Estimated risk"
                    xValues={gnssPanelClipped.epochs}
                    epochMs={gnssPanelClipped.epochs}
                    {...timeAxis}
                    {...syncProps}
                    datasets={[
                      {
                        label: "S4",
                        data: gnssPanelClipped.series.s4,
                        color: "#f97316",
                        yAxisId: "y",
                      },
                      {
                        label: "Estimated GNSS risk (provisional)",
                        data: gnssPanelClipped.series.risk,
                        color: "#a78bfa",
                        yAxisId: "y2",
                      },
                    ]}
                  />
                ) : (
                  <div className="banner banner-info">
                    {loading
                      ? "Loading GNSS risk timelines…"
                      : "S4 archive is empty for this window. Estimated GNSS risk still updates from indices when available."}
                  </div>
                )}
              </Panel>
            </>
          )}

          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            {showDrivers && showLocal
              ? "Live NOAA SWPC + Kyoto Dst + Zimbabwe VTEC"
              : showDrivers
                ? "Live NOAA SWPC GOES · L1 RTSW · IMF · Kp / Kyoto Dst"
                : "Zimbabwe VTEC + scintillation / GNSS risk context"}
            {helio?.updated_utc
              ? ` · Updated ${helio.updated_utc.replace("T", " ").replace("Z", " UTC")}`
              : ""}
          </div>
        </>
      )}
    </section>
    )}
    </>
  );
}
