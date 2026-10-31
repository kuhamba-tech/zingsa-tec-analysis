"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import BarChart from "@/components/charts/BarChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import LineChart from "@/components/charts/LineChart";
import PrnConstellationPanel from "@/components/prnExplorer/PrnConstellationPanel";
import PrnFilters from "@/components/prnExplorer/PrnFilters";
import PrnSkyPlot from "@/components/prnExplorer/PrnSkyPlot";
import { getPrnConstellations, getPrnExplorer } from "@/lib/api";
import { ELEVATION_MIN_DEG } from "@/lib/elevationMask";
import { analyzePrnVtec } from "@/lib/prnChartAnalysis";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import type {
  PrnConstellationInfo,
  PrnConstellationPayload,
  PrnExplorerResponse,
  PrnObservation,
  PrnRow,
} from "@/lib/types";

const PRN_COLORS = [
  "#168bd2", "#ff4444", "#00ff88", "#ff8c00", "#a78bfa",
  "#ffcc00", "#34d399", "#f472b6", "#60a5fa", "#f97316",
];

type Tab = "vtec" | "sky" | "elev" | "quality" | "disturbance";

const DEFAULT_CONSTELLATION_REFERENCE: PrnConstellationPayload = {
  citation: "Built-in GNSS constellation reference for static deployments.",
  quality_note: "Quality metrics are populated when live or processed per-PRN observations are available.",
  constellations: [
    {
      id: "GPS",
      label: "GPS",
      icon: "🛰️",
      prefix: "G",
      max_prn: 32,
      color: "#168bd2",
      prn_range: "G01-G32",
      section: "Chapter 4",
      summary: "The U.S. GPS constellation provides the core L-band navigation signals used for station-level TEC and PRN-by-PRN integrity monitoring.",
      frequencies: "L1, L2, L5",
      metrics: [],
      formula_caption: "Slant TEC is mapped to vertical TEC using elevation-dependent geometry.",
      formula: "VTEC = STEC / M(E)",
      zgiis: "GPS PRNs provide the main operational baseline for Zimbabwe CORS ionospheric monitoring.",
    },
    {
      id: "Galileo",
      label: "Galileo",
      icon: "🌐",
      prefix: "E",
      max_prn: 36,
      color: "#00ff88",
      prn_range: "E01-E36",
      section: "Chapter 4",
      summary: "Galileo adds independent European GNSS observations that improve geometry, redundancy, and multi-constellation TEC comparisons.",
      frequencies: "E1, E5a, E5b, E6",
      metrics: [],
      formula_caption: "Multi-frequency signals support ionospheric delay estimation.",
      formula: "TEC ∝ (P2 - P1) / (1/f1² - 1/f2²)",
      zgiis: "Galileo PRNs help cross-check GPS-derived TEC and reduce single-constellation bias.",
    },
    {
      id: "BeiDou",
      label: "BeiDou",
      icon: "🧭",
      prefix: "C",
      max_prn: 63,
      color: "#ff8c00",
      prn_range: "C01-C63",
      section: "Chapter 4",
      summary: "BeiDou contributes additional Asian GNSS coverage and strengthens multi-constellation ionospheric monitoring over southern Africa.",
      frequencies: "B1, B2, B3",
      metrics: [],
      formula_caption: "Per-satellite residuals can reveal constellation-specific effects.",
      formula: "Residual = observed TEC - model TEC",
      zgiis: "BeiDou improves PRN diversity for Zimbabwe CORS processing where receiver support is available.",
    },
    {
      id: "GLONASS",
      label: "GLONASS",
      icon: "📡",
      prefix: "R",
      max_prn: 24,
      color: "#a78bfa",
      prn_range: "R01-R24",
      section: "Chapter 4",
      summary: "GLONASS provides Russian GNSS observations with a different signal structure, useful for independent checks and robustness.",
      frequencies: "G1, G2, G3",
      metrics: [],
      formula_caption: "Constellation comparison separates receiver, geometry, and space-weather effects.",
      formula: "ΔTEC = VTECconstellation - VTECnetwork",
      zgiis: "GLONASS adds redundancy during disturbed periods when PRN geometry and tracking quality matter.",
    },
  ],
};

