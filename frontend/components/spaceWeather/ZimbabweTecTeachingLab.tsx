"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Scatter, Line } from "react-chartjs-2";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getLiveVtec, getLiveVtecByStation, getStations, getTecMethodComparison } from "@/lib/api";
import { formatKnmiUtcTick, sharedTimeDomain, utcTimeAxisProps } from "@/lib/chartTimeAxis";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import {
  diurnalPercentilesFullDay,
  flatLayerStec,
  hourOfDayUtc,
  ionosphericPiercePoint,
  IONO_SHELL_KM,
} from "@/lib/tecTeachingMath";
import type { LiveObservation, LiveStationVtecSeries, Station, TecMethodComparisonResponse } from "@/lib/types";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const STATION_COLORS = ["#38bdf8", "#fbbf24", "#a78bfa", "#34d399", "#f97316", "#f472b6", "#22d3ee", "#fb7185"];
const CONST_COLORS: Record<string, string> = {
  G: "#38bdf8",
  R: "#f97316",
  E: "#a78bfa",
  C: "#34d399",
  J: "#fbbf24",
};

/** Plasma-like colour stops (dark purple → magenta → orange → yellow). */
const PLASMA_STOPS: [number, number, number][] = [
  [13, 8, 135],
  [84, 2, 163],
  [139, 10, 165],
  [185, 50, 137],
  [219, 92, 104],
  [244, 136, 73],
  [254, 188, 43],
  [240, 249, 33],
];

function plasmaColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const n = PLASMA_STOPS.length - 1;
  const f = x * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const a = PLASMA_STOPS[i];
  const b = PLASMA_STOPS[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgb(${r},${g},${bl})`;
}

function vtecPlasma(vtec: number, vmin = 10, vmax = 35): string {
  const t = vmax === vmin ? 0.5 : (vtec - vmin) / (vmax - vmin);
  return plasmaColor(t);
}

function hourColor(hourUt: number): string {
  const t = Math.max(0, Math.min(1, hourUt / 24));
  // Cool midnight → warm noon → cool evening
  const hue = 220 - t * 160;
  const light = 38 + Math.sin(t * Math.PI) * 22;
  return `hsl(${hue}, 78%, ${light}%)`;
}

function startOfUtcDayMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isUtcCalendarDay(iso: string, dayStartMs: number): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  return ms >= dayStartMs && ms < dayStartMs + 24 * 3_600_000;
}

function utcDayLabel(dayStartMs: number): string {
  const d = new Date(dayStartMs);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} UTC`;
}

function hoursSinceUtcMidnight(now = Date.now()): number {
  return Math.min(24, Math.max(1, (now - startOfUtcDayMs(now)) / 3_600_000));
}

type GraphId = "vtec-series" | "elev-scatter" | "skyplot" | "ipp" | "diurnal";

