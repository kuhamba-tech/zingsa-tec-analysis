"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Line, Scatter } from "react-chartjs-2";
import { getNorthSouthTecResearch, getStations } from "@/lib/api";
import { getLoadProfile } from "@/lib/loadBudget";
import type {
  NorthSouthTecResearchResponse,
  NorthSouthTecResearchStation,
  Station,
} from "@/lib/types";
import {
  aggregateByCatHour,
  comparisonToCsv,
  downloadText,
  linearRegression,
  normalizeStationCode,
  observationsToCsv,
  pairwiseLatitudinalGradient,
  stationStats,
  synchronizePairs,
  utcToCatHour,
  utcToCatLabel,
  ZIMBABWE_LAT_BANDS,
  type ResearchPoint,
} from "@/lib/northSouthTecResearch";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), {
  ssr: false,
  loading: () => (
    <div className="banner banner-info" role="status">
      Loading CORS map…
    </div>
  ),
});

type SubTab = "stations" | "diurnal" | "spatial" | "qc";

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 14 days", hours: 336 },
  { label: "Last 30 days", hours: 720 },
];

const AGG_OPTIONS = [1, 5, 15, 60] as const;
const SNAPSHOT_HOURS_CAT = [6, 12, 15, 21] as const;

const BAND_COLOR: Record<string, string> = {
  northern: "#2563eb",
  central: "#16a34a",
  southern: "#ea580c",
};