function emptyPrnResponse(message: string): PrnExplorerResponse {
  return {
    meta: {
      source: "none",
      record_count: 0,
      stations: [],
      prns: [],
      has_azimuth: false,
      has_elevation: false,
      has_quality: false,
      has_roti: false,
      has_s4: false,
      time_start: null,
      time_end: null,
      message,
    },
    summary: [],
    observations: [],
  };
}

function matchesConstellation(prn: string, constellation: string): boolean {
  const c = constellation.toLowerCase();
  if (c === "gps") return prn.startsWith("G");
  if (c === "galileo") return prn.startsWith("E");
  if (c === "beidou") return prn.startsWith("C");
  if (c === "glonass") return prn.startsWith("R");
  return true;
}

function formatTsLabel(iso: string, spanHours: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (spanHours <= 48) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

function rankMetric(
  rows: PrnRow[],
  value: (row: PrnRow) => number | null | undefined,
): { low: { prn: string; value: number }; high: { prn: string; value: number }; mean: number; count: number } | null {
  const usable = rows
    .map((row) => ({ prn: row.prn, value: value(row) }))
    .filter((row): row is { prn: string; value: number } => typeof row.value === "number" && Number.isFinite(row.value));
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const mean = usable.reduce((sum, row) => sum + row.value, 0) / usable.length;
  return { low: sorted[0], high: sorted[sorted.length - 1], mean, count: usable.length };
}

function ClickableGraph({
  title,
  open,
  onToggle,
  analysis,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  analysis: ChartAnalysisBlock;
  children: ReactNode;
}) {
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${title}. Click the graph for the explanation.`}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a, input, button, label, .chart-analysis")) return;
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: "pointer", borderColor: open ? "var(--accent)" : undefined }}
    >
      <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{title}</div>
      <p style={{ margin: "0 0 0.55rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        {open ? "Click the graph again to hide the explanation" : "Click the graph for the explanation"}
      </p>
      {children}
      {open && (
        <div className="chart-analysis">
          <ChartAnalysisBox block={analysis} title="Explanation" />
        </div>
      )}
    </div>
  );
}

function constellationStats(rows: PrnRow[], id: string) {
  const filtered = rows.filter((r) => r.constellation?.toLowerCase() === id.toLowerCase());
  const vtecs = filtered.map((r) => r.mean_vtec ?? 0).filter((v) => v > 0);
  const quals = filtered.map((r) => r.mean_qual ?? 0).filter((v) => v > 0);
  return {
    count: filtered.length,
    meanVtec: vtecs.length ? vtecs.reduce((a, b) => a + b, 0) / vtecs.length : null,
    meanQual: quals.length ? quals.reduce((a, b) => a + b, 0) / quals.length : null,
  };
}

export default function PrnExplorerPage() {
  const [theory, setTheory] = useState<PrnConstellationPayload>(DEFAULT_CONSTELLATION_REFERENCE);
  const [data, setData] = useState<PrnExplorerResponse | null>(null);
  const [selected, setSelected] = useState("GPS");
  const [tab, setTab] = useState<Tab>("vtec");
  const [openGraph, setOpenGraph] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [station, setStation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [elevMin, setElevMin] = useState(ELEVATION_MIN_DEG);
  const [selectedPrns, setSelectedPrns] = useState<string[]>([]);
  const [qualThreshold, setQualThreshold] = useState(70);

  const constellations = theory?.constellations ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {
        constellation: selected,
        elev_min: elevMin,
        hours: 168,
        limit: 8000,
      };
      if (station) params.station = station;
      if (start) params.start = start;
      if (end) params.end = end;
      if (selectedPrns.length) params.prns = selectedPrns.join(",");

      const payload = await getPrnExplorer(params);
      setData(payload);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(null);
      setData(emptyPrnResponse(
        detail.includes("404")
          ? "PRN Explorer API is not available on this Vercel frontend deployment. Per-satellite charts will appear when the FastAPI backend is connected or PRN CMN/live data is loaded."
          : "PRN data is temporarily unavailable. Per-satellite charts will appear when the backend responds or PRN CMN/live data is loaded.",
      ));
    }
    setLoading(false);
  }, [selected, station, start, end, elevMin, selectedPrns]);

  useEffect(() => {
    getPrnConstellations().then(setTheory).catch(() => setTheory(DEFAULT_CONSTELLATION_REFERENCE));
  }, []);

  useEffect(() => {
    load();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps — constellation change auto-reloads

  const summary = useMemo(
    () => (data?.summary ?? []).filter((r) => matchesConstellation(r.prn, selected)),
    [data?.summary, selected],
  );

  const observations = useMemo(() => {
    let rows = (data?.observations ?? []).filter((o) => matchesConstellation(o.prn, selected));
    if (selectedPrns.length) rows = rows.filter((o) => selectedPrns.includes(o.prn));
    return rows;
  }, [data?.observations, selected, selectedPrns]);

  const activePrns = useMemo(() => {
    const fromObs = [...new Set(observations.map((o) => o.prn))].sort();
    if (fromObs.length) return fromObs;
    return summary.map((r) => r.prn).sort();
  }, [observations, summary]);

  const chartPrns = useMemo(() => {
    const base = selectedPrns.length ? selectedPrns.filter((p) => activePrns.includes(p)) : activePrns;
    return base.slice(0, 9);
  }, [activePrns, selectedPrns]);

  const timeChart = useMemo(() => {
    const pts = observations.filter((o) => o.vtec != null && chartPrns.includes(o.prn));
    if (!pts.length) return null;

    const times = [...new Set(pts.map((o) => o.timestamp))].sort();
    const t0 = new Date(times[0]).getTime();
    const t1 = new Date(times[times.length - 1]).getTime();
    const spanHours = Math.max(1, (t1 - t0) / 3_600_000);

    const labels = times.map((t) => formatTsLabel(t, spanHours));
    const datasets = chartPrns.map((prn, i) => {
      const byTime = new Map(pts.filter((p) => p.prn === prn).map((p) => [p.timestamp, p.vtec]));
      return {
        label: prn,
        data: times.map((t) => byTime.get(t) ?? null),
        color: PRN_COLORS[i % PRN_COLORS.length],
      };
    });
    return { labels, datasets, spanHours };
  }, [observations, chartPrns]);

  const elevBins = useMemo(() => Array.from({ length: 9 }, (_, i) => i * 10 + 5), []);
  const elevDatasets = useMemo(() => {
    return chartPrns.slice(0, 6).map((prn, i) => {
      const prnObs = observations.filter((o) => o.prn === prn && o.elevation_deg != null && o.vtec != null);
      const binned = elevBins.map((bin) => {
        const inBin = prnObs.filter((o) => Math.abs((o.elevation_deg ?? 0) - bin) <= 5);
        if (!inBin.length) return null;
        return inBin.reduce((a, o) => a + (o.vtec ?? 0), 0) / inBin.length;
      });
      return { label: prn, data: binned, color: PRN_COLORS[i % PRN_COLORS.length] };
    });
  }, [observations, chartPrns, elevBins]);

  const stecElevDatasets = useMemo(() => {
    return chartPrns.slice(0, 4).map((prn, i) => {
      const prnObs = observations.filter((o) => o.prn === prn && o.elevation_deg != null && o.stec != null);
      const binned = elevBins.map((bin) => {
        const inBin = prnObs.filter((o) => Math.abs((o.elevation_deg ?? 0) - bin) <= 5);
        if (!inBin.length) return null;
        return inBin.reduce((a, o) => a + (o.stec ?? 0), 0) / inBin.length;
      });
      return { label: `${prn} STEC`, data: binned, color: PRN_COLORS[i % PRN_COLORS.length], dashed: true };
    });
  }, [observations, chartPrns, elevBins]);

  const qualRows = useMemo(
    () => [...summary].sort((a, b) => (a.mean_qual ?? 0) - (b.mean_qual ?? 0)),
    [summary],
  );
  const lowQual = qualRows.filter((r) => (r.mean_qual ?? 100) < qualThreshold);

  const disturbanceRows = useMemo(
    () => [...summary].sort((a, b) => (b.max_roti ?? 0) - (a.max_roti ?? 0)),
    [summary],
  );

  const rotiChart = useMemo(() => {
    const pts = observations.filter((o) => o.roti_tecu_per_min != null && chartPrns.includes(o.prn));
    if (!pts.length) return null;
    const times = [...new Set(pts.map((o) => o.timestamp))].sort();
    const t0 = new Date(times[0]).getTime();
    const t1 = new Date(times[times.length - 1]).getTime();
    const spanHours = Math.max(1, (t1 - t0) / 3_600_000);
    const labels = times.map((t) => formatTsLabel(t, spanHours));
    const datasets = chartPrns.map((prn, i) => {
      const byTime = new Map(pts.filter((p) => p.prn === prn).map((p) => [p.timestamp, p.roti_tecu_per_min]));
      return {
        label: prn,
        data: times.map((t) => byTime.get(t) ?? null),
        color: PRN_COLORS[i % PRN_COLORS.length],
      };
    });
    return { labels, datasets };
  }, [observations, chartPrns]);

  const selectedInfo = constellations.find((c) => c.id === selected) ?? null;
  const cardStats = constellationStats(data?.summary ?? [], selected);
  const meta = data?.meta;
  const hasData = summary.length > 0 || observations.length > 0;

  const sourceLabel =
    meta?.source === "live" ? "Live NTRIP pipeline"
    : meta?.source === "cmn" ? "Processed CMN files"
    : meta?.source === "archive" ? "TEC archive"
    : "No per-PRN source";

  const vtecAnalysis = useMemo(
    () => analyzePrnVtec(observations, chartPrns, sourceLabel),
    [observations, chartPrns, sourceLabel],
  );
  const toggleGraph = (id: string) => setOpenGraph((current) => (current === id ? null : id));

  const skyAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const placed = observations.filter(
      (row) => chartPrns.includes(row.prn) && row.elevation_deg != null && row.azimuth_deg != null,
    );
    return {
      lead: "The sky plot places each selected satellite by azimuth around the horizon and elevation from the rim to zenith at the centre. The marker is that PRN’s latest look angle in this window.",
      bullets: [
        placed.length
          ? `${placed.length.toLocaleString()} observations have both elevation and azimuth. Satellites near the rim are low in the sky and have a longer ionospheric path.`
          : "No elevation and azimuth pair is available yet, so the sky plot cannot place satellites.",
        "Use it with the TEC plots: the same look direction is where that satellite’s TEC sample was taken.",
      ],
    };
  }, [observations, chartPrns]);

  const integrityAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const rank = rankMetric(disturbanceRows, (row) => row.integrity_score);
    return {
      lead: "Each bar is the mean GNSS integrity score for that PRN, from 0 to 100. A taller bar is a cleaner arc for positioning. This score is calculated from the observations on this page. It is not a broadcast integrity alert.",
      bullets: rank
        ? [
            `${rank.count} satellites are plotted. Highest is ${rank.high.prn} at ${rank.high.value.toFixed(0)}%. Lowest is ${rank.low.prn} at ${rank.low.value.toFixed(0)}%. The mean is ${rank.mean.toFixed(0)}%.`,
            "The score starts at 100 and is reduced by ROTI, S4 scintillation, carrier-to-noise variation, poor arc quality, low elevation, and an inferred cycle slip.",
            "A short bar means that satellite should be down-weighted in this window. One low score does not by itself confirm a geomagnetic storm.",
          ]
        : ["No integrity scores are available for the selected satellites."],
    };
  }, [disturbanceRows]);

  const slipAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const rank = rankMetric(disturbanceRows, (row) => row.cycle_slip_count);
    return {
      lead: "Each bar counts inferred cycle slips for that PRN. A slip is flagged when slant TEC jumps by more than 20 TECU within 2 minutes, when the TEC series jumps by more than 10 TECU in that same gap, or when the rate of TEC exceeds 10 TECU per minute.",
      bullets: rank
        ? [
            `${rank.high.prn} has the most inferred slips (${rank.high.value.toFixed(0)}). ${rank.low.prn} has the fewest (${rank.low.value.toFixed(0)}).`,
            "These are detection flags from the TEC time series, not a receiver slip counter. A slip breaks carrier-phase continuity and can bias TEC until the arc is re-levelled.",
          ]
        : ["No cycle-slip counts are available for the selected satellites."],
    };
  }, [disturbanceRows]);

  const pppAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const rank = rankMetric(disturbanceRows, (row) => row.ppp_convergence_min);
    return {
      lead: "Each bar is an estimate of how many minutes precise point positioning would need to converge on that PRN. It is not a measured PPP solution.",
      bullets: rank
        ? [
            `The estimate runs from ${rank.low.value.toFixed(0)} min on ${rank.low.prn} to ${rank.high.value.toFixed(0)} min on ${rank.high.prn}. The mean is ${rank.mean.toFixed(0)} min.`,
            "The estimate starts near 18 minutes and increases with ROTI, S4, noisy carrier-to-noise, poor arc quality, and inferred cycle slips.",
          ]
        : ["No PPP convergence estimate is available for the selected satellites."],
    };
  }, [disturbanceRows]);

  const rotiAnalysis = useMemo<ChartAnalysisBlock>(() => ({
    lead: "ROTI is the standard deviation of the rate of TEC change inside a 5-minute window, in TECU per minute. It shows how rough the ionosphere is along each satellite.",
    bullets: [
      "Quiet is below 0.2, mild is 0.2–0.5, moderate is 0.5–1.0, and strong is above 1.0 TECU/min.",
      "ROTI needs at least two TEC samples for that PRN inside the window. A rise shared by several PRNs is more likely ionospheric than a single-satellite tracking glitch.",
    ],
  }), []);

  const disturbanceLineAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const roti = rankMetric(disturbanceRows, (row) => row.max_roti);
    const error = rankMetric(disturbanceRows, (row) => row.position_error_cm);
    return {
      lead: "This compares three disturbance measures on one axis: maximum ROTI, S4 scintillation multiplied by 10 so it is visible, and an estimated position error in centimetres.",
      bullets: [
        roti
          ? `Largest ROTI is ${roti.high.value.toFixed(2)} TECU/min on ${roti.high.prn}.`
          : "No ROTI values are available.",
        error
          ? `Largest estimated position error is ${error.high.value.toFixed(1)} cm on ${error.high.prn}. That error is a proxy from ROTI, S4, signal noise, and slips. It is not a surveyed coordinate residual.`
          : "No position-error proxy is available.",
      ],
    };
  }, [disturbanceRows]);

  const qualityBarAnalysis = useMemo<ChartAnalysisBlock>(() => {
    const rank = rankMetric(qualRows, (row) => row.mean_qual);
    return {
      lead: "Each bar is the mean arc quality for that PRN, in percent. Live data uses carrier-to-noise. CMN data uses the file quality field when it is present.",
      bullets: rank
        ? [
            `${rank.high.prn} is highest at ${rank.high.value.toFixed(0)}%. ${rank.low.prn} is lowest at ${rank.low.value.toFixed(0)}%. The mean is ${rank.mean.toFixed(0)}%.`,
            `The slider below flags satellites under ${qualThreshold}%. A low-quality arc is more exposed to multipath and should carry less weight in a TEC average.`,
          ]
        : ["No arc-quality values are available for the selected satellites."],
    };
  }, [qualRows, qualThreshold]);

  const qualityLineAnalysis = useMemo<ChartAnalysisBlock>(() => ({
    lead: "Mean elevation and mean arc quality are drawn together so a poor-quality PRN can be compared with how high it sat in the sky.",
    bullets: [
      "Low elevation lengthens the path through the ionosphere and usually lowers signal quality. A satellite that is both low and poor quality is a weak TEC sample.",
      "The two series use the same vertical axis, so read elevation in degrees and quality in percent against that shared scale.",
    ],
  }), []);

  const vtecElevAnalysis = useMemo<ChartAnalysisBlock>(() => ({
    lead: "Mean vertical TEC is binned by satellite elevation. After the thin-shell mapping, VTEC should become flatter as elevation increases, because the slant-path stretch has been removed.",
    bullets: [
      "Bins are ±5° around the labelled elevation. A strong rise toward low elevation that remains after mapping can be residual mapping error, multipath, or a real horizontal gradient.",
      "Compare this with the slant TEC chart: STEC should still grow at low elevation, because that is the longer path.",
    ],
  }), []);

  const stecElevAnalysis = useMemo<ChartAnalysisBlock>(() => ({
    lead: "Mean slant TEC against elevation. STEC is the measurement along the line of sight, before it is mapped to vertical TEC.",
    bullets: [
      "Lower elevation means a longer path through the ionosphere, so STEC rises. That curve is the mapping-function shape.",
      "A PRN that breaks this pattern at high elevation is more likely a calibration or cycle-slip problem than a change in the vertical ionosphere.",
    ],
  }), []);

  return (
    <div className="page-stack">
      <div>
        <h1 className="page-title">🛸 Satellite PRN Explorer</h1>
        <p className="page-subtitle">
          GPS · Galileo · BeiDou · GLONASS — per-satellite TEC and geometry analysis
        </p>
      </div>

      <div style={{ fontSize: "0.8rem" }}>
        Click a constellation card for{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Chapter 4</span>{" "}
        explanation of satellites, VTEC, quality, and PRN range.
      </div>

      <div className="constellation-grid">
        {constellations.map((c: PrnConstellationInfo) => {
          const stats = constellationStats(data?.summary ?? [], c.id);
          const isActive = selected === c.id;
          return (
            <div
              key={c.id}
              onClick={() => setSelected(c.id)}
              style={{
                cursor: "pointer",
                textAlign: "center",
                background: "var(--surface)",
                border: `1px solid ${isActive ? c.color : "var(--border)"}`,
                borderRadius: "10px",
                padding: "1.1rem 0.8rem",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{c.icon}</div>
              <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.25rem" }}>{c.label}</div>
              <div style={{ fontWeight: 700, fontSize: "1.25rem", marginBottom: "0.35rem" }}>
                {stats.count > 0 ? `${stats.count} Satellites` : "—"}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                {stats.meanVtec != null ? `VTEC: ${stats.meanVtec.toFixed(1)} TECU` : "VTEC: N/A"}
                {stats.meanQual != null ? ` · Quality: ${stats.meanQual.toFixed(0)}%` : ""}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>PRN {c.prn_range}</div>
            </div>
          );
        })}
      </div>

      <PrnConstellationPanel info={selectedInfo} stats={cardStats} />

      <PrnFilters
        stations={meta?.stations ?? []}
        prns={activePrns}
        station={station}
        start={start}
        end={end}
        elevMin={elevMin}
        selectedPrns={selectedPrns}
        onStation={setStation}
        onStart={setStart}
        onEnd={setEnd}
        onElevMin={setElevMin}
        onSelectedPrns={setSelectedPrns}
        onRefresh={load}
        loading={loading}
      />

      {meta && (
        <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
          Data source: <strong>{sourceLabel}</strong>
          {meta.record_count ? ` · ${meta.record_count.toLocaleString()} observations` : ""}
          {meta.time_start && meta.time_end ? ` · ${meta.time_start.slice(0, 16)} → ${meta.time_end.slice(0, 16)} UTC` : ""}
          {theory?.quality_note && tab === "quality" ? ` · ${theory.quality_note}` : ""}
        </div>
      )}

      {error && <div className="banner banner-alert">{error}</div>}
      {loading && <div className="banner banner-info">Loading PRN data…</div>}
      {!loading && !hasData && (
        <div className="banner banner-info">
          {meta?.message ?? "No per-satellite PRN data for these filters. Run the live NTRIP pipeline, process RINEX/CMN in Processing, or set ZGIIS_CMN_SOURCE to a folder of .Cmn files."}
        </div>
      )}

      <div className="tabs">
        {([["vtec", "VTEC by PRN"], ["sky", "Sky Plot"], ["elev", "Elevation vs TEC"], ["quality", "Quality Analysis"], ["disturbance", "GNSS Disturbance"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "vtec" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ClickableGraph
            title={`VTEC Time Series by Satellite PRN — ${selected}`}
            open={openGraph === "vtec-series"}
            onToggle={() => toggleGraph("vtec-series")}
            analysis={vtecAnalysis}
          >
            {timeChart ? (
              <>
                <LineChart labels={timeChart.labels} datasets={timeChart.datasets} yLabel="VTEC (TECU)" height={340} toggleableLegend />
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  Real timestamps (UTC). Showing up to {chartPrns.length} PRN{chartPrns.length === 1 ? "" : "s"} for {selected}.
                </div>
              </>
            ) : (
              <div className="banner banner-info">No time-series PRN data for {selected}. Adjust filters or load per-PRN CMN/live data.</div>
            )}
          </ClickableGraph>

          <div className="card" style={{ overflowX: "auto" }}>
            {summary.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>#</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>constellation</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>prn</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_vtec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>max_vtec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_stec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_elev</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_qual</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>max_roti</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>slips</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>integrity</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>ppp_min</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>obs</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r, idx) => (
                    <tr key={`${r.prn}-${r.constellation}`} style={{ borderBottom: "1px solid #1a2a3a" }}>
                      <td style={{ padding: "0.35rem 0.7rem", color: "var(--text-muted)" }}>{idx + 1}</td>
                      <td style={{ padding: "0.35rem 0.7rem" }}>{r.constellation}</td>
                      <td style={{ padding: "0.35rem 0.7rem", fontWeight: 700, color: "var(--accent)" }}>{r.prn}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_vtec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.max_vtec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_stec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_elevation?.toFixed(1) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_qual?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.max_roti?.toFixed(2) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.cycle_slip_count ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.integrity_score?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.ppp_convergence_min?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.samples ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="banner banner-info">No PRN summary rows for {selected}.</div>
            )}
          </div>
        </div>
      )}

      {tab === "sky" && !loading && (
        <ClickableGraph
          title={`Sky Plot — ${selected}`}
          open={openGraph === "sky"}
          onToggle={() => toggleGraph("sky")}
          analysis={skyAnalysis}
        >
          <PrnSkyPlot
            observations={observations}
            prns={chartPrns}
            title=""
          />
        </ClickableGraph>
      )}

      {tab === "elev" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ClickableGraph
            title={`Vertical TEC vs Elevation — ${selected}`}
            open={openGraph === "vtec-elev"}
            onToggle={() => toggleGraph("vtec-elev")}
            analysis={vtecElevAnalysis}
          >
            {elevDatasets.some((d) => d.data.some((v) => v != null && v > 0)) ? (
              <>
                <LineChart labels={elevBins.map((b) => `${b}°`)} datasets={elevDatasets} yLabel="Mean VTEC (TECU)" height={300} />
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  Elevation bins (±5°). After thin-shell mapping, VTEC should flatten at high elevation.
                </div>
              </>
            ) : (
              <div className="banner banner-info">No elevation data for {selected}. Process RINEX/CMN with navigation or use the live pipeline.</div>
            )}
          </ClickableGraph>
          {stecElevDatasets.some((d) => d.data.some((v) => v != null && v > 0)) && (
            <ClickableGraph
              title="Slant TEC vs Elevation"
              open={openGraph === "stec-elev"}
              onToggle={() => toggleGraph("stec-elev")}
              analysis={stecElevAnalysis}
            >
              <LineChart labels={elevBins.map((b) => `${b}°`)} datasets={stecElevDatasets} yLabel="Mean STEC (TECU)" height={260} />
            </ClickableGraph>
          )}
        </div>
      )}

      {tab === "quality" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {qualRows.length > 0 ? (
            <>
              <ClickableGraph
                title={`Arc Quality by PRN — ${selected}`}
                open={openGraph === "arc-quality"}
                onToggle={() => toggleGraph("arc-quality")}
                analysis={qualityBarAnalysis}
              >
                <BarChart
                  labels={qualRows.map((r) => r.prn)}
                  values={qualRows.map((r) => r.mean_qual ?? 0)}
                  yLabel="Arc quality (%)"
                  color="#00ff88"
                  height={Math.max(280, qualRows.length * 22)}
                />
              </ClickableGraph>
              <div className="card">
                <label style={{ fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  Low-quality threshold: {qualThreshold}%
                  <input type="range" min={50} max={90} step={5} value={qualThreshold} onChange={(e) => setQualThreshold(Number(e.target.value))} />
                </label>
                {lowQual.length > 0 ? (
                  <div className="banner banner-warn" style={{ marginTop: "0.65rem" }}>
                    ⚠ {lowQual.length} satellite{lowQual.length === 1 ? "" : "s"} below {qualThreshold}% quality:{" "}
                    {lowQual.map((r) => r.prn).join(", ")}
                  </div>
                ) : (
                  <div className="banner banner-ok" style={{ marginTop: "0.65rem" }}>
                    ✓ All {selected} satellites above {qualThreshold}% quality threshold.
                  </div>
                )}
              </div>
              <ClickableGraph
                title={`Elevation and quality by PRN — ${selected}`}
                open={openGraph === "elev-quality"}
                onToggle={() => toggleGraph("elev-quality")}
                analysis={qualityLineAnalysis}
              >
                <LineChart
                  labels={qualRows.map((r) => r.prn)}
                  datasets={[
                    { label: "Mean elevation (°)", data: qualRows.map((r) => r.mean_elevation ?? 0), color: "#168bd2" },
                    { label: "Mean quality (%)", data: qualRows.map((r) => r.mean_qual ?? 0), color: "#00ff88" },
                  ]}
                  yLabel="Value"
                  height={280}
                />
              </ClickableGraph>
            </>
          ) : (
            <div className="banner banner-info">No quality metrics for {selected}. Quality is derived from CNR (live) or S4 (CMN) when available.</div>
          )}
        </div>
      )}

      {tab === "disturbance" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <ClickableGraph
            title={`ROTI Time Series — ${selected}`}
            open={openGraph === "roti"}
            onToggle={() => toggleGraph("roti")}
            analysis={rotiAnalysis}
          >
            {rotiChart ? (
              <LineChart labels={rotiChart.labels} datasets={rotiChart.datasets} yLabel="ROTI (TECU/min)" height={320} toggleableLegend />
            ) : (
              <div className="banner banner-info">ROTI needs at least two matched TEC observations per PRN inside a 5-minute window.</div>
            )}
          </ClickableGraph>

          {disturbanceRows.length > 0 ? (
            <>
              <ClickableGraph
                title="GNSS Integrity by PRN"
                open={openGraph === "integrity"}
                onToggle={() => toggleGraph("integrity")}
                analysis={integrityAnalysis}
              >
                <BarChart
                  labels={disturbanceRows.map((r) => r.prn)}
                  values={disturbanceRows.map((r) => r.integrity_score ?? 0)}
                  yLabel="Integrity score (%)"
                  color="#168bd2"
                  height={Math.max(280, disturbanceRows.length * 22)}
                />
              </ClickableGraph>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                <ClickableGraph
                  title="Inferred Cycle Slips"
                  open={openGraph === "slips"}
                  onToggle={() => toggleGraph("slips")}
                  analysis={slipAnalysis}
                >
                  <BarChart
                    labels={disturbanceRows.map((r) => r.prn)}
                    values={disturbanceRows.map((r) => r.cycle_slip_count ?? 0)}
                    yLabel="Events"
                    color="#ff8c00"
                    height={260}
                  />
                </ClickableGraph>
                <ClickableGraph
                  title="PPP Convergence Estimate"
                  open={openGraph === "ppp"}
                  onToggle={() => toggleGraph("ppp")}
                  analysis={pppAnalysis}
                >
                  <BarChart
                    labels={disturbanceRows.map((r) => r.prn)}
                    values={disturbanceRows.map((r) => r.ppp_convergence_min ?? 0)}
                    yLabel="Minutes"
                    color="#a78bfa"
                    height={260}
                  />
                </ClickableGraph>
              </div>

              <ClickableGraph
                title="Disturbance metrics by PRN"
                open={openGraph === "disturbance-lines"}
                onToggle={() => toggleGraph("disturbance-lines")}
                analysis={disturbanceLineAnalysis}
              >
                <LineChart
                  labels={disturbanceRows.map((r) => r.prn)}
                  datasets={[
                    { label: "Max ROTI", data: disturbanceRows.map((r) => r.max_roti ?? 0), color: "#ff4444" },
                    { label: "S4 / scintillation", data: disturbanceRows.map((r) => (r.max_s4 ?? 0) * 10), color: "#ffcc00" },
                    { label: "Position error (cm)", data: disturbanceRows.map((r) => r.position_error_cm ?? 0), color: "#00ff88" },
                  ]}
                  yLabel="Disturbance metrics"
                  height={280}
                />
              </ClickableGraph>
            </>
          ) : (
            <div className="banner banner-info">No disturbance metrics for {selected}. Load per-PRN live, CMN, or archive observations.</div>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
        © 2026 Zimbabwe National Geospatial and Space Agency (ZINGSA) — All rights reserved
      </div>
    </div>
  );
}