const GRAPH_EXPLANATIONS: Record<GraphId, ChartAnalysisBlock> = {
  "vtec-series": {
    lead: "VTEC is the vertical total electron content above each Zimbabwe CORS station — the column density of free electrons in TECU (1 TECU = 10¹⁶ el/m²).",
    bullets: [
      "Each coloured trace is one live CORS station on a shared Universal Time (UT) axis.",
      "Quiet-day VTEC usually rises after sunrise, peaks near local noon–afternoon, and falls at night.",
      "Sudden jumps shared across stations can mark a flare, storm, or data gap — always check observation times and supporting solar/geomagnetic drivers.",
      "Typical quiet values: night ~1–10 TECU, day ~10–40 TECU; high solar activity can reach 50–100 TECU.",
    ],
  },
  "elev-scatter": {
    lead: "STEC is the slant TEC along the satellite–receiver ray; VTEC is the equivalent vertical column after thin-shell mapping.",
    bullets: [
      "Left panel: STEC versus elevation. Low elevations travel longer through the ionosphere, so STEC is larger for the same VTEC.",
      "The dashed curve is the flat-layer reference STEC ≈ VTEC / sin(E) — a simple teaching comparison, not the operational mapping used in the pipeline.",
      "Right panel: VTEC versus elevation. After mapping, VTEC should be much less elevation-dependent than STEC if the shell model is reasonable.",
      "Points below ~15° elevation are excluded because mapping uncertainty grows rapidly near the horizon.",
    ],
  },
  skyplot: {
    lead: "This skyplot shows each live satellite look direction: azimuth around the horizon, elevation from the rim (0°) to zenith at the centre (90°).",
    bullets: [
      "Colour is VTEC (plasma scale, typically 10–35 TECU here). Brighter/yellower points are higher VTEC along that pierce path.",
      "Curved arcs are satellite ground tracks across the sky over the sampling window — not fixed PRN labels.",
      "Clusters toward the rim are low-elevation satellites; points near the centre are near-overhead (high elevation).",
      "Use this with the IPP map: the same look angles place the ionospheric pierce points over Zimbabwe.",
    ],
  },
  ipp: {
    lead: "The ionospheric pierce point (IPP) is where the GNSS ray crosses a thin shell (here 350 km). Plotting IPPs shows which geographic regions each TEC sample represents.",
    bullets: [
      "Left panel colours each IPP by VTEC — spatial structure of electron content over and around Zimbabwe.",
      "Right panel colours the same IPPs by observation UT hour — how coverage moves through the day.",
      "IPP latitude/longitude come from receiver position plus elevation and azimuth (thin-shell geometry).",
      "Edge samples (low elevation) pierce farther from the station; zenith samples sit nearly above the receiver.",
    ],
  },
  diurnal: {
    lead: "Diurnal fan chart comparing GOPI / Seemala (cyan) and Gg / Ciraolo–Cesaroni (amber) on the same UTC day.",
    bullets: [
      "Cyan median + bands = GOPI live CORS VTEC. Amber median + bands = Gg arc-bias calibrated VTEC.",
      "Offsets between the two medians are calibration differences (DCB / arc bias), not a different ionosphere.",
      "Only the current UTC calendar day is shown, so the chart builds as the day progresses.",
      "Read the teaching guide below for STEC vs VTEC classification and the calculation steps that differ.",
    ],
  },
};

