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
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getTecMethodComparison } from "@/lib/api";
import { getTecMethodCmpParams } from "@/lib/tecMethodCompareParams";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import { diurnalPercentilesFullDay, hourOfDayUtc, flatLayerStec } from "@/lib/tecTeachingMath";
import type { LiveObservation, TecMethodComparisonResponse, TecMethodInfo } from "@/lib/types";
import ZimbabweLatBandTecCharts from "@/components/spaceWeather/ZimbabweLatBandTecCharts";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);
ChartJS.defaults.color = "#ffffff";
ChartJS.defaults.animation = false;

const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#f59e0b";

type GraphId = "cmp-vtec" | "cmp-elev" | "cmp-sky" | "cmp-diff" | "cmp-diurnal" | "cmp-latband";

const GRAPH_HELP: Record<GraphId, ChartAnalysisBlock> = {
  "cmp-vtec": {
    lead: "Same CORS samples, two calibrations: GOPI/Seemala (cyan) versus Gg = Cesaroni (amber).",
    bullets: [
      "Both start from dual-frequency geometry-free TEC; they diverge in how hardware biases are removed.",
      "GOPI: Seemala-style DCB / σ handling (live path often code TEC without monthly DCB files).",
      "Gg: windowed least squares for a VTEC(MODIP, LT) polynomial + arc biases (Cesaroni / PyTECGg).",
      "Vertical offset between cyan and amber is usually calibration — not a second ionosphere.",
    ],
  },
  "cmp-elev": {
    lead: "Classify STEC vs VTEC here: STEC grows at low elevation; VTEC should be flatter after thin-shell mapping.",
    bullets: [
      "Left: STEC vs elevation for both methods. Right: VTEC vs elevation.",
      "Gg arc-bias correction often tightens the VTEC cloud relative to raw GOPI code TEC.",
      "Dashed line is the flat-layer teaching curve STEC ≈ VTEC / sin(E).",
    ],
  },
  "cmp-sky": {
    lead: "Skyplot of look angles coloured by method: cyan = GOPI VTEC, amber = Gg VTEC (paired samples).",
    bullets: [
      "Each point is a satellite direction (azimuth / elevation) — same geometry, two calibrations.",
      "Colour clusters show where absolute TECU disagree on the sky after bias treatment.",
    ],
  },
  "cmp-diff": {
    lead: "ΔVTEC = Gg − GOPI for matched samples. This is the clearest view of calculation differences.",
    bullets: [
      "A stable bias band means absolute scales differ (DCB / arc-bias) while the ionosphere is shared.",
      "Near-zero scatter means the methods agree after mapping and calibration.",
      "Large time-varying ΔVTEC needs investigation (arcs, elevation mask, or sparse windows).",
    ],
  },
  "cmp-diurnal": {
    lead: "Diurnal median ribbons for each method on the current UTC day — same day shape, two absolute scales.",
    bullets: [
      "Cyan ribbon = GOPI percentiles; amber ribbon = Gg percentiles.",
      "Similar shape with offset = bias model difference (Seemala/GOPI vs Gg joint fit).",
      "Read this together with the teaching guide above (classify VTEC, then compare methods).",
    ],
  },
  "cmp-latband": {
    lead: "Northern / central / southern Zimbabwe diurnal VTEC — one graph per calibration (GOPI and Gg).",
    bullets: [
      "Latitude bands: north of −18.2°, central (−18.2° to −20.2°), south of −20.2° (CORS station latitudes).",
      "GOPI chart uses measured station VTEC bins; Gg uses Cesaroni-calibrated samples (or measured Gg−GOPI offsets on the same diurnal).",
      "This replaces the illustrative low/mid/high-latitude sketch with Zimbabwe-specific latitudinal comparison.",
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

function methodColor(id: string, methods: TecMethodInfo[]): string {
  return methods.find((m) => m.id === id)?.color ?? (id === "gg" ? GG_COLOR : GOPI_COLOR);
}

function hourUt(iso: string): number | null {
  return hourOfDayUtc(iso);
}

export default function TecMethodComparisonLab() {
  const [data, setData] = useState<TecMethodComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGopi, setShowGopi] = useState(true);
  const [showGg, setShowGg] = useState(true);
  const [openGraph, setOpenGraph] = useState<GraphId | null>(null);
  const toggleGraph = (id: GraphId) => setOpenGraph((c) => (c === id ? null : id));

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      const cmp = getTecMethodCmpParams();
      getTecMethodComparison(cmp.hours, undefined, cmp.limit, cmp.timeoutMs)
        .then((payload) => {
          if (cancelled) return;
          setData(payload);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Comparison feed unavailable");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = window.setInterval(load, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const gopi = useMemo(() => (showGopi ? data?.gopi ?? [] : []), [data, showGopi]);
  const gg = useMemo(() => (showGg ? data?.gg ?? [] : []), [data, showGg]);
  const methods = data?.methods ?? [];

  const vtecSeries = useMemo(() => {
    const toPts = (rows: LiveObservation[]) =>
      rows
        .filter((o) => o.vtec_tecu != null && Number.isFinite(o.vtec_tecu))
        .map((o) => ({ x: Date.parse(o.time), y: o.vtec_tecu as number }))
        .filter((p) => Number.isFinite(p.x))
        .sort((a, b) => a.x - b.x);
    return {
      gopi: toPts(gopi),
      gg: toPts(gg),
    };
  }, [gopi, gg]);

  const elevPanels = useMemo(() => {
    const pack = (rows: LiveObservation[], color: string, label: string) => {
      const stec: { x: number; y: number }[] = [];
      const vtec: { x: number; y: number }[] = [];
      for (const o of rows) {
        const el = o.elevation_deg;
        if (el == null || el < 15) continue;
        if (o.stec_tecu != null) stec.push({ x: el, y: o.stec_tecu });
        if (o.vtec_tecu != null) vtec.push({ x: el, y: o.vtec_tecu });
      }
      return {
        stec: { label: `${label} STEC`, data: stec, backgroundColor: color, pointRadius: 1.5 },
        vtec: { label: `${label} VTEC`, data: vtec, backgroundColor: color, pointRadius: 1.5 },
      };
    };
    const g = pack(gopi, methodColor("gopi", methods), "GOPI");
    const c = pack(gg, methodColor("gg", methods), "Gg");
    const med =
      gopi.map((o) => o.vtec_tecu).filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const mid = med.length ? med[Math.floor(med.length / 2)] : 20;
    const flat = Array.from({ length: 76 }, (_, i) => {
      const el = 15 + i;
      return { x: el, y: flatLayerStec(mid, el) };
    });
    return { g, c, flat };
  }, [gopi, gg, methods]);

  const sky = useMemo(() => {
    const pts = (rows: LiveObservation[], color: string, label: string) => {
      const data: { x: number; y: number }[] = [];
      for (const o of rows) {
        const el = o.elevation_deg;
        const az = o.azimuth_deg;
        if (el == null || az == null || o.vtec_tecu == null) continue;
        // Polar-like: x = (90-el)*sin(az), y = (90-el)*cos(az)
        const r = 90 - el;
        const rad = ((az - 90) * Math.PI) / 180;
        data.push({ x: r * Math.cos(rad), y: r * Math.sin(rad) });
      }
      return { label, data, backgroundColor: color, pointRadius: 1.4 };
    };
    return [
      pts(gopi, methodColor("gopi", methods), "GOPI"),
      pts(gg, methodColor("gg", methods), "Gg"),
    ].filter((d) => d.data.length);
  }, [gopi, gg, methods]);

  const delta = useMemo(() => {
    const key = (o: LiveObservation) => `${o.time}|${o.station}|${o.prn}`;
    const gopiMap = new Map<string, number>();
    for (const o of data?.gopi ?? []) {
      if (o.vtec_tecu != null) gopiMap.set(key(o), o.vtec_tecu);
    }
    const pts: { x: number; y: number }[] = [];
    for (const o of data?.gg ?? []) {
      if (o.vtec_tecu == null) continue;
      const g = gopiMap.get(key(o));
      if (g == null) continue;
      const ms = Date.parse(o.time);
      if (!Number.isFinite(ms)) continue;
      pts.push({ x: ms, y: o.vtec_tecu - g });
    }
    return pts.sort((a, b) => a.x - b.x);
  }, [data]);

  const diurnal = useMemo(() => {
    const build = (rows: LiveObservation[]) => {
      const hours: number[] = [];
      const values: number[] = [];
      for (const o of rows) {
        const h = hourUt(o.time);
        if (h == null || o.vtec_tecu == null) continue;
        hours.push(h);
        values.push(o.vtec_tecu);
      }
      return diurnalPercentilesFullDay(hours, values);
    };
    return { gopi: build(data?.gopi ?? []), gg: build(data?.gg ?? []) };
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card">
        <div className="metric-label" style={{ marginBottom: "0.35rem" }}>
          GOPI vs Gg TEC calibration comparison — live graphs
        </div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Same Zimbabwe CORS samples, two calculation paths so you can see the difference:
          {" "}
          <span style={{ color: GOPI_COLOR, fontWeight: 700 }}>GOPI / Seemala</span>
          {" "}(live operational) versus{" "}
          <span style={{ color: GG_COLOR, fontWeight: 700 }}>Gg = Cesaroni</span>
          {" "}calibration. Cyan–amber offsets are mostly bias handling, not a different ionosphere.
          Click any graph for the scientific explanation.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.82rem" }}>
            <input type="checkbox" checked={showGopi} onChange={(e) => setShowGopi(e.target.checked)} />
            <span style={{ color: GOPI_COLOR, fontWeight: 700 }}>Show GOPI</span>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.82rem" }}>
            <input type="checkbox" checked={showGg} onChange={(e) => setShowGg(e.target.checked)} />
            <span style={{ color: GG_COLOR, fontWeight: 700 }}>Show Gg</span>
          </label>
          {loading && <span className="sw-supporting-text">Loading comparison…</span>}
          {error && <span className="banner banner-warn" style={{ margin: 0 }}>{error}</span>}
        </div>
        {data?.note && (
          <p className="sw-supporting-text" style={{ margin: "0.65rem 0 0" }}>{data.note}</p>
        )}
        {data?.methods?.length ? (
          <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.75rem" }}>
            {data.methods.map((m) => (
              <div key={m.id} style={{ fontSize: "0.8rem", color: "var(--text-muted)", borderLeft: `3px solid ${m.color}`, paddingLeft: "0.65rem" }}>
                <strong style={{ color: m.color }}>{m.short}</strong> — {m.label}. {m.calibration}
                {m.engine ? ` Engine: ${m.engine}.` : ""}
              </div>
            ))}
          </div>
        ) : null}
        {data?.references?.length ? (
          <details style={{ marginTop: "0.75rem" }}>
            <summary className="sw-supporting-text" style={{ cursor: "pointer" }}>Gg = Cesaroni references</summary>
            <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1.1rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {data.references.map((r) => (
                <li key={r.doi} style={{ marginBottom: 4 }}>
                  {r.cite}: {r.title}. DOI: {r.doi}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <Section
        title="C1 · VTEC time series — GOPI vs Gg"
        subtitle="Overlay of calibrated VTEC versus Universal Time for both methods."
        open={openGraph === "cmp-vtec"}
        onToggle={() => toggleGraph("cmp-vtec")}
        analysis={GRAPH_HELP["cmp-vtec"]}
      >
        {(vtecSeries.gopi.length || vtecSeries.gg.length) ? (
          <Scatter
            data={{
              datasets: [
                ...(vtecSeries.gopi.length
                  ? [{
                      label: "GOPI VTEC",
                      data: vtecSeries.gopi,
                      backgroundColor: GOPI_COLOR,
                      borderColor: GOPI_COLOR,
                      showLine: true,
                      pointRadius: 0,
                      borderWidth: 1.5,
                    }]
                  : []),
                ...(vtecSeries.gg.length
                  ? [{
                      label: "Gg VTEC",
                      data: vtecSeries.gg,
                      backgroundColor: GG_COLOR,
                      borderColor: GG_COLOR,
                      showLine: true,
                      pointRadius: 0,
                      borderWidth: 1.5,
                    }]
                  : []),
              ],
            }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#ffffff", boxWidth: 10 } } },
              scales: {
                x: {
                  type: "linear",
                  title: { display: true, text: "UT (epoch ms)", color: "#ffffff" },
                  ticks: {
                    color: "#ffffff",
                    callback: (v) => {
                      const d = new Date(Number(v));
                      return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
                    },
                  },
                },
                y: { title: { display: true, text: "VTEC (TECU)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
              },
            }}
            height={120}
          />
        ) : (
          <div className="banner banner-info">{loading ? "Waiting for comparison samples…" : "No VTEC samples for comparison."}</div>
        )}
      </Section>

      <Section
        title="C2 · STEC / VTEC versus elevation — GOPI vs Gg"
        subtitle="Two panels with both calibrations so elevation mapping differences are visible."
        open={openGraph === "cmp-elev"}
        onToggle={() => toggleGraph("cmp-elev")}
        analysis={GRAPH_HELP["cmp-elev"]}
      >
        <div className="sw-double-grid">
          <div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>STEC vs elevation</div>
            <Scatter
              data={{
                datasets: [
                  elevPanels.g.stec,
                  elevPanels.c.stec,
                  {
                    label: "Flat-layer STEC ≈ VTEC / sin(E)",
                    data: elevPanels.flat,
                    showLine: true,
                    borderColor: "#f8fafc",
                    backgroundColor: "#f8fafc",
                    pointRadius: 0,
                    borderDash: [4, 4],
                  },
                ],
              }}
              options={{
                responsive: true,
                plugins: { legend: { labels: { color: "#ffffff", boxWidth: 10, font: { size: 10 } } } },
                scales: {
                  x: { min: 15, max: 90, title: { display: true, text: "Elevation (°)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
                  y: { title: { display: true, text: "STEC (TECU)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
                },
              }}
              height={140}
            />
          </div>
          <div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>VTEC vs elevation</div>
            <Scatter
              data={{ datasets: [elevPanels.g.vtec, elevPanels.c.vtec] }}
              options={{
                responsive: true,
                plugins: { legend: { labels: { color: "#ffffff", boxWidth: 10, font: { size: 10 } } } },
                scales: {
                  x: { min: 15, max: 90, title: { display: true, text: "Elevation (°)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
                  y: { title: { display: true, text: "VTEC (TECU)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
                },
              }}
              height={140}
            />
          </div>
        </div>
      </Section>

      <Section
        title="C3 · Skyplot — GOPI vs Gg colours"
        subtitle="Azimuth / elevation geometry with method-coloured VTEC samples."
        open={openGraph === "cmp-sky"}
        onToggle={() => toggleGraph("cmp-sky")}
        analysis={GRAPH_HELP["cmp-sky"]}
      >
        {sky.length ? (
          <Scatter
            data={{ datasets: sky }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#ffffff", boxWidth: 10 } } },
              scales: {
                x: { min: -90, max: 90, title: { display: true, text: "E ← zenith → W (approx)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
                y: { min: -90, max: 90, title: { display: true, text: "S ← zenith → N (approx)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
              },
            }}
            height={160}
          />
        ) : (
          <div className="banner banner-info">Need elevation + azimuth on live samples for the comparison skyplot.</div>
        )}
      </Section>

      <Section
        title="C4 · ΔVTEC (Gg − GOPI)"
        subtitle="Matched-sample difference highlighting calibration offset."
        open={openGraph === "cmp-diff"}
        onToggle={() => toggleGraph("cmp-diff")}
        analysis={GRAPH_HELP["cmp-diff"]}
      >
        {delta.length ? (
          <Scatter
            data={{
              datasets: [{
                label: "ΔVTEC Gg−GOPI",
                data: delta,
                backgroundColor: "#a78bfa",
                borderColor: "#a78bfa",
                showLine: true,
                pointRadius: 0,
                borderWidth: 1.4,
              }],
            }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#ffffff", boxWidth: 10 } } },
              scales: {
                x: {
                  type: "linear",
                  ticks: {
                    color: "#ffffff",
                    callback: (v) => {
                      const d = new Date(Number(v));
                      return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
                    },
                  },
                  title: { display: true, text: "UT", color: "#ffffff" },
                },
                y: { title: { display: true, text: "ΔVTEC (TECU)", color: "#ffffff" }, ticks: { color: "#ffffff" } },
              },
            }}
            height={110}
          />
        ) : (
          <div className="banner banner-info">{loading ? "Computing ΔVTEC…" : "Not enough matched GOPI/Gg samples yet."}</div>
        )}
      </Section>

      <Section
        title="C5 · Diurnal distribution — GOPI vs Gg"
        subtitle="Median and percentile bands for each calibration on the current samples."
        open={openGraph === "cmp-diurnal"}
        onToggle={() => toggleGraph("cmp-diurnal")}
        analysis={GRAPH_HELP["cmp-diurnal"]}
      >
        <div style={{ background: "#0b1220", borderRadius: 8, padding: "0.65rem 0.5rem 0.35rem", height: 320 }}>
          <Line
            data={{
              datasets: [
                {
                  label: "GOPI 10–90%",
                  data: diurnal.gopi.hours.map((h, i) => ({ x: h, y: diurnal.gopi.p90[i] })),
                  borderColor: "transparent",
                  backgroundColor: "rgba(56, 189, 248, 0.18)",
                  fill: "+1",
                  pointRadius: 0,
                  tension: 0.3,
                },
                {
                  label: "GOPI p10",
                  data: diurnal.gopi.hours.map((h, i) => ({ x: h, y: diurnal.gopi.p10[i] })),
                  borderColor: "transparent",
                  backgroundColor: "transparent",
                  fill: false,
                  pointRadius: 0,
                },
                {
                  label: "GOPI median",
                  data: diurnal.gopi.hours.map((h, i) => ({ x: h, y: diurnal.gopi.p50[i] })),
                  borderColor: GOPI_COLOR,
                  backgroundColor: GOPI_COLOR,
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.35,
                },
                {
                  label: "Gg 10–90%",
                  data: diurnal.gg.hours.map((h, i) => ({ x: h, y: diurnal.gg.p90[i] })),
                  borderColor: "transparent",
                  backgroundColor: "rgba(245, 158, 11, 0.18)",
                  fill: "+1",
                  pointRadius: 0,
                  tension: 0.3,
                },
                {
                  label: "Gg p10",
                  data: diurnal.gg.hours.map((h, i) => ({ x: h, y: diurnal.gg.p10[i] })),
                  borderColor: "transparent",
                  backgroundColor: "transparent",
                  fill: false,
                  pointRadius: 0,
                },
                {
                  label: "Gg median",
                  data: diurnal.gg.hours.map((h, i) => ({ x: h, y: diurnal.gg.p50[i] })),
                  borderColor: GG_COLOR,
                  backgroundColor: GG_COLOR,
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.35,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              plugins: {
                legend: { labels: { color: "#ffffff", boxWidth: 10, font: { size: 10 } } },
                title: { display: true, text: "Diurnal VTEC — GOPI (cyan) vs Gg (amber)", color: "#ffffff", font: { size: 12 } },
              },
              scales: {
                x: { type: "linear", min: 0, max: 24, title: { display: true, text: "UT [hours]", color: "#ffffff" }, ticks: { color: "#ffffff", stepSize: 2 } },
                y: { title: { display: true, text: "VTEC [TECU]", color: "#ffffff" }, ticks: { color: "#ffffff" } },
              },
            }}
          />
        </div>
      </Section>

      <Section
        title="C6 · Northern / central / southern Zimbabwe — GOPI & Gg"
        subtitle="Latitudinal diurnal comparison using measured Zimbabwe CORS data for both methods."
        open={openGraph === "cmp-latband"}
        onToggle={() => toggleGraph("cmp-latband")}
        analysis={GRAPH_HELP["cmp-latband"]}
      >
        <ZimbabweLatBandTecCharts methodCmp={data} autoload />
      </Section>
    </div>
  );
}
