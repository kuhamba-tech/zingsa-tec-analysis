"use client";

import { useEffect, useMemo, useState } from "react";
import LocalIonosphereObservations from "./LocalIonosphereObservations";
import SwSectionBanner from "./SwSectionBanner";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getHeliosphericMonitor, getLiveVtecByStation, getTimelines } from "@/lib/api";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import type {
  HeliosphericMonitorResponse,
  LiveStationVtecSeries,
  SpaceWeatherTimelines,
} from "@/lib/types";

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

function parseTimelineEpoch(t: string): number | null {
  const ms = Date.parse(t.endsWith("Z") || t.includes("+") ? t : `${t}Z`);
  return Number.isFinite(ms) ? ms : null;
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
    return times.map((t) => parseTimelineEpoch(t));
  }
  return labels.map(() => null);
}

const ONE_H_MS = 60 * 60 * 1000;
const SIX_H_MS = 6 * ONE_H_MS;

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

export default function CauseEffectTimelineStack() {
  const [helio, setHelio] = useState<HeliosphericMonitorResponse | null>(null);
  const [timelines, setTimelines] = useState<SpaceWeatherTimelines | null>(null);
  const [vtec, setVtec] = useState<LiveStationVtecSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncHoverMs, setSyncHoverMs] = useState<number | null>(null);
  const [geoTab, setGeoTab] = useState<GeoTab>("kp");
  const [rangeHours, setRangeHours] = useState<6 | 24 | 72>(24);
  const [now, setNow] = useState(0);
  const [vtecRefreshFailed, setVtecRefreshFailed] = useState(false);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const cached = peekHeliosphericMonitor();
    if (cached) { setHelio(cached); setLoading(false); }
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      const results = await Promise.allSettled([
        getHeliosphericMonitor(false, true), getTimelines(), getLiveVtecByStation(Math.min(rangeHours, 48), 2),
      ]);
      inFlight = false;
      if (cancelled) return;
      const [h, t, v] = results;
      if (h.status === "fulfilled") setHelio(h.value);
      if (t.status === "fulfilled") setTimelines(t.value);
      if (v.status === "fulfilled") setVtec(Array.isArray(v.value) ? v.value : []);
      setVtecRefreshFailed(v.status === "rejected");
      const failed = results.filter((result) => result.status === "rejected").length;
      setError(failed ? `${failed} of 3 timeline feeds could not refresh. Retained observations may lag; check their timestamps.` : null);
      setLoading(false);
    };
    setNow(Date.now());
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(clock); };
  }, [rangeHours]);

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
    return chronologicalSeries(raw.labels, epochs, { flux: raw.flux });
  }, [helio]);

  const windPanel = useMemo(() => {
    const raw = helio?.solar_wind;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return chronologicalSeries(raw.labels, epochs, {
      speed: raw.speed,
      density: raw.density ?? raw.speed.map(() => null),
      temperature: raw.temperature ?? raw.speed.map(() => null),
    });
  }, [helio]);

  const imfPanel = useMemo(() => {
    const raw = helio?.imf;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return chronologicalSeries(raw.labels, epochs, { bt: raw.bt, bz: raw.bz });
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

  const vtecPanel = useMemo(() => {
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

  const timeDomain = useMemo(() => now ? { min: now - rangeHours * ONE_H_MS, max: now } : null, [now, rangeHours]);

  // Clip Kp/Dst to the same live UTC window as solar wind / IMF.
  const kpPanel = useMemo(
    () => clipSeriesToDomain(kpPanelRaw, timeDomain),
    [kpPanelRaw, timeDomain],
  );
  const dstPanel = useMemo(
    () => clipSeriesToDomain(dstPanelRaw, timeDomain),
    [dstPanelRaw, timeDomain],
  );

  const timeAxis = useMemo(() => {
    if (!timeDomain) return {};
    return {
      xMin: timeDomain.min,
      xMax: timeDomain.max,
      xStepSize: ONE_H_MS,
      xMajorStepMs: rangeHours === 6 ? ONE_H_MS : SIX_H_MS,
      formatXTick: (ms: number) => {
        const date = new Date(ms);
        const time = date.toISOString().slice(11, 16);
        if (rangeHours === 6) return time;
        if (date.getUTCHours() % 6 !== 0 || date.getUTCMinutes() !== 0) return "";
        return rangeHours === 72 ? `${date.toISOString().slice(5, 10)} ${time}` : time;
      },
      xLabel: "UTC",
    };
  }, [timeDomain, rangeHours]);

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
      lead: "Zimbabwe CORS VTEC is the local ionospheric response — the key step from international drivers to regional impact.",
      bullets: [
        "Selected operational stations are plotted together on the same UTC axis.",
        "Daytime TEC rise can be quiet-time EUV behaviour. Storm evidence needs supporting Bz/Kp/Dst plus TEC departure from baseline.",
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

  return (
    <>
    <LocalIonosphereObservations stations={vtec} now={now} refreshFailed={vtecRefreshFailed} loading={loading} />
    <section className="card sw-driver-timelines" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} aria-labelledby="driver-timelines-title">
      <SwSectionBanner
        icon="🔗"
        title="Solar Drivers and Zimbabwe Response"
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
      <p className="sw-supporting-text">Shared UTC window and synchronized crosshair. Compare observations and propagation delays; alignment alone does not establish cause and effect. Up to five station traces are shown; coverage above includes all returned stations. Local VTEC history is available for up to 48 hours.</p>

      {loading && <div className="banner banner-info">Loading synchronized timelines…</div>}
      {error && !loading && <div className="banner banner-warn">{error}</div>}

      {!loading && (
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

          <Panel
            title="2 · Solar wind speed + density + proton temp."
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
            title="3 · IMF Bz + Bt"
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
            title="4 · Geomagnetic activity"
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

          <Panel
            title="5 · Zimbabwe VTEC"
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
                Station VTEC observations are unavailable. Retrying automatically.
              </div>
            )}
          </Panel>

          <Panel
            title="6 · Scintillation observations and estimated GNSS risk"
            subtitle="S4 archive + provisional risk estimate · local positioning impact not verified"
            analysis={analyses.gnss}
            open={openPanel === "gnss"}
            onToggle={() => setOpenPanel((p) => (p === "gnss" ? null : "gnss"))}
          >
            {gnssPanel ? (
              <LineChart
                labels={gnssPanel.labels}
                yLabel="S4"
                height={180}
                toggleableLegend
                secondaryYLabel="Estimated risk"
                xValues={gnssPanel.epochs}
                epochMs={gnssPanel.epochs}
                {...timeAxis}
                {...syncProps}
                datasets={[
                  {
                    label: "S4",
                    data: gnssPanel.series.s4,
                    color: "#f97316",
                    yAxisId: "y",
                  },
                  {
                    label: "Estimated GNSS risk (provisional)",
                    data: gnssPanel.series.risk,
                    color: "#a78bfa",
                    yAxisId: "y2",
                  },
                ]}
              />
            ) : (
              <div className="banner banner-info">
                S4/GNSS-risk timelines unavailable. S4 stays empty until archive-backed scintillation is observed.
              </div>
            )}
          </Panel>

          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Live NOAA SWPC + Kyoto Dst + Zimbabwe VTEC
            {helio?.updated_utc
              ? ` · Updated ${helio.updated_utc.replace("T", " ").replace("Z", " UTC")}`
              : ""}
          </div>
        </>
      )}
    </section>
    </>
  );
}