function Section({
  title,
  subtitle,
  open,
  onToggle,
  analysis,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  analysis: ChartAnalysisBlock;
  children: ReactNode;
}) {
  return (
    <section
      className="card"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${title}. Click for scientific explanation.`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        cursor: "pointer",
        borderColor: open ? "var(--accent)" : undefined,
        background: open ? "rgba(22, 139, 210, 0.08)" : undefined,
      }}
    >
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>{title}</div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>{subtitle}</p>
        <p className="sw-supporting-text" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
          {open ? "Click again to hide scientific explanation" : "Click for scientific explanation"}
        </p>
      </div>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
      {open && <ChartAnalysisBox block={analysis} title="Scientific interpretation" />}
    </section>
  );
}

export default function ZimbabweTecTeachingLab() {
  const [stations, setStations] = useState<LiveStationVtecSeries[]>([]);
  const [obs, setObs] = useState<LiveObservation[]>([]);
  const [catalog, setCatalog] = useState<Station[]>([]);
  const [methodCmp, setMethodCmp] = useState<TecMethodComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [openGraph, setOpenGraph] = useState<GraphId | null>(null);
  const toggleGraph = (id: GraphId) => setOpenGraph((cur) => (cur === id ? null : id));

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      const dayHours = Math.min(24, Math.ceil(hoursSinceUtcMidnight() * 2) / 2 + 0.5);

      // Apply each feed as it lands so the slow GOPI/Gg comparison cannot block
      // graphs 1–5 (diurnal used to stay empty until comparison finished).
      const stP = getLiveVtecByStation(dayHours, 10, 90_000).then((rows) => {
        if (!cancelled) setStations(Array.isArray(rows) ? rows : []);
        return rows;
      });
      const liveP = getLiveVtec(Math.min(6, dayHours), undefined, 45_000, 2500).then((rows) => {
        if (!cancelled) setObs(Array.isArray(rows) ? rows : []);
        return rows;
      });
      const catP = getStations(false).then((rows) => {
        if (!cancelled && Array.isArray(rows) && rows.length) setCatalog(rows);
        return rows;
      });
        // Shared params with TecMethodComparisonLab so both hit one cached API call.
        getTecMethodComparison(8, undefined, 1500, 45_000)
        .then((cmp) => {
          if (!cancelled) setMethodCmp(cmp);
        })
        .catch(() => {
          /* Comparison is optional for GOPI-only diurnal fallback. */
        });

      Promise.allSettled([stP, liveP, catP]).then(([st, live, cat]) => {
        if (cancelled) return;
        if (cat.status !== "fulfilled" || !Array.isArray(cat.value) || cat.value.length === 0) {
          getStations(false).then((rows) => {
            if (!cancelled && Array.isArray(rows) && rows.length) setCatalog(rows);
          }).catch(() => {});
        }
        const fails = [st, live].filter((r) => r.status === "rejected").length;
        setError(fails === 2 ? "Live CORS VTEC feeds unavailable right now." : null);
        setUpdatedAt(new Date().toISOString());
        setLoading(false);
      });
    };
    load();
    const unlock = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);
    // Keep the UTC-day chart live
    const refresh = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearTimeout(unlock);
      window.clearInterval(refresh);
    };
  }, []);

  const utcDayStart = useMemo(() => startOfUtcDayMs(), [updatedAt]);
  const utcDayTitle = useMemo(() => utcDayLabel(utcDayStart), [utcDayStart]);

  const stationSeries = useMemo(() => {
    return stations
      .filter((s) => s.points?.length)
      .slice(0, 8)
      .map((s, i) => {
        const epochs: number[] = [];
        const values: (number | null)[] = [];
        const labels: string[] = [];
        for (const p of s.points) {
          const ms = Date.parse(p.time);
          if (!Number.isFinite(ms)) continue;
          epochs.push(ms);
          values.push(p.vtec_tecu);
          labels.push(p.time);
        }
        return {
          station: s.station,
          color: STATION_COLORS[i % STATION_COLORS.length],
          epochs,
          values,
          labels,
          latest: s.latest_vtec,
          mean: s.mean_vtec,
        };
      });
  }, [stations]);

  const vtecTimeAxis = useMemo(() => {
    const domain = sharedTimeDomain(stationSeries.map((s) => s.epochs));
    if (!domain) return null;
    const rangeHours = Math.max(6, (domain.max - domain.min) / 3_600_000);
    return utcTimeAxisProps(domain, { rangeHours });
  }, [stationSeries]);

  const elevScatter = useMemo(() => {
    const stecByConst: Record<string, { x: number; y: number }[]> = {};
    const vtecByConst: Record<string, { x: number; y: number }[]> = {};
    const allVtec: number[] = [];
    for (const o of obs) {
      const el = o.elevation_deg;
      if (el == null || el < 15) continue;
      const key = (o.constellation || "?").charAt(0).toUpperCase();
      if (o.stec_tecu != null && Number.isFinite(o.stec_tecu)) {
        (stecByConst[key] ??= []).push({ x: el, y: o.stec_tecu });
      }
      if (o.vtec_tecu != null && Number.isFinite(o.vtec_tecu)) {
        (vtecByConst[key] ??= []).push({ x: el, y: o.vtec_tecu });
        allVtec.push(o.vtec_tecu);
      }
    }
    const downsample = (pts: { x: number; y: number }[]) => {
      const step = Math.max(1, Math.floor(pts.length / 800));
      return pts.filter((_, i) => i % step === 0);
    };
    const sorted = allVtec.slice().sort((a, b) => a - b);
    return {
      stecDatasets: Object.entries(stecByConst).map(([k, pts]) => ({
        label: `STEC ${k}`,
        data: downsample(pts),
        backgroundColor: CONST_COLORS[k] ?? "#94a3b8",
        pointRadius: 1.4,
      })),
      vtecDatasets: Object.entries(vtecByConst).map(([k, pts]) => ({
        label: `VTEC ${k}`,
        data: downsample(pts),
        backgroundColor: CONST_COLORS[k] ?? "#94a3b8",
        pointRadius: 1.4,
      })),
      stecCount: Object.values(stecByConst).reduce((n, a) => n + a.length, 0),
      medianVtec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  }, [obs]);

  const elRange = useMemo(() => Array.from({ length: 71 }, (_, i) => 20 + i), []);
  const flatRef = elevScatter.medianVtec != null
    ? elRange.map((el) => ({ x: el, y: flatLayerStec(elevScatter.medianVtec!, el) }))
    : [];

  const skyplotPoints = useMemo(() => {
    const pts: { az: number; el: number; vtec: number; key: string }[] = [];
    for (const o of obs) {
      const el = o.elevation_deg;
      const az = o.azimuth_deg;
      if (el == null || az == null || !Number.isFinite(el) || !Number.isFinite(az)) continue;
      if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
      if (el < 0 || el > 90) continue;
      pts.push({
        az,
        el,
        vtec: o.vtec_tecu,
        key: `${o.station}-${o.prn ?? "?"}-${o.time}`,
      });
    }
    const step = Math.max(1, Math.floor(pts.length / 1200));
    return pts.filter((_, i) => i % step === 0);
  }, [obs]);

  const ippTracks = useMemo(() => {
    const byCode = new Map<string, Station>();
    for (const s of catalog) {
      const code = s.code.toLowerCase().replace(/_+$/, "");
      byCode.set(code, s);
      byCode.set(s.code.toLowerCase(), s);
    }
    const pts: { lon: number; lat: number; vtec: number; hour: number }[] = [];
    for (const o of obs) {
      const el = o.elevation_deg;
      const az = o.azimuth_deg;
      if (el == null || az == null || !Number.isFinite(el) || !Number.isFinite(az)) continue;
      if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
      const key = o.station.toLowerCase().replace(/_+$/, "");
      const meta = byCode.get(key) ?? byCode.get(o.station.toLowerCase());
      if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lon)) continue;
      const ipp = ionosphericPiercePoint(meta.lat, meta.lon, el, az, IONO_SHELL_KM);
      if (!ipp) continue;
      const hour = hourOfDayUtc(o.time);
      if (hour == null) continue;
      pts.push({ lon: ipp.lon, lat: ipp.lat, vtec: o.vtec_tecu, hour });
    }
    const step = Math.max(1, Math.floor(pts.length / 1500));
    return pts.filter((_, i) => i % step === 0);
  }, [obs, catalog]);

  const diurnalLive = useMemo(() => {
    const dayStart = utcDayStart;

    const collectHoursVals = (rows: LiveObservation[]) => {
      const hoursArr: number[] = [];
      const vals: number[] = [];
      for (const o of rows) {
        if (!isUtcCalendarDay(o.time, dayStart)) continue;
        if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
        const h = hourOfDayUtc(o.time);
        if (h == null) continue;
        hoursArr.push(h);
        vals.push(o.vtec_tecu);
      }
      return { hoursArr, vals };
    };

    // Prefer dual-method comparison samples when available.
    const gopiCmp = collectHoursVals(methodCmp?.gopi ?? []);
    const ggCmp = collectHoursVals(methodCmp?.gg ?? []);

    // Fallback GOPI from live CORS station series + observations.
    let gopiHours = gopiCmp.hoursArr;
    let gopiVals = gopiCmp.vals;
    if (gopiHours.length < 8) {
      const hoursArr: number[] = [];
      const vals: number[] = [];
      for (const s of stations) {
        for (const p of s.points ?? []) {
          if (!isUtcCalendarDay(p.time, dayStart)) continue;
          const h = hourOfDayUtc(p.time);
          if (h == null || !Number.isFinite(p.vtec_tecu)) continue;
          hoursArr.push(h);
          vals.push(p.vtec_tecu);
        }
      }
      for (const o of obs) {
        if (!isUtcCalendarDay(o.time, dayStart)) continue;
        if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
        const h = hourOfDayUtc(o.time);
        if (h == null) continue;
        hoursArr.push(h);
        vals.push(o.vtec_tecu);
      }
      gopiHours = hoursArr;
      gopiVals = vals;
    }

    if (gopiHours.length < 8 && ggCmp.hoursArr.length < 8) return null;

    const gopiFan =
      gopiHours.length >= 8
        ? diurnalPercentilesFullDay(gopiHours, gopiVals, { maxVtec: 70 })
        : null;
    const ggFan =
      ggCmp.hoursArr.length >= 8
        ? diurnalPercentilesFullDay(ggCmp.hoursArr, ggCmp.vals, { maxVtec: 70 })
        : null;

    const hours = gopiFan?.hours ?? ggFan?.hours ?? [];
    if (!hours.length) return null;
    const hasGopi = gopiFan?.p50.some((v) => v != null) ?? false;
    const hasGg = ggFan?.p50.some((v) => v != null) ?? false;
    if (!hasGopi && !hasGg) return null;

    // Zenith VEq from live observations (GOPI-calibrated pipeline).
    const veqBuckets = new Map<number, number[]>();
    for (const o of obs) {
      if (!isUtcCalendarDay(o.time, dayStart)) continue;
      if (o.elevation_deg == null || o.elevation_deg < 60) continue;
      if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
      if (o.vtec_tecu <= 0 || o.vtec_tecu > 70) continue;
      const h = hourOfDayUtc(o.time);
      if (h == null) continue;
      const bin = Math.round(h * 2) / 2;
      const arr = veqBuckets.get(bin) ?? [];
      arr.push(o.vtec_tecu);
      veqBuckets.set(bin, arr);
    }
    const veq = hours.map((h) => {
      const arr = veqBuckets.get(h);
      if (!arr?.length) return null;
      const sorted = arr.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    });

    return {
      hours,
      gopi: gopiFan,
      gg: ggFan,
      veq,
      dayLabel: utcDayTitle,
      hasGopi,
      hasGg,
    };
  }, [stations, obs, methodCmp, utcDayStart, utcDayTitle]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card">
        <div className="metric-label" style={{ marginBottom: "0.35rem" }}>Live CORS ionosphere graphs</div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Zimbabwe CORS NTRIP VTEC / STEC from the live pipeline — VTEC time series, STEC/VTEC versus
          elevation, satellite skyplot coloured by VTEC, IPP ground tracks, and diurnal VTEC with
          GOPI (cyan) vs Gg (amber). Below: a short guide that classifies TEC quantities and explains
          how the two calculations differ. Click any graph for its scientific explanation.
        </p>
        {loading && <div className="banner banner-info" style={{ marginTop: "0.75rem" }}>Loading live CORS VTEC…</div>}
        {error && <div className="banner banner-warn" style={{ marginTop: "0.75rem" }}>{error}</div>}
        {updatedAt && !loading && (
          <p className="sw-supporting-text" style={{ margin: "0.55rem 0 0" }}>
            Updated {new Date(updatedAt).toUTCString()} · {stationSeries.length} stations with series · {obs.length.toLocaleString()} live samples
          </p>
        )}
      </div>

      <Section
        title="1 · VTEC Time Series"
        subtitle="Vertical Total Electron Content (VTEC) versus Universal Time (UT)."
        open={openGraph === "vtec-series"}
        onToggle={() => toggleGraph("vtec-series")}
        analysis={GRAPH_EXPLANATIONS["vtec-series"]}
      >
        {stationSeries.length > 0 ? (
          <LineChart
            labels={stationSeries[0].labels}
            xValues={stationSeries[0].epochs}
            epochMs={stationSeries[0].epochs}
            xLabel="UT"
            yLabel="VTEC (TECU)"
            height={240}
            toggleableLegend
            formatXTick={formatKnmiUtcTick}
            {...(vtecTimeAxis ?? {})}
            datasets={stationSeries.map((s) => ({
              label: `${s.station.toUpperCase()} VTEC`,
              data: s.values,
              color: s.color,
            }))}
          />
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for live station VTEC…" : "No live station VTEC points in the current window."}
          </div>
        )}
      </Section>

      <Section
        title="2 · STEC and VTEC versus Satellite Elevation"
        subtitle="Two panels: STEC versus elevation and VTEC versus elevation."
        open={openGraph === "elev-scatter"}
        onToggle={() => toggleGraph("elev-scatter")}
        analysis={GRAPH_EXPLANATIONS["elev-scatter"]}
      >
        {elevScatter.stecCount > 0 ? (
          <div className="sw-double-grid">
            <div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>STEC vs elevation</div>
              <Scatter
                data={{
                  datasets: [
                    ...elevScatter.stecDatasets,
                    ...(flatRef.length
                      ? [{
                          label: "Flat-layer STEC ≈ VTEC / sin(E)",
                          data: flatRef,
                          showLine: true,
                          borderColor: "#f8fafc",
                          backgroundColor: "#f8fafc",
                          pointRadius: 0,
                          borderDash: [4, 4],
                        }]
                      : []),
                  ],
                }}
                options={{
                  responsive: true,
                  plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } } } },
                  scales: {
                    x: { min: 15, max: 90, title: { display: true, text: "Elevation (°)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
                    y: { title: { display: true, text: "STEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
                  },
                }}
                height={160}
              />
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>VTEC vs elevation</div>
              <Scatter
                data={{ datasets: elevScatter.vtecDatasets }}
                options={{
                  responsive: true,
                  plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } } } },
                  scales: {
                    x: { min: 15, max: 90, title: { display: true, text: "Elevation (°)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
                    y: { title: { display: true, text: "VTEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
                  },
                }}
                height={160}
              />
            </div>
          </div>
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for live STEC/elevation samples…" : "No live STEC/elevation samples in the current window."}
          </div>
        )}
      </Section>

      <Section
        title="3 · Satellite Skyplot Coloured by VTEC"
        subtitle="Satellite azimuth and elevation, with colour representing VTEC."
        open={openGraph === "skyplot"}
        onToggle={() => toggleGraph("skyplot")}
        analysis={GRAPH_EXPLANATIONS.skyplot}
      >
        {skyplotPoints.length > 0 ? (
          <SkyplotByVtec points={skyplotPoints} />
        ) : (
          <div className="banner banner-info">
            {loading
              ? "Geometry enrichment is loading — waiting for elevation/azimuth samples…"
              : "Geometry enrichment unavailable — no live samples with elevation and azimuth yet."}
          </div>
        )}
      </Section>

      <Section
        title="4 · Ionospheric Pierce Point (IPP) Ground Tracks"
        subtitle="Two panels: IPP locations coloured by VTEC and by observation time."
        open={openGraph === "ipp"}
        onToggle={() => toggleGraph("ipp")}
        analysis={GRAPH_EXPLANATIONS.ipp}
      >
        {ippTracks.length > 0 ? (
          <IppGroundTracks points={ippTracks} />
        ) : (
          <div className="banner banner-info">
            {loading
              ? "Waiting for station coordinates and azimuth/elevation geometry…"
              : "No IPP tracks yet — need station catalog plus elevation and azimuth on live observations."}
          </div>
        )}
      </Section>

      <Section
        title="5 · Diurnal VTEC Distribution"
        subtitle="GOPI (cyan) vs Gg (amber) daily medians and 10th–90th percentile bands on the same UTC day."
        open={openGraph === "diurnal"}
        onToggle={() => toggleGraph("diurnal")}
        analysis={GRAPH_EXPLANATIONS.diurnal}
      >
        {diurnalLive ? (
          <div style={{ background: "#0b1220", borderRadius: 8, padding: "0.65rem 0.5rem 0.35rem", height: 340 }}>
            <DiurnalFanChart
              hours={diurnalLive.hours}
              gopi={diurnalLive.gopi}
              gg={diurnalLive.gg}
              veq={diurnalLive.veq}
              dayLabel={diurnalLive.dayLabel}
              hasGopi={diurnalLive.hasGopi}
              hasGg={diurnalLive.hasGg}
            />
          </div>
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for today’s live CORS samples…" : "Not enough live VTEC points yet for today’s UTC day."}
          </div>
        )}
      </Section>
    </div>
  );
}

function xy(
  hours: number[],
  values: (number | null)[],
): { x: number; y: number | null }[] {
  return hours.map((h, i) => ({ x: h, y: values[i] ?? null }));
}

const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#f59e0b";

type FanBands = {
  hours: number[];
  p10: (number | null)[];
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  p90: (number | null)[];
};

function DiurnalFanChart({
  hours,
  gopi,
  gg,
  veq,
  dayLabel,
  hasGopi,
  hasGg,
}: {
  hours: number[];
  gopi: FanBands | null;
  gg: FanBands | null;
  veq: (number | null)[];
  dayLabel: string;
  hasGopi: boolean;
  hasGg: boolean;
}) {
  const datasets = [
    ...(hasGopi && gopi
      ? [
          {
            label: "GOPI 10–90%",
            data: xy(hours, gopi.p90),
            borderColor: "transparent",
            backgroundColor: "rgba(56, 189, 248, 0.22)",
            fill: "+1" as const,
            pointRadius: 0,
            tension: 0.3,
            spanGaps: false,
            order: 5,
          },
          {
            label: "GOPI p10",
            data: xy(hours, gopi.p10),
            borderColor: "transparent",
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            spanGaps: false,
            order: 5,
          },
          {
            label: "GOPI median",
            data: xy(hours, gopi.p50),
            borderColor: GOPI_COLOR,
            backgroundColor: GOPI_COLOR,
            borderWidth: 2.5,
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            spanGaps: false,
            order: 2,
          },
        ]
      : []),
    ...(hasGg && gg
      ? [
          {
            label: "Gg 10–90%",
            data: xy(hours, gg.p90),
            borderColor: "transparent",
            backgroundColor: "rgba(245, 158, 11, 0.22)",
            fill: "+1" as const,
            pointRadius: 0,
            tension: 0.3,
            spanGaps: false,
            order: 4,
          },
          {
            label: "Gg p10",
            data: xy(hours, gg.p10),
            borderColor: "transparent",
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            spanGaps: false,
            order: 4,
          },
          {
            label: "Gg median",
            data: xy(hours, gg.p50),
            borderColor: GG_COLOR,
            backgroundColor: GG_COLOR,
            borderWidth: 2.5,
            borderDash: [5, 3] as number[],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            spanGaps: false,
            order: 1,
          },
        ]
      : []),
    {
      label: "VEq (zenith)",
      data: xy(hours, veq),
      borderColor: "#e8eef7",
      backgroundColor: "#e8eef7",
      borderWidth: 1.6,
      borderDash: [6, 4] as number[],
      fill: false,
      tension: 0.35,
      pointRadius: 0,
      spanGaps: false,
      order: 0,
    },
  ];

  const methodTag =
    hasGopi && hasGg
      ? "GOPI (cyan) vs Gg (amber)"
      : hasGg
        ? "Gg only"
        : "GOPI / Live CORS";

  return (
    <Line
      data={{ datasets }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              color: "#e8eef7",
              boxWidth: 14,
              boxHeight: 8,
              font: { size: 11 },
              filter: (item) => !["GOPI p10", "Gg p10"].includes(String(item.text)),
            },
          },
          title: {
            display: true,
            text: `Diurnal VTEC — ${methodTag} | ${dayLabel}`,
            color: "#f8fafc",
            font: { size: 14, weight: "bold" },
            padding: { bottom: 10 },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 24,
            title: { display: true, text: "UT [hours]", color: "#e8eef7", font: { size: 12 } },
            ticks: {
              color: "#cbd5e1",
              stepSize: 2,
              callback: (v) => String(v),
            },
            grid: { color: "rgba(148,163,184,0.25)" },
          },
          y: {
            title: { display: true, text: "VTEC [TECU]", color: "#e8eef7", font: { size: 12 } },
            ticks: { color: "#cbd5e1" },
            grid: { color: "rgba(148,163,184,0.25)" },
            beginAtZero: false,
          },
        },
      }}
    />
  );
}

function SkyplotByVtec({
  points,
}: {
  points: { az: number; el: number; vtec: number; key: string }[];
}) {
  const size = 100;
  const cx = 50;
  const cy = 50;
  const maxR = 42;
  const vmin = 10;
  const vmax = 35;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ position: "relative", maxWidth: 420, margin: "0 auto", width: "100%" }}>
        <svg
          width="100%"
          viewBox={`0 0 ${size} ${size}`}
          style={{ background: "#071422", borderRadius: 8, border: "1px solid var(--border)", aspectRatio: "1 / 1" }}
        >
          {[30, 60, 90].map((elRing) => {
            const r = ((90 - elRing) / 90) * maxR;
            return (
              <circle
                key={elRing}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="rgba(148,163,184,0.28)"
                strokeWidth="0.35"
              />
            );
          })}
          <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="rgba(148,163,184,0.22)" strokeWidth="0.3" />
          <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="rgba(148,163,184,0.22)" strokeWidth="0.3" />
          <text x={cx} y={cy - maxR - 2.5} textAnchor="middle" fill="#94a3b8" fontSize="3.2" fontWeight="700">N</text>
          <text x={cx + maxR + 2.5} y={cy + 1.2} textAnchor="middle" fill="#94a3b8" fontSize="3.2" fontWeight="700">E</text>
          <text x={cx} y={cy + maxR + 4.2} textAnchor="middle" fill="#94a3b8" fontSize="3.2" fontWeight="700">S</text>
          <text x={cx - maxR - 2.5} y={cy + 1.2} textAnchor="middle" fill="#94a3b8" fontSize="3.2" fontWeight="700">W</text>
          <text x={cx + 1} y={cy - ((90 - 30) / 90) * maxR + 1} fill="#64748b" fontSize="2.2">30°</text>
          <text x={cx + 1} y={cy - ((90 - 60) / 90) * maxR + 1} fill="#64748b" fontSize="2.2">60°</text>
          {points.map((p) => {
            const azRad = (p.az * Math.PI) / 180;
            const r = ((90 - Math.max(0, Math.min(90, p.el))) / 90) * maxR;
            // N at top, azimuth clockwise: x = sin(az), y = −cos(az)
            const x = cx + r * Math.sin(azRad);
            const y = cy - r * Math.cos(azRad);
            return (
              <circle
                key={p.key}
                cx={x}
                cy={y}
                r="0.85"
                fill={vtecPlasma(p.vtec, vmin, vmax)}
                opacity={0.85}
              />
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", justifyContent: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>VTEC (TECU)</span>
        <div
          style={{
            width: 140,
            height: 10,
            borderRadius: 4,
            background: `linear-gradient(90deg, ${vtecPlasma(vmin)}, ${vtecPlasma((vmin + vmax) / 2)}, ${vtecPlasma(vmax)})`,
          }}
        />
        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{vmin} – {vmax}</span>
        <span style={{ fontSize: "0.72rem", color: "#64748b" }}>· {points.length.toLocaleString()} samples · zenith at centre</span>
      </div>
    </div>
  );
}

function IppGroundTracks({
  points,
}: {
  points: { lon: number; lat: number; vtec: number; hour: number }[];
}) {
  const lonMin = 22;
  const lonMax = 36;
  const latMin = -24;
  const latMax = -14;
  const project = (lon: number, lat: number) => ({
    x: Math.max(1, Math.min(99, ((lon - lonMin) / (lonMax - lonMin)) * 100)),
    y: Math.max(1, Math.min(99, ((latMax - lat) / (latMax - latMin)) * 100)),
  });
  const draw = points.length ? points : [];

  const renderMap = (
    title: string,
    colorFn: (p: (typeof points)[0]) => string,
    legend: React.ReactNode,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{title}</div>
      <div style={{ position: "relative", height: 260, border: "1px solid var(--border)", borderRadius: 8, background: "#071422", overflow: "hidden" }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <text x="2" y="6" fill="#64748b" fontSize="3.2">{Math.abs(latMax).toFixed(1)}°S</text>
          <text x="2" y="98" fill="#64748b" fontSize="3.2">{Math.abs(latMin).toFixed(1)}°S</text>
          <text x="2" y="99.5" fill="#64748b" fontSize="2.8">{lonMin}°E</text>
          <text x="88" y="99.5" fill="#64748b" fontSize="2.8">{lonMax}°E</text>
          {draw.map((p, i) => {
            const { x, y } = project(p.lon, p.lat);
            return (
              <circle
                key={`${p.lon.toFixed(3)}-${p.lat.toFixed(3)}-${i}`}
                cx={x}
                cy={y}
                r="0.7"
                fill={colorFn(p)}
                opacity={0.8}
              />
            );
          })}
        </svg>
      </div>
      {legend}
    </div>
  );

  return (
    <div className="sw-double-grid">
      {renderMap(
        `IPP coloured by VTEC · shell ${IONO_SHELL_KM} km`,
        (p) => vtecPlasma(p.vtec),
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.7rem", color: "#94a3b8" }}>
          <span>10</span>
          <div style={{ flex: 1, height: 8, borderRadius: 3, background: `linear-gradient(90deg, ${vtecPlasma(10)}, ${vtecPlasma(35)})` }} />
          <span>35 TECU</span>
        </div>,
      )}
      {renderMap(
        "IPP coloured by observation UT hour",
        (p) => hourColor(p.hour),
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.7rem", color: "#94a3b8" }}>
          <span>0h</span>
          <div
            style={{
              flex: 1,
              height: 8,
              borderRadius: 3,
              background: `linear-gradient(90deg, ${hourColor(0)}, ${hourColor(6)}, ${hourColor(12)}, ${hourColor(18)}, ${hourColor(23)})`,
            }}
          />
          <span>24h</span>
        </div>,
      )}
    </div>
  );
}
