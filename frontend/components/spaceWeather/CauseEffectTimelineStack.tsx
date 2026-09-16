"use client";

import { useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getHeliosphericMonitor, getLiveVtecByStation, getTimelines } from "@/lib/api";
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
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "0.45rem" }}>
        {subtitle}
      </div>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--accent)", marginTop: "0.35rem", fontWeight: 700 }}>
        {open ? "Hide explanation" : "Click for scientific explanation"}
      </div>
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

/** Hourly UTC ticks: `00:00 | 2026-09-16` at midnight, otherwise `HH:mm`. */
function formatKnmiUtcTick(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  if (hh === 0 && mm === 0) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${time} | ${y}-${mo}-${day}`;
  }
  return time;
}

function formatHoverUtc(ms: number | null): string {
  if (ms == null) return "Hover any panel — shared UTC cursor";
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${hh}:${mi} UTC`;
}

/** Oldest → newest; drop null epochs. Reorders all parallel arrays together. */
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

function sharedTimeDomain(epochLists: number[][]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const list of epochLists) {
    for (const ms of list) {
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const pad = ONE_H_MS;
  return {
    min: Math.floor((min - pad) / ONE_H_MS) * ONE_H_MS,
    max: Math.ceil((max + pad) / ONE_H_MS) * ONE_H_MS,
  };
}

export default function CauseEffectTimelineStack() {
  const [helio, setHelio] = useState<HeliosphericMonitorResponse | null>(null);
  const [timelines, setTimelines] = useState<SpaceWeatherTimelines | null>(null);
  const [vtec, setVtec] = useState<LiveStationVtecSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncHoverMs, setSyncHoverMs] = useState<number | null>(null);
  const [geoTab, setGeoTab] = useState<GeoTab>("kp");
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      getHeliosphericMonitor(true),
      getTimelines(),
      getLiveVtecByStation(24, 10),
    ]).then((results) => {
      if (cancelled) return;
      const [h, t, v] = results;
      if (h.status === "fulfilled") setHelio(h.value);
      if (t.status === "fulfilled") setTimelines(t.value);
      if (v.status === "fulfilled") {
        const rows = Array.isArray(v.value) ? v.value : [];
        const preferred = rows.filter((s) =>
          PRIORITY_STATIONS.includes(
            s.station.toLowerCase().replace(/_+$/, "") as (typeof PRIORITY_STATIONS)[number],
          ),
        );
        // Prefer Harare/Bulawayo/… when live; otherwise show up to 5 stations that have points.
        const picked =
          preferred.length > 0
            ? preferred
            : [...rows]
                .filter((s) => (s.points?.length ?? 0) > 0)
                .sort((a, b) => (b.points?.length ?? 0) - (a.points?.length ?? 0))
                .slice(0, 5);
        setVtec(picked);
      }
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length === results.length) {
        setError("Cause→effect timelines unavailable right now.");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    });
  }, [helio]);

  const imfPanel = useMemo(() => {
    const raw = helio?.imf;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return chronologicalSeries(raw.labels, epochs, { bt: raw.bt, bz: raw.bz });
  }, [helio]);

  const kpPanel = useMemo(() => {
    const raw = helio?.kp;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return chronologicalSeries(raw.labels, epochs, {
      observed: raw.observed,
      estimated: raw.estimated,
      predicted: raw.predicted,
    });
  }, [helio]);

  const dstPanel = useMemo(() => {
    const raw = helio?.dst;
    if (!raw?.labels?.length) return null;
    const epochs = seriesEpochMs(raw.epoch_ms, raw.times, raw.labels);
    return chronologicalSeries(raw.labels, epochs, { dst: raw.dst });
  }, [helio]);

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
    for (const s of vtec) for (const p of s.points) set.add(p.time);
    const times = [...set].sort();
    if (!times.length || !vtec.length) return null;
    const labels = times;
    const epochs = times.map((t) => parseTimelineEpoch(t));
    const series: Record<string, (number | null)[]> = {};
    for (const s of vtec) {
      const byTime = new Map(s.points.map((p) => [p.time, p.vtec_tecu]));
      series[s.station] = times.map((t) => byTime.get(t) ?? null);
    }
    return chronologicalSeries(labels, epochs, series);
  }, [vtec]);

  const timeDomain = useMemo(() => {
    // Prefer high-cadence L1 / ionosphere windows so panels share one readable span.
    const lists = [
      xrayPanel?.epochs,
      windPanel?.epochs,
      imfPanel?.epochs,
      vtecPanel?.epochs,
    ].filter((e): e is number[] => !!e && e.length > 0);
    if (lists.length === 0) {
      const fallback = [kpPanel?.epochs, dstPanel?.epochs, gnssPanel?.epochs].filter(
        (e): e is number[] => !!e && e.length > 0,
      );
      return sharedTimeDomain(fallback);
    }
    return sharedTimeDomain(lists);
  }, [xrayPanel, windPanel, imfPanel, vtecPanel, kpPanel, dstPanel, gnssPanel]);

  const timeAxis = useMemo(() => {
    if (!timeDomain) return {};
    return {
      xMin: timeDomain.min,
      xMax: timeDomain.max,
      xStepSize: ONE_H_MS,
      formatXTick: formatKnmiUtcTick,
      xLabel: "UTC",
    };
  }, [timeDomain]);

  const analyses: Record<string, ChartAnalysisBlock> = {
    xray: {
      lead: "GOES X-ray flux identifies solar flares (A/B/C/M/X). Flare X-rays reach Earth in ~8 minutes and can disturb the dayside ionosphere.",
      bullets: [
        "Horizontal lines mark C (10⁻⁶), M (10⁻⁵) and X (10⁻⁴) W/m² thresholds.",
        "If Zimbabwe TEC jumps at the same UTC minute as an X-ray peak, investigate a flare response before assuming a geomagnetic storm.",
      ],
    },
    wind: {
      lead: "Solar-wind speed and density at L1 show arriving streams/shocks that can precede IMF and geomagnetic changes.",
      bullets: [
        "Sudden jumps (e.g. 380→620 km/s with density rising) often mark a shock/CME arrival.",
        "Speed alone does not make a storm — always read with IMF Bz and Kp/Dst.",
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
      lead: "GNSS quality proxies show whether the ionosphere actually hurt navigation — not just whether Kp was high.",
      bullets: [
        "S4 is amplitude scintillation (when observed). GNSS risk is the operational navigation impact label from live indices.",
        "Live station-mean ROTI timelines are not yet ingested; PRN Explorer provides archive ROTI for research events.",
        "A strong story is: southward Bz + Kp≥5 + VTEC anomaly + elevated S4/risk at the same UTC time.",
      ],
    },
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: "0.3rem" }}>
          Cause → Effect Timeline · Zimbabwe GNSS
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Six aligned panels (oldest → newest, left → right). Shared UTC axis with one-hour ticks
          (`00:00 | YYYY-MM-DD` at midnight). Hover any chart for a shared vertical cursor.
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.35rem", fontWeight: 700 }}>
          Cursor: {formatHoverUtc(syncHoverMs)}
        </div>
      </div>

      {loading && <div className="banner banner-info">Loading synchronized cause→effect timelines…</div>}
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
            title="2 · Solar wind speed + density"
            subtitle="L1 RTSW · km/s and cm⁻³ · oldest → newest · toggle series in the legend"
            analysis={analyses.wind}
            open={openPanel === "wind"}
            onToggle={() => setOpenPanel((p) => (p === "wind" ? null : "wind"))}
          >
            {windPanel ? (
              <LineChart
                labels={windPanel.labels}
                toggleableLegend
                secondaryYLabel="Density (cm⁻³)"
                yLabel="Speed (km/s)"
                height={180}
                xValues={windPanel.epochs}
                epochMs={windPanel.epochs}
                {...timeAxis}
                {...syncProps}
                datasets={[
                  { label: "Speed", data: windPanel.series.speed, color: "#eab308", fill: true, yAxisId: "y" },
                  {
                    label: "Density",
                    data: windPanel.series.density,
                    color: "#38bdf8",
                    yAxisId: "y2",
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
            subtitle="Public: Kp · Research: Dst — switch tabs below"
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
                    fontSize: "0.72rem",
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
                  { value: -50, label: "Moderate", color: "#eab308" },
                  { value: -100, label: "Intense", color: "#ef4444" },
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
                Live station VTEC not streaming yet — keep the NTRIP collector running.
              </div>
            )}
          </Panel>

          <Panel
            title="6 · GNSS quality / scintillation proxies"
            subtitle="S4 + GNSS risk timelines · ROTI map/PRN explorer for research depth"
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
                secondaryYLabel="GNSS risk"
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
                    label: "GNSS risk",
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

          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Time runs left → right (past → present), UTC. Cause chain uses live NOAA SWPC + Kyoto Dst + Zimbabwe
            live VTEC. Shared cursor aligns events across panels even when cadences differ.
            {helio?.updated_utc
              ? ` · Heliospheric update ${helio.updated_utc.replace("T", " ").replace("Z", " UTC")}`
              : ""}
          </div>
        </>
      )}
    </div>
  );
}