function fmt(v: number | null | undefined, digits = 2, unit = ""): string {
  if (v == null || !Number.isFinite(v)) return "No valid observations";
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "0.7rem 0.85rem",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div className="metric-label" style={{ margin: 0, fontSize: "0.72rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--text)" }}>
        {value}
      </div>
      {hint ? (
        <div className="sw-supporting-text" style={{ margin: 0, fontSize: "0.7rem" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>{title}</div>
        {subtitle ? (
          <p className="sw-supporting-text" style={{ margin: 0 }}>{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function chartAxis() {
  return {
    x: {
      title: { display: true, text: "", color: "#ffffff" },
      ticks: { color: "#ffffff" },
      grid: { color: "rgba(148,163,184,0.28)" },
    },
    y: {
      title: { display: true, text: "VTEC (TECU)", color: "#ffffff" },
      ticks: { color: "#ffffff" },
      grid: { color: "rgba(148,163,184,0.28)" },
    },
  };
}

export default function NorthSouthTecResearchLab() {
  const [data, setData] = useState<NorthSouthTecResearchResponse | null>(null);
  const [catalogStations, setCatalogStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [aggMin, setAggMin] = useState<number>(15);
  const [subTab, setSubTab] = useState<SubTab>("stations");
  const [selected, setSelected] = useState<string[]>([]);
  const [diurnalMode, setDiurnalMode] = useState<"individual" | "regional">("regional");
  const [snapshotHour, setSnapshotHour] = useState<number>(12);
  const [latMode, setLatMode] = useState<"geographical" | "geomagnetic">("geographical");
  const [northId, setNorthId] = useState<string>("");
  const [southId, setSouthId] = useState<string>("");
  const [hiddenCurves, setHiddenCurves] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    const profile = getLoadProfile();
    const resample = Math.max(aggMin, hours > 48 ? 15 : aggMin);
    // Always warm the CORS catalog so the map is populated even before research series arrives.
    getStations(false)
      .then((rows) => setCatalogStations(Array.isArray(rows) ? rows : []))
      .catch(() => {/* keep prior catalog */});
    getNorthSouthTecResearch(
      hours,
      resample,
      profile.constrained ? 60_000 : 90_000,
    )
      .then((payload) => {
        setData(payload);
        setError(null);
        setSelected((prev) => {
          if (prev.length) return prev;
          const sug = payload.suggested_transect ?? [];
          return sug.length ? sug : payload.stations
            .filter((s) => s.live_vtec_available)
            .slice(0, 5)
            .map((s) => s.station_id);
        });
        setNorthId((prev) => {
          if (prev) return prev;
          const sug = payload.suggested_transect ?? [];
          return sug[0] ?? "";
        });
        setSouthId((prev) => {
          if (prev) return prev;
          const sug = payload.suggested_transect ?? [];
          return sug[sug.length - 1] ?? "";
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "North–South TEC research unavailable");
      })
      .finally(() => setLoading(false));
  }, [hours, aggMin]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 180_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Prefetch full CORS inventory immediately so the map is never empty while research series loads.
  useEffect(() => {
    let cancelled = false;
    getStations(false)
      .then((rows) => {
        if (!cancelled && Array.isArray(rows) && rows.length) setCatalogStations(rows);
      })
      .catch(() => {/* keep empty until load() retries */});
    return () => {
      cancelled = true;
    };
  }, []);

  const stations = data?.stations ?? [];
  const seriesMap = useMemo(() => {
    const out: Record<string, ResearchPoint[]> = {};
    if (!data?.series) return out;
    for (const [code, block] of Object.entries(data.series)) {
      out[normalizeStationCode(code)] = (block.points ?? []).map((p) => ({
        timestamp_utc: p.timestamp_utc,
        vtec_tecu: p.vtec_tecu,
        quality_flag: p.quality_flag,
        obs_count: p.obs_count,
      }));
    }
    return out;
  }, [data]);

  const selectedStations = useMemo(
    () => stations.filter((s) => selected.includes(s.station_id)),
    [stations, selected],
  );

  const mapStations: Station[] = useMemo(() => {
    const byCode = new Map<string, Station>();

    // Full ZINGSA CORS inventory first — map must show every site even before VTEC arrives.
    for (const s of catalogStations) {
      const code = normalizeStationCode(s.code);
      byCode.set(code, {
        ...s,
        code,
        current_tec: s.current_tec,
      });
    }

    // Overlay research-archive coordinates + latest measured VTEC.
    for (const s of stations) {
      const code = normalizeStationCode(s.station_id);
      const prev = byCode.get(code);
      const hasLive = Boolean(s.live_vtec_available && s.latest_vtec_tecu != null && s.latest_vtec_tecu > 0);
      byCode.set(code, {
        code,
        name: s.name || prev?.name || code.toUpperCase(),
        lat: s.latitude,
        lon: s.longitude,
        status: hasLive ? "online" : (s.operational_status || prev?.status || "offline"),
        // Mark as live NTRIP so CorsMap applies measured VTEC colours (not grey placeholders).
        status_source: hasLive ? "ntrip" : prev?.status_source ?? "catalog",
        ntrip_verdict: hasLive ? "msm_streaming" : prev?.ntrip_verdict ?? null,
        constellations: prev?.constellations?.length ? prev.constellations : ["GPS"],
        current_tec: hasLive ? s.latest_vtec_tecu : prev?.current_tec ?? null,
        height_m: s.altitude_m ?? prev?.height_m ?? null,
      });
    }

    // Catalog + research overlay is enough; never invent coordinates.
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [catalogStations, stations]);

  const mapLiveCount = mapStations.filter(
    (s) => s.current_tec != null && Number(s.current_tec) > 0,
  ).length;

  const toggleStation = (code: string) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const selectBand = (band: string) => {
    const codes = stations.filter((s) => s.lat_band === band).map((s) => s.station_id);
    setSelected((prev) => Array.from(new Set([...prev, ...codes])));
  };

  const applyTransect = () => {
    if (data?.suggested_transect?.length) {
      setSelected(data.suggested_transect);
      setNorthId(data.suggested_transect[0]);
      setSouthId(data.suggested_transect[data.suggested_transect.length - 1]);
    }
  };

  const applyCustomRange = () => {
    if (!customFrom || !customTo) return;
    const a = Date.parse(customFrom);
    const b = Date.parse(customTo);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
    const h = Math.min(720, Math.max(1, (b - a) / 3600_000));
    setHours(Math.ceil(h));
  };

  // ── Derived summary from selection ──
  const selectionSummary = useMemo(() => {
    const byBand: Record<string, number[]> = { northern: [], central: [], southern: [] };
    for (const st of selectedStations) {
      const pts = seriesMap[st.station_id] ?? [];
      const vals = pts.map((p) => p.vtec_tecu).filter((v) => v > 0);
      if (!vals.length) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      byBand[st.lat_band]?.push(mean);
    }
    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const n = mean(byBand.northern);
    const c = mean(byBand.central);
    const s = mean(byBand.southern);
    let grad: number | null = null;
    const nSt = selectedStations.find((x) => x.station_id === northId);
    const sSt = selectedStations.find((x) => x.station_id === southId)
      ?? stations.find((x) => x.station_id === southId);
    const nSt2 = nSt ?? stations.find((x) => x.station_id === northId);
    if (
      nSt2?.latest_vtec_tecu != null &&
      sSt?.latest_vtec_tecu != null
    ) {
      grad = pairwiseLatitudinalGradient(
        nSt2.latest_vtec_tecu,
        sSt.latest_vtec_tecu,
        nSt2.latitude,
        sSt.latitude,
      );
    }
    const active = selectedStations.filter((st) => (seriesMap[st.station_id] ?? []).length > 0).length;
    const comps = selectedStations
      .map((st) => st.quality?.completeness_pct)
      .filter((v): v is number => v != null);
    return {
      northern: n,
      central: c,
      southern: s,
      diff: n != null && s != null ? n - s : null,
      gradient: grad,
      active,
      completeness: comps.length
        ? comps.reduce((a, b) => a + b, 0) / comps.length
        : null,
    };
  }, [selectedStations, seriesMap, northId, southId, stations]);

  // ── Diurnal chart ──
  const diurnalChart = useMemo(() => {
    if (!selectedStations.length) return null;
    const axes = chartAxis();
    axes.x.title.text = "Local time (CAT, UTC+2)";
    if (diurnalMode === "regional") {
      const bandSeries: Record<string, { x: number; y: number | null }[]> = {
        northern: [],
        central: [],
        southern: [],
      };
      for (const band of ZIMBABWE_LAT_BANDS) {
        const members = selectedStations.filter((s) => s.lat_band === band.id);
        const allPts: ResearchPoint[] = [];
        for (const m of members) allPts.push(...(seriesMap[m.station_id] ?? []));
        const agg = aggregateByCatHour(allPts, aggMin);
        bandSeries[band.id] = agg.map((a) => ({ x: a.catHour, y: a.mean }));
      }
      return {
        data: {
          datasets: ZIMBABWE_LAT_BANDS.filter((b) => !hiddenCurves.has(b.id)).map((b) => ({
            label: `${b.label}${selectedStations.filter((s) => s.lat_band === b.id).length ? ` (n=${selectedStations.filter((s) => s.lat_band === b.id).length})` : ""}`,
            data: bandSeries[b.id],
            borderColor: b.color,
            backgroundColor: b.color,
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.2,
            spanGaps: false,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false as const,
          plugins: {
            legend: { labels: { color: "#ffffff" } },
            tooltip: {
              callbacks: {
                label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
                  `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : "—"} TECU`,
              },
            },
          },
          scales: {
            x: { ...axes.x, type: "linear" as const, min: 0, max: 24 },
            y: axes.y,
          },
        },
      };
    }
    const palette = [
      "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#db2777",
      "#0891b2", "#ca8a04", "#dc2626", "#4f46e5",
    ];
    return {
      data: {
        datasets: selectedStations
          .filter((s) => !hiddenCurves.has(s.station_id))
          .map((s, i) => {
            const agg = aggregateByCatHour(seriesMap[s.station_id] ?? [], aggMin);
            return {
              label: `${s.station_id.toUpperCase()} (${s.lat_band})`,
              data: agg.map((a) => ({ x: a.catHour, y: a.mean })),
              borderColor: palette[i % palette.length],
              backgroundColor: palette[i % palette.length],
              borderWidth: 1.8,
              pointRadius: 2,
              tension: 0.2,
              spanGaps: false,
            };
          }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        plugins: { legend: { labels: { color: "#ffffff" } } },
        scales: {
          x: { ...axes.x, type: "linear" as const, min: 0, max: 24 },
          y: axes.y,
        },
      },
    };
  }, [selectedStations, seriesMap, diurnalMode, aggMin, hiddenCurves]);

  // ── Latitude scatter ──
  const latScatter = useMemo(() => {
    if (latMode === "geomagnetic") {
      return { unavailable: true as const, reason: data?.coordinate_model?.geomagnetic_note ?? "Geomagnetic latitude unavailable." };
    }
    const pts: { x: number; y: number; label: string }[] = [];
    for (const st of selectedStations) {
      const series = seriesMap[st.station_id] ?? [];
      const near = series.filter((p) => {
        const h = utcToCatHour(p.timestamp_utc);
        if (h == null) return false;
        let d = Math.abs(h - snapshotHour);
        if (d > 12) d = 24 - d;
        return d <= 0.5;
      });
      if (!near.length) continue;
      const mean = near.reduce((a, b) => a + b.vtec_tecu, 0) / near.length;
      pts.push({ x: st.latitude, y: mean, label: st.station_id.toUpperCase() });
    }
    const reg = linearRegression(
      pts.map((p) => p.x),
      pts.map((p) => p.y),
    );
    const lons = selectedStations.map((s) => s.longitude);
    const lonSpan = lons.length ? Math.max(...lons) - Math.min(...lons) : 0;
    return { unavailable: false as const, pts, reg, lonSpan };
  }, [selectedStations, seriesMap, snapshotHour, latMode, data]);

  // ── N–S difference & gradient ──
  const nsPair = useMemo(() => {
    const nSt = stations.find((s) => s.station_id === northId);
    const sSt = stations.find((s) => s.station_id === southId);
    if (!nSt || !sSt) return null;
    const pairs = synchronizePairs(
      seriesMap[northId] ?? [],
      seriesMap[southId] ?? [],
      data?.sync_tolerance_s ?? 900,
    ).map((p) => ({
      ...p,
      gradient: pairwiseLatitudinalGradient(
        p.vtec_north,
        p.vtec_south,
        nSt.latitude,
        sSt.latitude,
      ),
    }));
    if (!pairs.length) {
      return { nSt, sSt, pairs, stats: null };
    }
    const deltas = pairs.map((p) => p.delta_vtec);
    const grads = pairs.map((p) => p.gradient).filter((g): g is number => g != null);
    const pos = deltas.filter((d) => d > 0).length;
    const neg = deltas.filter((d) => d < 0).length;
    const absMax = Math.max(...deltas.map(Math.abs));
    const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    let maxAbsGrad: number | null = null;
    let timeMaxAbs: string | null = null;
    for (const p of pairs) {
      if (p.gradient == null) continue;
      if (maxAbsGrad == null || Math.abs(p.gradient) > Math.abs(maxAbsGrad)) {
        maxAbsGrad = p.gradient;
        timeMaxAbs = p.timestamp_utc_north;
      }
    }
    return {
      nSt,
      sSt,
      pairs,
      stats: {
        meanDelta,
        absMax,
        pctPositive: (100 * pos) / deltas.length,
        pctNegative: (100 * neg) / deltas.length,
        meanGrad: grads.length ? grads.reduce((a, b) => a + b, 0) / grads.length : null,
        maxPosGrad: grads.length ? Math.max(...grads) : null,
        maxNegGrad: grads.length ? Math.min(...grads) : null,
        maxAbsGrad,
        timeMaxAbs,
        n: pairs.length,
      },
    };
  }, [stations, northId, southId, seriesMap, data]);

  // Multi-station regression gradient at snapshot
  const multiGrad = useMemo(() => {
    if (latScatter.unavailable) return null;
    if (latScatter.pts.length < 3) return null;
    return latScatter.reg;
  }, [latScatter]);

  // Heatmap matrix
  const heatmap = useMemo(() => {
    const rows = selectedStations
      .slice()
      .sort((a, b) => b.latitude - a.latitude);
    if (!rows.length) return null;
    const hoursCats = Array.from({ length: 24 }, (_, i) => i);
    const matrix: (number | null)[][] = rows.map((st) => {
      const agg = aggregateByCatHour(seriesMap[st.station_id] ?? [], 60);
      return hoursCats.map((h) => {
        const hit = agg.find((a) => Math.floor(a.catHour) === h);
        return hit ? hit.mean : null;
      });
    });
    const vals = matrix.flat().filter((v): v is number => v != null);
    const vmin = vals.length ? Math.min(...vals) : 0;
    const vmax = vals.length ? Math.max(...vals) : 1;
    return { rows, hoursCats, matrix, vmin, vmax };
  }, [selectedStations, seriesMap]);

  const heatColor = (v: number | null, vmin: number, vmax: number) => {
    if (v == null) return "rgba(148,163,184,0.15)";
    const t = vmax > vmin ? (v - vmin) / (vmax - vmin) : 0;
    // Sequential viridis-like: dark blue → cyan → yellow
    const r = Math.round(30 + t * 220);
    const g = Math.round(40 + t * 180);
    const b = Math.round(120 - t * 80);
    return `rgb(${r},${g},${b})`;
  };

  const exportSummaryReport = () => {
    if (!data) return;
    const lines = [
      data.title,
      `Generated: ${data.generated_at}`,
      `Observation period: last ${data.hours_requested} h (resample ${data.resample_minutes} min)`,
      `Data source: ${data.data_source}`,
      `Processing: ${data.vtec_method}`,
      `Processing version: ${data.processing_version}`,
      "",
      "Selected stations:",
      ...selectedStations.map(
        (s) =>
          `  ${s.station_id.toUpperCase()} ${s.name} lat=${s.latitude.toFixed(4)} lon=${s.longitude.toFixed(4)} band=${s.lat_band} n=${s.observation_count}`,
      ),
      "",
      "Summary (selected period means):",
      `  Northern mean VTEC: ${fmt(selectionSummary.northern, 2, "TECU")}`,
      `  Central mean VTEC: ${fmt(selectionSummary.central, 2, "TECU")}`,
      `  Southern mean VTEC: ${fmt(selectionSummary.southern, 2, "TECU")}`,
      `  North–south difference: ${fmt(selectionSummary.diff, 2, "TECU")}`,
      `  Pairwise gradient: ${fmt(selectionSummary.gradient, 3, "TECU/°")}`,
      "",
      "Quality-control settings:",
      "  Elevation cutoff: applied upstream in live GOPI pipeline (elev ≥ 30°) when satellite elevation is available.",
      "  Negative / non-finite VTEC rejected; abrupt jumps flagged, not auto-removed.",
      "  Missing bins are not interpolated.",
      "",
      "Geomagnetic coordinates:",
      `  Status: ${data.coordinate_model.geomagnetic_status}`,
      `  Note: ${data.coordinate_model.geomagnetic_note}`,
      "",
      "Independent validation:",
      `  ${data.validation.message}`,
      "",
      "Scientific limitations:",
      ...data.scientific_limitations.map((l) => `  - ${l}`),
      "",
      data.archive.message ? `Archive note: ${data.archive.message}` : "",
    ];
    downloadText(
      `zingsa-ns-tec-research-summary-${Date.now()}.txt`,
      lines.filter(Boolean).join("\n"),
      "text/plain",
    );
  };

  const exportFigurePng = (canvasId: string, filename: string) => {
    const el = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!el) return;
    const a = document.createElement("a");
    a.href = el.toDataURL("image/png");
    a.download = filename;
    a.click();
  };

  const subTabs: { id: SubTab; label: string }[] = [
    { id: "stations", label: "Stations & map" },
    { id: "diurnal", label: "Diurnal TEC" },
    { id: "spatial", label: "Latitude & gradient" },
    { id: "qc", label: "QC, stats & export" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <header className="card" style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text)" }}>
          Zimbabwe Ionospheric TEC: North–South Spatial Analysis
        </h2>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Investigating spatial and diurnal variations of ionospheric Total Electron Content
          across Zimbabwe using the ZINGSA CORS network.
        </p>
        <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
          Live CORS observations
          {data ? ` · Last ${data.hours_requested} h · Resample ${data.resample_minutes} min` : ""}
          {data?.summary.latest_observation_utc
            ? ` · Last updated ${utcToCatLabel(data.summary.latest_observation_utc)}`
            : ""}
        </p>
      </header>

      {/* Controls */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem", alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem" }}>
          Time range
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{ minHeight: 34, padding: "0.25rem 0.45rem" }}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>{o.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem" }}>
          Custom from (UTC)
          <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ minHeight: 34 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem" }}>
          Custom to (UTC)
          <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ minHeight: 34 }} />
        </label>
        <button type="button" className="btn" onClick={applyCustomRange}>Apply custom</button>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem" }}>
          Aggregation (min)
          <select
            value={aggMin}
            onChange={(e) => setAggMin(Number(e.target.value))}
            style={{ minHeight: 34, padding: "0.25rem 0.45rem" }}
          >
            {AGG_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {loading && !data && (
        <div className="banner banner-info" role="status">Loading North–South TEC research observations…</div>
      )}
      {data?.archive.message && (
        <div className="banner banner-info">{data.archive.message}</div>
      )}
      {!loading && data && !data.archive.historical_available && (
        <div className="banner banner-info">
          Historical observations are not yet available for this period.
        </div>
      )}

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.55rem",
        }}
      >
        <SummaryCard label="Northern mean VTEC" value={fmt(selectionSummary.northern, 2, "TECU")} hint="Selected stations · period mean" />
        <SummaryCard label="Central mean VTEC" value={fmt(selectionSummary.central, 2, "TECU")} />
        <SummaryCard label="Southern mean VTEC" value={fmt(selectionSummary.southern, 2, "TECU")} />
        <SummaryCard label="North–south ΔVTEC" value={fmt(selectionSummary.diff, 2, "TECU")} hint="Northern − southern means" />
        <SummaryCard label="Latitudinal gradient" value={fmt(selectionSummary.gradient, 3, "TECU/°")} hint="Pairwise N–S pair" />
        <SummaryCard label="Active stations" value={String(selectionSummary.active)} hint={`of ${selected.length} selected`} />
        <SummaryCard label="Completeness" value={fmt(selectionSummary.completeness, 1, "%")} />
        <SummaryCard
          label="Latest observation"
          value={
            data?.summary.latest_observation_utc
              ? utcToCatLabel(data.summary.latest_observation_utc)
              : "No valid observations"
          }
        />
      </div>

      {/* Subtabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }} role="tablist">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={subTab === t.id}
            className="btn"
            onClick={() => setSubTab(t.id)}
            style={{
              opacity: subTab === t.id ? 1 : 0.72,
              outline: subTab === t.id ? "2px solid var(--accent, #2563eb)" : undefined,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "stations" && (
        <>
          <Section
            title="North–South Ionospheric TEC Analysis — CORS selection"
            subtitle="Select individual stations, latitudinal groups, or the suggested transect. Grouping uses actual station latitudes."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <button type="button" className="btn" onClick={applyTransect} disabled={!data?.suggested_transect?.length}>
                Apply suggested N–S transect
              </button>
              {ZIMBABWE_LAT_BANDS.map((b) => (
                <button key={b.id} type="button" className="btn" onClick={() => selectBand(b.id)} style={{ borderColor: b.color }} disabled={!stations.length}>
                  Select {b.label}
                </button>
              ))}
              <button type="button" className="btn" onClick={() => setSelected([])}>Clear</button>
            </div>
            <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
              Suggested transect: {(data?.suggested_transect || []).map((c) => c.toUpperCase()).join(" → ") || (loading ? "loading…" : "insufficient stations")}
              {data ? ` · Grouping: ${String(data.grouping.method)} (N≥${Number(data.grouping.northern_min_lat).toFixed(2)}°, C≥${Number(data.grouping.central_min_lat).toFixed(2)}°)` : ""}
              {selected.length < 3 ? " · At least three stations recommended for a spatial comparison." : ""}
            </p>
            {stations.length === 0 ? (
              <div className="banner banner-info" role="status">
                {loading ? "Loading CORS station table…" : "CORS research metadata unavailable — map still uses the network catalog when loaded."}
              </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr>
                    {["", "ID", "Name", "Lat", "Lon", "Alt (m)", "Band", "Status", "Latest VTEC", "Last obs", "n"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid rgba(148,163,184,0.35)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s: NorthSouthTecResearchStation) => (
                    <tr key={s.station_id} style={{ background: selected.includes(s.station_id) ? "rgba(37,99,235,0.08)" : undefined }}>
                      <td style={{ padding: "0.3rem" }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(s.station_id)}
                          onChange={() => toggleStation(s.station_id)}
                          aria-label={`Select ${s.station_id}`}
                        />
                      </td>
                      <td style={{ padding: "0.3rem", color: BAND_COLOR[s.lat_band] || "inherit", fontWeight: 600 }}>
                        {s.station_id.toUpperCase()}
                      </td>
                      <td style={{ padding: "0.3rem" }}>{s.name}</td>
                      <td style={{ padding: "0.3rem" }}>{s.latitude.toFixed(3)}°</td>
                      <td style={{ padding: "0.3rem" }}>{s.longitude.toFixed(3)}°</td>
                      <td style={{ padding: "0.3rem" }}>{s.altitude_m != null ? s.altitude_m.toFixed(0) : "—"}</td>
                      <td style={{ padding: "0.3rem" }}>{s.lat_band}</td>
                      <td style={{ padding: "0.3rem" }}>{s.live_vtec_available ? "live VTEC" : s.operational_status}</td>
                      <td style={{ padding: "0.3rem" }}>{s.latest_vtec_tecu != null ? `${s.latest_vtec_tecu.toFixed(2)} TECU` : "—"}</td>
                      <td style={{ padding: "0.3rem" }}>{s.latest_observation_utc ? utcToCatLabel(s.latest_observation_utc) : "missing"}</td>
                      <td style={{ padding: "0.3rem" }}>{s.observation_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </Section>

          <Section
            title="Interactive Zimbabwe CORS map"
            subtitle={`${mapStations.length} CORS sites on the map · ${mapLiveCount} with live measured VTEC (coloured). Click a marker to toggle selection.`}
          >
            {mapStations.length === 0 ? (
              <div className="banner banner-info" role="status">
                Loading ZINGSA CORS station inventory onto the map…
              </div>
            ) : (
              <div style={{ minHeight: 360 }}>
                <CorsMap
                  stations={mapStations}
                  height={380}
                  highlightCode={selected[selected.length - 1] ?? null}
                  onStationSelect={(st) => {
                    if (!st) return;
                    toggleStation(normalizeStationCode(st.code));
                  }}
                />
              </div>
            )}
            <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.72rem" }}>
              Marker colours use the live CORS VTEC palette when a station has a current measured value.
              Grey markers are sites without a live VTEC sample in this window (still selectable).
            </p>
          </Section>
        </>
      )}

      {subTab === "diurnal" && (
        <Section
          title="Diurnal Variation of VTEC Across Zimbabwe"
          subtitle="Measured live CORS VTEC. Times shown in CAT (UTC+2). Missing bins are not interpolated."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
            <button type="button" className="btn" onClick={() => setDiurnalMode("regional")} style={{ opacity: diurnalMode === "regional" ? 1 : 0.7 }}>
              Regional comparison
            </button>
            <button type="button" className="btn" onClick={() => setDiurnalMode("individual")} style={{ opacity: diurnalMode === "individual" ? 1 : 0.7 }}>
              Individual stations
            </button>
            {(diurnalMode === "regional" ? ZIMBABWE_LAT_BANDS.map((b) => b.id) : selected).map((id) => (
              <label key={id} style={{ fontSize: "0.75rem", display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!hiddenCurves.has(id)}
                  onChange={() => {
                    setHiddenCurves((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                />
                {id}
              </label>
            ))}
          </div>
          {!diurnalChart || !selectedStations.length ? (
            <div className="banner banner-info">Select stations with measured VTEC to plot diurnal curves.</div>
          ) : (
            <div style={{ background: "#0a1929", borderRadius: 8, height: 320, padding: "0.4rem" }}>
              <Line data={diurnalChart.data} options={diurnalChart.options} />
            </div>
          )}
          {selectedStations.length > 0 && (
            <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
              Period stats (selected):{" "}
              {selectedStations.map((s) => {
                const st = stationStats(seriesMap[s.station_id] ?? []);
                return `${s.station_id.toUpperCase()} mean=${fmt(st.mean, 1)} max=${fmt(st.max, 1)} @ ${st.timeOfMax ? utcToCatLabel(st.timeOfMax) : "—"}`;
              }).join(" · ")}
            </p>
          )}
        </Section>
      )}

      {subTab === "spatial" && (
        <>
          <Section
            title="Latitudinal Distribution of VTEC Across Zimbabwe"
            subtitle={`Snapshot near ${String(snapshotHour).padStart(2, "0")}:00 CAT (±30 min). Regression requires ≥2 valid stations.`}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
              {SNAPSHOT_HOURS_CAT.map((h) => (
                <button key={h} type="button" className="btn" onClick={() => setSnapshotHour(h)} style={{ opacity: snapshotHour === h ? 1 : 0.7 }}>
                  {String(h).padStart(2, "0")}:00 CAT
                </button>
              ))}
              <button type="button" className="btn" onClick={() => setLatMode("geographical")} style={{ opacity: latMode === "geographical" ? 1 : 0.7 }}>
                Geographical latitude
              </button>
              <button type="button" className="btn" onClick={() => setLatMode("geomagnetic")} style={{ opacity: latMode === "geomagnetic" ? 1 : 0.7 }}>
                Geomagnetic latitude
              </button>
            </div>
            {latScatter.unavailable ? (
              <div className="banner banner-info">{latScatter.reason}</div>
            ) : !latScatter.pts.length ? (
              <div className="banner banner-info">No synchronized observations near {snapshotHour}:00 CAT for the selected stations.</div>
            ) : (
              <>
                <div style={{ background: "#0a1929", borderRadius: 8, height: 300, padding: "0.4rem" }}>
                  <Scatter
                    data={{
                      datasets: [
                        {
                          label: "CORS stations",
                          data: latScatter.pts.map((p) => ({ x: p.x, y: p.y })),
                          backgroundColor: "#2563eb",
                          pointRadius: 5,
                        },
                        ...(latScatter.reg.slope != null && latScatter.pts.length >= 2
                          ? [{
                              label: "OLS regression",
                              data: (() => {
                                const xs = latScatter.pts.map((p) => p.x);
                                const x0 = Math.min(...xs);
                                const x1 = Math.max(...xs);
                                const s = latScatter.reg.slope!;
                                const b = latScatter.reg.intercept!;
                                return [
                                  { x: x0, y: b + s * x0 },
                                  { x: x1, y: b + s * x1 },
                                ];
                              })(),
                              showLine: true,
                              borderColor: "#dc2626",
                              backgroundColor: "#dc2626",
                              pointRadius: 0,
                              borderWidth: 2,
                            }]
                          : []),
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false as const,
                      plugins: {
                        legend: { labels: { color: "#ffffff" } },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => {
                              const p = latScatter.pts[ctx.dataIndex];
                              if (!p || ctx.datasetIndex !== 0) {
                                return `y=${ctx.parsed.y?.toFixed?.(2)}`;
                              }
                              return `${p.label}: lat ${p.x.toFixed(2)}°, ${p.y.toFixed(2)} TECU`;
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          title: { display: true, text: "Geographical latitude (°)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                        y: {
                          title: { display: true, text: "VTEC (TECU)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                      },
                    }}
                  />
                </div>
                <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
                  Slope={fmt(latScatter.reg.slope, 4, "TECU/°")} · intercept={fmt(latScatter.reg.intercept, 2)} ·
                  R²={fmt(latScatter.reg.rSquared, 3)} · n={latScatter.reg.n}
                  {latScatter.reg.stderrSlope != null ? ` · SE(slope)=${latScatter.reg.stderrSlope.toFixed(4)}` : ""}
                  {latScatter.lonSpan > 3
                    ? ` · Caution: longitude span ${latScatter.lonSpan.toFixed(1)}° — possible longitudinal confounding.`
                    : ""}
                  {latScatter.pts.length < 3
                    ? " · Fewer than three stations — spatial gradient is weakly constrained."
                    : ""}
                </p>
              </>
            )}
          </Section>

          <Section
            title="North–South TEC Difference"
            subtitle="ΔVTEC(t) = VTEC_North(t) − VTEC_South(t) using simultaneous observations only."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.45rem" }}>
              <label style={{ fontSize: "0.75rem" }}>
                Northern station{" "}
                <select value={northId} onChange={(e) => setNorthId(e.target.value)}>
                  {stations.map((s) => (
                    <option key={s.station_id} value={s.station_id}>
                      {s.station_id.toUpperCase()} ({s.latitude.toFixed(2)}°)
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: "0.75rem" }}>
                Southern station{" "}
                <select value={southId} onChange={(e) => setSouthId(e.target.value)}>
                  {stations.map((s) => (
                    <option key={s.station_id} value={s.station_id}>
                      {s.station_id.toUpperCase()} ({s.latitude.toFixed(2)}°)
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!nsPair?.pairs.length ? (
              <div className="banner banner-info">
                No simultaneous valid observations for this pair within the sync tolerance
                ({data?.sync_tolerance_s ?? 900}s).
              </div>
            ) : (
              <>
                <div style={{ background: "#0a1929", borderRadius: 8, height: 280, padding: "0.4rem" }}>
                  <Line
                    data={{
                      datasets: [
                        {
                          label: "ΔVTEC (N−S)",
                          data: nsPair.pairs.map((p) => ({
                            x: utcToCatHour(p.timestamp_utc_north) ?? 0,
                            y: p.delta_vtec,
                          })),
                          borderColor: "#7c3aed",
                          backgroundColor: "#7c3aed",
                          borderWidth: 2,
                          pointRadius: 2,
                          spanGaps: false,
                        },
                        {
                          label: "Zero reference",
                          data: [
                            { x: 0, y: 0 },
                            { x: 24, y: 0 },
                          ],
                          borderColor: "#94a3b8",
                          borderDash: [6, 4],
                          pointRadius: 0,
                          borderWidth: 1.5,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false as const,
                      plugins: { legend: { labels: { color: "#ffffff" } } },
                      scales: {
                        x: {
                          type: "linear",
                          min: 0,
                          max: 24,
                          title: { display: true, text: "Local time (CAT)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                        y: {
                          title: { display: true, text: "ΔVTEC (TECU)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                      },
                    }}
                  />
                </div>
                <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
                  Positive → northern higher VTEC · Negative → southern higher · Sync tolerance {data?.sync_tolerance_s ?? 900}s.
                  Mean Δ={fmt(nsPair.stats?.meanDelta, 2, "TECU")} · |Δ|max={fmt(nsPair.stats?.absMax, 2, "TECU")} ·
                  +ve {fmt(nsPair.stats?.pctPositive, 1, "%")} · −ve {fmt(nsPair.stats?.pctNegative, 1, "%")} ·
                  n={nsPair.stats?.n}
                </p>
              </>
            )}
          </Section>

          <Section
            title="Temporal Variation of the North–South TEC Gradient"
            subtitle="G_φ(t) = ΔVTEC / Δlatitude (TECU/degree). Pairwise vs multi-station regression are distinguished."
          >
            {!nsPair?.pairs.some((p) => p.gradient != null) ? (
              <div className="banner banner-info">
                Gradient unavailable — insufficient latitude separation or no synchronized pairs.
              </div>
            ) : (
              <>
                <div style={{ background: "#0a1929", borderRadius: 8, height: 260, padding: "0.4rem" }}>
                  <Line
                    data={{
                      datasets: [
                        {
                          label: "Pairwise G_φ (TECU/°)",
                          data: nsPair.pairs
                            .filter((p) => p.gradient != null)
                            .map((p) => ({
                              x: utcToCatHour(p.timestamp_utc_north) ?? 0,
                              y: p.gradient as number,
                            })),
                          borderColor: "#0ea5e9",
                          backgroundColor: "#0ea5e9",
                          borderWidth: 2,
                          pointRadius: 2,
                          spanGaps: false,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false as const,
                      plugins: { legend: { labels: { color: "#ffffff" } } },
                      scales: {
                        x: {
                          type: "linear",
                          min: 0,
                          max: 24,
                          title: { display: true, text: "Local time (CAT)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                        y: {
                          title: { display: true, text: "Gradient (TECU/°)", color: "#ffffff" },
                          ticks: { color: "#ffffff" },
                          grid: { color: "rgba(148,163,184,0.35)" },
                        },
                      },
                    }}
                  />
                </div>
                <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
                  Pairwise: mean={fmt(nsPair.stats?.meanGrad, 3)} · max+={fmt(nsPair.stats?.maxPosGrad, 3)} ·
                  max−={fmt(nsPair.stats?.maxNegGrad, 3)} · |G|max={fmt(nsPair.stats?.maxAbsGrad, 3)}
                  {nsPair.stats?.timeMaxAbs ? ` at ${utcToCatLabel(nsPair.stats.timeMaxAbs)}` : ""}
                  {multiGrad?.slope != null
                    ? ` · Multi-station regression β₁ at ${snapshotHour}:00 CAT = ${multiGrad.slope.toFixed(4)} TECU/° (n=${multiGrad.n}, R²=${fmt(multiGrad.rSquared, 3)})`
                    : " · Multi-station regression requires ≥3 geographically distributed stations at the snapshot time."}
                  {" · "}A positive gradient alone is not evidence of the equatorial ionization anomaly.
                </p>
              </>
            )}
          </Section>

          <Section
            title="Latitude–Time Distribution of VTEC"
            subtitle="Observed station values only — empty cells are missing data, not interpolated estimates."
          >
            {!heatmap ? (
              <div className="banner banner-info">Select stations to build the latitude–time heatmap.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `72px repeat(24, minmax(18px, 1fr))`, gap: 2, minWidth: 560 }}>
                  <div />
                  {heatmap.hoursCats.map((h) => (
                    <div key={h} style={{ fontSize: "0.6rem", textAlign: "center", color: "var(--text-muted)" }}>{h}</div>
                  ))}
                  {heatmap.rows.map((st, ri) => (
                    <div key={st.station_id} style={{ display: "contents" }}>
                      <div style={{ fontSize: "0.68rem", alignSelf: "center" }} title={`${st.name} ${st.latitude.toFixed(2)}°`}>
                        {st.station_id.toUpperCase()}
                      </div>
                      {heatmap.matrix[ri].map((v, ci) => (
                        <div
                          key={`${st.station_id}-${ci}`}
                          title={
                            v == null
                              ? `${st.station_id} ${ci}:00 CAT — missing`
                              : `${st.station_id} ${ci}:00 CAT — ${v.toFixed(2)} TECU`
                          }
                          style={{
                            height: 18,
                            background: heatColor(v, heatmap.vmin, heatmap.vmax),
                            borderRadius: 2,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <p className="sw-supporting-text" style={{ margin: "0.4rem 0 0", fontSize: "0.72rem" }}>
                  Colour scale: {heatmap.vmin.toFixed(1)} – {heatmap.vmax.toFixed(1)} TECU (sequential). Grey = missing.
                  Latitude axis uses geographical coordinates ({data?.coordinate_model.geomagnetic_status === "unavailable" ? "geomagnetic unavailable" : "geomagnetic optional"}).
                </p>
              </div>
            )}
          </Section>
        </>
      )}

      {subTab === "qc" && data && (
        <>
          <Section title="Data quality panel" subtitle="Target ≥90% completeness for full-day station comparisons. Questionable jumps are flagged, not auto-deleted.">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr>
                    {["Station", "Expected", "Valid", "Missing", "Completeness", "Latest", "QC status", "Flags"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid rgba(148,163,184,0.35)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(selectedStations.length ? selectedStations : stations).map((s) => (
                    <tr key={s.station_id}>
                      <td style={{ padding: "0.3rem" }}>{s.station_id.toUpperCase()}</td>
                      <td style={{ padding: "0.3rem" }}>{s.quality?.expected ?? "—"}</td>
                      <td style={{ padding: "0.3rem" }}>{s.quality?.valid ?? s.observation_count}</td>
                      <td style={{ padding: "0.3rem" }}>{s.quality?.missing ?? "—"}</td>
                      <td style={{ padding: "0.3rem" }}>{fmt(s.quality?.completeness_pct, 1, "%")}</td>
                      <td style={{ padding: "0.3rem" }}>{s.latest_observation_utc ? utcToCatLabel(s.latest_observation_utc) : "—"}</td>
                      <td style={{ padding: "0.3rem" }}>{s.quality?.status ?? "—"}</td>
                      <td style={{ padding: "0.3rem" }}>
                        neg={s.quality?.negative ?? 0}, abrupt={s.quality?.abrupt_discontinuities ?? 0}, invalid={s.quality?.invalid ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
              Elevation cutoff: live GOPI pipeline uses elev ≥ 30° when satellite elevation is present.
              This binned research series does not re-apply a satellite elevation filter client-side.
            </p>
          </Section>

          <Section title="VTEC Validation" subtitle="Comparison against independent ionospheric products (e.g. IGS GIM).">
            <div className="banner banner-info">{data.validation.message}</div>
          </Section>

          <Section title="Research statistics" subtitle="Single-station period statistics from measured bins. Multi-day means are preliminary — not climatology.">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr>
                    {["Station", "Mean", "Median", "Min", "Max", "Std", "Amplitude", "n"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid rgba(148,163,184,0.35)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedStations.map((s) => {
                    const st = s.statistics;
                    return (
                      <tr key={s.station_id}>
                        <td style={{ padding: "0.3rem" }}>{s.station_id.toUpperCase()}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.mean, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.median, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.min, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.max, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.std, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{fmt(st.amplitude, 2)}</td>
                        <td style={{ padding: "0.3rem" }}>{st.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nsPair?.stats && (
              <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
                Pair {northId.toUpperCase()}−{southId.toUpperCase()} mean daily ΔVTEC ≈ {fmt(nsPair.stats.meanDelta, 2, "TECU")}
                (synchronized samples; consecutive 1-min points are not treated as independent for confidence intervals).
              </p>
            )}
          </Section>

          <Section title="Research data export" subtitle="Exports identify observation period, data source and processing settings.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `zingsa-ns-station-obs-${Date.now()}.csv`,
                    observationsToCsv(stations, seriesMap, selected),
                  )
                }
              >
                Export station CSV
              </button>
              <button
                type="button"
                className="btn"
                disabled={!nsPair?.pairs.length}
                onClick={() => {
                  if (!nsPair) return;
                  downloadText(
                    `zingsa-ns-comparison-${Date.now()}.csv`,
                    comparisonToCsv(
                      nsPair.pairs,
                      northId,
                      southId,
                      nsPair.nSt.latitude,
                      nsPair.sSt.latitude,
                    ),
                  );
                }}
              >
                Export N–S comparison CSV
              </button>
              <button type="button" className="btn" onClick={exportSummaryReport}>
                Export research summary
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // Capture first chart canvas if present
                  const canvas = document.querySelector(".card canvas") as HTMLCanvasElement | null;
                  if (!canvas) {
                    alert("Open a chart subtab (Diurnal or Latitude) before exporting a figure.");
                    return;
                  }
                  exportFigurePng("", `zingsa-ns-figure-${Date.now()}.png`);
                  const a = document.createElement("a");
                  a.href = canvas.toDataURL("image/png");
                  a.download = `zingsa-ns-figure-${Date.now()}.png`;
                  a.click();
                }}
              >
                Export figure PNG
              </button>
            </div>
            <ul className="sw-supporting-text" style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", fontSize: "0.75rem" }}>
              {data.scientific_limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
              <li>{data.archive.retention_note}</li>
              <li>{data.coordinate_model.ipp_status}</li>
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
