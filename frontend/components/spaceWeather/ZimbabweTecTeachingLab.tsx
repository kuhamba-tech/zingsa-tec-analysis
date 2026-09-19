"use client";

import { useEffect, useMemo, useState } from "react";
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
import LineChart from "@/components/charts/LineChart";
import TecPrimerBlock from "@/components/spaceWeather/TecPrimerBlock";
import { getLiveVtec, getLiveVtecByStation } from "@/lib/api";
import {
  diurnalPercentiles,
  diurnalVtecModel,
  EXERCISE_CORRECT_VTEC,
  EXERCISE_ELEVATION_DEG,
  EXERCISE_STEC_TECU,
  flatLayerStec,
  hourOfDayUtc,
  IONO_SHELL_KM,
  stecFromVtec,
  thinShellMappingFactor,
  vtecFromStec,
} from "@/lib/tecTeachingMath";
import type { LiveObservation, LiveStationVtecSeries } from "@/lib/types";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const STATION_COLORS = ["#38bdf8", "#fbbf24", "#a78bfa", "#34d399", "#f97316", "#f472b6"];
const CONST_COLORS: Record<string, string> = {
  G: "#38bdf8",
  R: "#f97316",
  E: "#a78bfa",
  C: "#34d399",
  J: "#fbbf24",
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>{title}</div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
      <span style={{ color: "var(--text-muted)" }}>
        {label}: <strong style={{ color: "var(--text)" }}>{value}{unit}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function ZimbabweTecTeachingLab() {
  const [stations, setStations] = useState<LiveStationVtecSeries[]>([]);
  const [obs, setObs] = useState<LiveObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive models
  const [peakVtec, setPeakVtec] = useState(30);
  const [peakHour, setPeakHour] = useState(14);
  const [background, setBackground] = useState(10);
  const [modelElev, setModelElev] = useState(30);
  const [modelVtec, setModelVtec] = useState(25);
  const [skyAz, setSkyAz] = useState(60);
  const [skyEl, setSkyEl] = useState(45);
  const [skyVtec, setSkyVtec] = useState(25);
  const [pctPeak, setPctPeak] = useState(25);
  const [pctSpread, setPctSpread] = useState(5);
  const [pctPeakHour, setPctPeakHour] = useState(14);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizChecked, setQuizChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Station series for Graphs 1 & 5; one-station short lookback for STEC/elevation
    // (full /live/vtec can be tens of MB and block the teaching UI).
    Promise.allSettled([
      getLiveVtecByStation(6, 15),
      getLiveVtec(0.25, "kari"),
    ]).then(([st, live]) => {
      if (cancelled) return;
      if (st.status === "fulfilled") setStations(Array.isArray(st.value) ? st.value : []);
      if (live.status === "fulfilled") {
        const rows = Array.isArray(live.value) ? live.value : [];
        // Cap client-side so Chart.js stays responsive
        const step = Math.max(1, Math.floor(rows.length / 2500));
        setObs(step > 1 ? rows.filter((_, i) => i % step === 0) : rows);
      }
      const fails = [st, live].filter((r) => r.status === "rejected").length;
      setError(fails === 2 ? "Live VTEC feeds unavailable — teaching models still work." : null);
      setLoading(false);
    });
    const unlock = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(unlock);
    };
  }, []);

  const hours = useMemo(() => Array.from({ length: 49 }, (_, i) => i * 0.5), []);
  const modelCurve = useMemo(
    () => diurnalVtecModel(hours, peakVtec, peakHour, background),
    [hours, peakVtec, peakHour, background],
  );

  const stationSeries = useMemo(() => {
    return stations
      .filter((s) => s.points?.length)
      .slice(0, 5)
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
        };
      });
  }, [stations]);

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
      const step = Math.max(1, Math.floor(pts.length / 600));
      return pts.filter((_, i) => i % step === 0);
    };
    const stecDatasets = Object.entries(stecByConst).map(([k, pts]) => ({
      label: `STEC ${k}`,
      data: downsample(pts),
      backgroundColor: CONST_COLORS[k] ?? "#94a3b8",
      pointRadius: 1.5,
    }));
    const vtecDatasets = Object.entries(vtecByConst).map(([k, pts]) => ({
      label: `VTEC ${k}`,
      data: downsample(pts),
      backgroundColor: CONST_COLORS[k] ?? "#94a3b8",
      pointRadius: 1.5,
    }));
    const sorted = allVtec.slice().sort((a, b) => a - b);
    return {
      stecDatasets,
      vtecDatasets,
      stecCount: Object.values(stecByConst).reduce((n, a) => n + a.length, 0),
      medianVtec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  }, [obs]);

  const diurnalLive = useMemo(() => {
    const hoursArr: number[] = [];
    const vals: number[] = [];
    for (const s of stations) {
      for (const p of s.points ?? []) {
        const h = hourOfDayUtc(p.time);
        if (h == null || !Number.isFinite(p.vtec_tecu)) continue;
        hoursArr.push(h);
        vals.push(p.vtec_tecu);
      }
    }
    if (hoursArr.length < 8) return null;
    return diurnalPercentiles(hoursArr, vals);
  }, [stations]);

  const mapping = thinShellMappingFactor(modelElev);
  const modelStec = stecFromVtec(modelVtec, modelElev);

  const quizOptions = [15.0, 34.2, 60.0, 105.2];
  const quizCorrect = Math.abs((quizChoice ?? -1) - EXERCISE_CORRECT_VTEC) < 0.2;

  const elRange = useMemo(() => Array.from({ length: 71 }, (_, i) => 20 + i), []);
  const flatRef = elevScatter.medianVtec != null
    ? elRange.map((el) => ({ x: el, y: flatLayerStec(elevScatter.medianVtec!, el) }))
    : elRange.map((el) => ({ x: el, y: flatLayerStec(modelVtec, el) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card">
        <div className="metric-label" style={{ marginBottom: "0.5rem" }}>Learning lab — GNSS TEC for Zimbabwe</div>
        <p className="sw-supporting-text" style={{ margin: "0 0 0.75rem" }}>
          These graphs follow the Step 5 notebook workflow: VTEC vs time, STEC/VTEC vs elevation,
          skyplot, ionospheric pierce points, and diurnal percentiles — with interactive models
          and analysis so you can interpret live CORS measurements.
        </p>
        <TecPrimerBlock />
        {loading && <div className="banner banner-info" style={{ marginTop: "0.75rem" }}>Loading live Zimbabwe VTEC…</div>}
        {error && <div className="banner banner-warn" style={{ marginTop: "0.75rem" }}>{error}</div>}
      </div>

      {/* Graph 1 — VTEC time series */}
      <Section
        title="1 · VTEC time series"
        subtitle="How vertical electron content changes through the observation period (UT hours vs TECU)."
      >
        {stationSeries.length > 0 ? (
          <LineChart
            labels={stationSeries[0].labels}
            xValues={stationSeries[0].epochs}
            epochMs={stationSeries[0].epochs}
            xLabel="UT"
            yLabel="VTEC (TECU)"
            height={220}
            toggleableLegend
            datasets={stationSeries.map((s) => ({
              label: `${s.station.toUpperCase()} VTEC`,
              data: s.values,
              color: s.color,
            }))}
          />
        ) : (
          <div className="banner banner-info">No live station VTEC points yet — use the interactive daily model below.</div>
        )}
        <ChartAnalysisBox
          title="What you should learn"
          block={{
            lead: "Each point is an observation at (time, VTEC). Station colours let you compare CORS sites.",
            bullets: [
              "Peak VTEC is not necessarily the time of maximum solar radiation — production, recombination, transport and electrodynamics all matter.",
              "Inspect peak time, minimum value, station-to-station scatter and abrupt jumps on measured data.",
              "A rise after sunset is not automatically wrong; interpret with location, local time, geomagnetic conditions and data quality.",
            ],
          }}
        />

        <div style={{ marginTop: "0.5rem", padding: "0.75rem", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div className="metric-label" style={{ marginBottom: "0.5rem" }}>Interactive daily VTEC model (illustrative)</div>
          <p className="sw-supporting-text" style={{ margin: "0 0 0.65rem" }}>
            Not measured RINEX output — change peak VTEC, peak time and background to see how the daily curve shape responds.
          </p>
          <div style={{ display: "grid", gap: "0.55rem", marginBottom: "0.75rem" }}>
            <SliderRow label="Peak VTEC" value={peakVtec} min={5} max={80} step={1} unit=" TECU" onChange={setPeakVtec} />
            <SliderRow label="Time of peak" value={peakHour} min={0} max={23} step={1} unit=":00 UT" onChange={setPeakHour} />
            <SliderRow label="Background VTEC" value={background} min={0} max={40} step={1} unit=" TECU" onChange={setBackground} />
          </div>
          <Line
            data={{
              labels: hours.map((h) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`),
              datasets: [{
                label: "Illustrative daily VTEC",
                data: modelCurve,
                borderColor: "#38bdf8",
                backgroundColor: "rgba(56,189,248,0.15)",
                fill: true,
                tension: 0.35,
                pointRadius: 0,
              }],
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { title: { display: true, text: "UT", color: "#94a3b8" }, ticks: { color: "#94a3b8", maxTicksLimit: 12 } },
                y: { title: { display: true, text: "VTEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
              },
            }}
            height={80}
          />
        </div>
      </Section>

      {/* Graph 2 — STEC / VTEC vs elevation */}
      <Section
        title="2 · STEC and VTEC versus satellite elevation"
        subtitle="Left: slant TEC vs elevation. Right: vertical TEC after the mapping function. Low elevation → longer ionospheric path → higher STEC for the same VTEC."
      >
        <div className="sw-double-grid">
          <div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>STEC vs elevation</div>
            <Scatter
              data={{
                datasets: [
                  ...elevScatter.stecDatasets,
                  {
                    label: "Flat-layer STEC ≈ VTEC / sin(E)",
                    data: flatRef,
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
              data={{
                datasets: elevScatter.vtecDatasets.length
                  ? elevScatter.vtecDatasets
                  : [{
                      label: "Measured VTEC",
                      data: [],
                      backgroundColor: "rgba(56,189,248,0.55)",
                      pointRadius: 1.5,
                    }],
              }}
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
        {!elevScatter.stecCount && (
          <div className="banner banner-info">Live STEC/elevation samples are sparse — the interactive thin-shell model below still teaches the geometry.</div>
        )}
        <ChartAnalysisBox
          title="Scientific interpretation"
          block={{
            lead: "The white dashed STEC curve is a simplified flat-layer reference STEC ≈ VTEC_med / sin(E). The notebook’s thin-shell mapping includes Earth curvature, so this is an approximation.",
            bullets: [
              "Different satellites sample different locations and times — points will not fall perfectly on one theoretical curve.",
              `Thin-shell height used here: ${IONO_SHELL_KM} km.`,
              "Mapping factor grows as elevation decreases because the signal path length through the ionosphere increases.",
            ],
          }}
        />

        <div style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div className="metric-label" style={{ marginBottom: "0.5rem" }}>Interactive elevation-angle model</div>
          <div style={{ display: "grid", gap: "0.55rem", marginBottom: "0.65rem" }}>
            <SliderRow label="Elevation" value={modelElev} min={10} max={90} step={1} unit="°" onChange={setModelElev} />
            <SliderRow label="VTEC" value={modelVtec} min={5} max={60} step={1} unit=" TECU" onChange={setModelVtec} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", fontSize: "0.88rem" }}>
            <span>Slant TEC: <strong style={{ color: "#f97316" }}>{modelStec.toFixed(2)} TECU</strong></span>
            <span>Mapping factor M(E): <strong style={{ color: "#7dd3fc" }}>{mapping.toFixed(3)}</strong></span>
            <span>Shell: {IONO_SHELL_KM} km</span>
          </div>
        </div>
      </Section>

      {/* Graph 3 — Skyplot */}
      <Section
        title="3 · Satellite skyplot coloured by VTEC"
        subtitle="Polar view from the receiver: azimuth around the circle, elevation as distance from centre (zenith at centre), VTEC as colour."
      >
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: "1rem", alignItems: "start" }}>
          <div style={{ aspectRatio: "1", position: "relative", border: "1px solid var(--border)", borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.18), transparent 65%)" }}>
            {[30, 60].map((r) => (
              <div key={r} style={{ position: "absolute", inset: `${(100 - r) / 2}%`, border: "1px solid rgba(255,255,255,0.15)", borderRadius: "50%" }} />
            ))}
            {(["N", "E", "S", "W"] as const).map((lab, i) => {
              const pos = [{ top: "2%", left: "50%" }, { top: "50%", left: "96%" }, { top: "96%", left: "50%" }, { top: "50%", left: "4%" }][i];
              return <div key={lab} style={{ position: "absolute", ...pos, transform: "translate(-50%, -50%)", fontSize: "0.7rem", fontWeight: 800 }}>{lab}</div>;
            })}
            {(() => {
              const az = ((skyAz - 90) * Math.PI) / 180;
              const radius = ((90 - skyEl) / 90) * 46;
              const x = 50 + radius * Math.cos(az);
              const y = 50 + radius * Math.sin(az);
              const t = Math.max(0, Math.min(1, (skyVtec - 10) / 25));
              const color = `hsl(${280 - t * 200}, 85%, ${45 + t * 15}%)`;
              return (
                <div
                  title={`Az ${skyAz}° · El ${skyEl}° · ${skyVtec} TECU`}
                  style={{
                    position: "absolute",
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: "translate(-50%, -50%)",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: color,
                    border: "2px solid #fff",
                    boxShadow: "0 0 8px rgba(0,0,0,0.45)",
                  }}
                />
              );
            })()}
          </div>
          <div style={{ display: "grid", gap: "0.55rem" }}>
            <SliderRow label="Satellite azimuth" value={skyAz} min={0} max={359} step={1} unit="°" onChange={setSkyAz} />
            <SliderRow label="Satellite elevation" value={skyEl} min={5} max={90} step={1} unit="°" onChange={setSkyEl} />
            <SliderRow label="VTEC" value={skyVtec} min={5} max={50} step={1} unit=" TECU" onChange={setSkyVtec} />
            <ChartAnalysisBox
              title="How to interpret a skyplot"
              block={{
                lead: "North at top, azimuth clockwise. Radial coordinate is 90° − elevation so zenith is the centre and the horizon is the rim.",
                bullets: [
                  "Colour encodes VTEC for each observation; tracks show how a satellite’s apparent position changes over time.",
                  "Use the skyplot to check whether high/low TEC clusters in particular directions or elevations.",
                  "Fixed colour scales (e.g. 10–35 TECU) clip extremes — a saturated colour does not prove the value equals the scale end.",
                ],
              }}
            />
          </div>
        </div>
      </Section>

      {/* Graph 4 — IPP ground tracks */}
      <Section
        title="4 · Ionospheric pierce-point ground tracks"
        subtitle="Where the satellite–receiver path intersects the modelled ionospheric shell (~350 km). Left coloured by VTEC; right by observation time (illustrative for Zimbabwe)."
      >
        <IppTeachingMap skyAz={skyAz} skyEl={skyEl} skyVtec={skyVtec} hour={peakHour} />
        <ChartAnalysisBox
          title="Why IPP tracks matter"
          block={{
            lead: "A single GNSS station samples the ionosphere over a region, not only directly overhead.",
            bullets: [
              "As satellites move, pierce points trace paths around the receiver — useful for regional electron-content context in Zimbabwe when coverage and calibration are good.",
              "IPP locations depend on the assumed shell height (350 km here).",
              "Live feeds currently emphasise station VTEC; full azi/IPP tracks come from calibrated CMN/RINEX processing — this panel teaches the geometry.",
            ],
          }}
        />
      </Section>

      {/* Graph 5 — Diurnal percentiles */}
      <Section
        title="5 · Diurnal VTEC distribution"
        subtitle="Daily trend plus spread: median with 25–75% and 10–90% percentile bands (half-hour bins)."
      >
        {diurnalLive ? (
          <Line
            data={{
              labels: diurnalLive.bins.map((b) => `${b.toFixed(1)}h`),
              datasets: [
                {
                  label: "10th–90th",
                  data: diurnalLive.p90,
                  borderColor: "transparent",
                  backgroundColor: "rgba(56,189,248,0.12)",
                  fill: "+1",
                  pointRadius: 0,
                },
                {
                  label: "10th",
                  data: diurnalLive.p10,
                  borderColor: "transparent",
                  backgroundColor: "rgba(56,189,248,0.12)",
                  fill: false,
                  pointRadius: 0,
                },
                {
                  label: "25th–75th",
                  data: diurnalLive.p75,
                  borderColor: "transparent",
                  backgroundColor: "rgba(56,189,248,0.22)",
                  fill: "+1",
                  pointRadius: 0,
                },
                {
                  label: "25th",
                  data: diurnalLive.p25,
                  borderColor: "transparent",
                  pointRadius: 0,
                },
                {
                  label: "Median",
                  data: diurnalLive.p50,
                  borderColor: "#38bdf8",
                  backgroundColor: "#38bdf8",
                  fill: false,
                  tension: 0.2,
                  pointRadius: 2,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } } } },
              scales: {
                x: { title: { display: true, text: "UT hour bin", color: "#94a3b8" }, ticks: { color: "#94a3b8", maxTicksLimit: 12 } },
                y: { title: { display: true, text: "VTEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
              },
            }}
            height={90}
          />
        ) : (
          <div>
            <p className="sw-supporting-text">Insufficient live samples for percentiles — illustrative model:</p>
            <Line
              data={{
                labels: hours.filter((_, i) => i % 2 === 0).map((h) => `${h}h`),
                datasets: (() => {
                  const base = diurnalVtecModel(hours.filter((_, i) => i % 2 === 0), pctPeak, pctPeakHour, Math.max(2, pctPeak - 12));
                  return [
                    { label: "10–90%", data: base.map((v) => v + pctSpread * 1.6), borderColor: "transparent", backgroundColor: "rgba(56,189,248,0.12)", fill: "+1", pointRadius: 0 },
                    { label: "10%", data: base.map((v) => v - pctSpread * 1.6), borderColor: "transparent", pointRadius: 0 },
                    { label: "25–75%", data: base.map((v) => v + pctSpread), borderColor: "transparent", backgroundColor: "rgba(56,189,248,0.22)", fill: "+1", pointRadius: 0 },
                    { label: "25%", data: base.map((v) => v - pctSpread), borderColor: "transparent", pointRadius: 0 },
                    { label: "Median", data: base, borderColor: "#38bdf8", pointRadius: 0, tension: 0.3 },
                  ];
                })(),
              }}
              options={{
                responsive: true,
                plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } } } },
                scales: {
                  x: { ticks: { color: "#94a3b8", maxTicksLimit: 10 } },
                  y: { title: { display: true, text: "VTEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
                },
              }}
              height={90}
            />
            <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.65rem" }}>
              <SliderRow label="Peak median VTEC" value={pctPeak} min={8} max={60} step={1} unit=" TECU" onChange={setPctPeak} />
              <SliderRow label="Spread of observations" value={pctSpread} min={1} max={15} step={1} unit=" TECU" onChange={setPctSpread} />
              <SliderRow label="Peak time" value={pctPeakHour} min={0} max={23} step={1} unit=":00 UT" onChange={setPctPeakHour} />
            </div>
          </div>
        )}
        <ChartAnalysisBox
          title="Reading percentile bands"
          block={{
            lead: "The 50th percentile is the median. Wide bands mean satellite-derived VTEC values differ a lot inside that time bin.",
            bullets: [
              "Spread can reflect real spatial structure, temporal variability, measurement error or uneven satellite coverage.",
              "A wide band alone does not prove the ionosphere is disturbed or that calibration failed.",
              "Half-hour bins (round hour×2 / 2) match the notebook grouping approach.",
            ],
          }}
        />
      </Section>

      {/* Exercise */}
      <Section
        title="6 · Exercise — Satellite elevation and TEC"
        subtitle="A receiver measures STEC = 60 TECU at 30° elevation. Thin shell at 350 km, Earth radius 6,371 km."
      >
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Mapping function: M(E) = [1 − ((R<sub>E</sub>/(R<sub>E</sub>+h)) cos E)²]<sup>−1/2</sup>
          {" "}→ VTEC = STEC / M(E)
        </p>
        <p style={{ fontSize: "0.85rem", margin: "0.35rem 0 0.75rem" }}>
          Calculate vertical TEC for STEC = {EXERCISE_STEC_TECU} TECU at E = {EXERCISE_ELEVATION_DEG}°:
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {quizOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              className="btn"
              onClick={() => { setQuizChoice(opt); setQuizChecked(false); }}
              style={{
                border: `1px solid ${quizChoice === opt ? "var(--accent)" : "var(--border)"}`,
                background: quizChoice === opt ? "rgba(22,139,210,0.25)" : "var(--surface)",
              }}
            >
              {opt.toFixed(1)} TECU
            </button>
          ))}
        </div>
        <div style={{ marginTop: "0.65rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={quizChoice == null} onClick={() => setQuizChecked(true)}>
            Check answer
          </button>
          {quizChecked && quizChoice != null && (
            <span style={{ fontSize: "0.88rem", color: quizCorrect ? "#22c55e" : "#f97316", fontWeight: 700 }}>
              {quizCorrect
                ? `Correct — VTEC ≈ ${EXERCISE_CORRECT_VTEC} TECU (M≈${thinShellMappingFactor(EXERCISE_ELEVATION_DEG).toFixed(3)}).`
                : `Not quite. Hint: M(30°)≈${thinShellMappingFactor(EXERCISE_ELEVATION_DEG).toFixed(3)}, so VTEC = ${EXERCISE_STEC_TECU}/M ≈ ${vtecFromStec(EXERCISE_STEC_TECU, EXERCISE_ELEVATION_DEG).toFixed(1)} TECU.`}
            </span>
          )}
        </div>
        <ChartAnalysisBox
          title="Analysis tip"
          block={{
            lead: "Always convert STEC to VTEC with a documented mapping function before comparing sites or times.",
            bullets: [
              "Low-elevation STEC is larger for the same vertical content — never compare raw STEC across elevations without mapping.",
              "Thin-shell height (often 350 km) is an assumption; changing h changes M(E) slightly.",
              "Apply the same mapping consistently when you move from notebook exercises to Zimbabwe CORS products.",
            ],
          }}
        />
      </Section>
    </div>
  );
}

/** Simple Zimbabwe-centred IPP teaching map (illustrative geometry). */
function IppTeachingMap({
  skyAz,
  skyEl,
  skyVtec,
  hour,
}: {
  skyAz: number;
  skyEl: number;
  skyVtec: number;
  hour: number;
}) {
  // Approximate IPP offset from receiver (Harare ~31.05E, 17.83S) using elevation.
  const recvLon = 31.05;
  const recvLat = -17.83;
  const rangeKm = Math.max(20, (90 - skyEl) * 12);
  const dLon = (rangeKm / 111) * Math.sin((skyAz * Math.PI) / 180);
  const dLat = (rangeKm / 111) * Math.cos((skyAz * Math.PI) / 180);
  const ippLon = recvLon + dLon;
  const ippLat = recvLat + dLat;

  const project = (lon: number, lat: number) => {
    const x = ((lon - 24) / (40 - 24)) * 100;
    const y = ((-10 - lat) / (-10 - (-26))) * 100;
    return { x: Math.max(4, Math.min(96, x)), y: Math.max(4, Math.min(96, y)) };
  };
  const recv = project(recvLon, recvLat);
  const ipp = project(ippLon, ippLat);
  const t = Math.max(0, Math.min(1, (skyVtec - 10) / 25));
  const vtecColor = `hsl(${280 - t * 200}, 85%, 55%)`;
  const hourColor = `hsl(${(hour / 24) * 300}, 70%, 55%)`;

  const Panel = ({ title, color }: { title: string; color: string }) => (
    <div>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 6 }}>{title}</div>
      <div style={{ position: "relative", height: 200, border: "1px solid var(--border)", borderRadius: 8, background: "#071422" }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <text x="2" y="8" fill="#64748b" fontSize="3.2">26°S</text>
          <text x="2" y="96" fill="#64748b" fontSize="3.2">10°S</text>
          <text x="2" y="98" fill="#64748b" fontSize="3">24°E</text>
          <text x="88" y="98" fill="#64748b" fontSize="3">40°E</text>
          <circle cx={recv.x} cy={recv.y} r="1.8" fill="#94a3b8" />
          <line x1={recv.x} y1={recv.y} x2={ipp.x} y2={ipp.y} stroke="rgba(148,163,184,0.45)" strokeWidth="0.4" strokeDasharray="1 1" />
          <circle cx={ipp.x} cy={ipp.y} r="2.4" fill={color} stroke="#fff" strokeWidth="0.35" />
        </svg>
        <div style={{ position: "absolute", left: 8, bottom: 6, fontSize: "0.68rem", color: "#94a3b8" }}>
          Receiver · IPP {ippLat.toFixed(2)}°, {ippLon.toFixed(2)}°
        </div>
      </div>
    </div>
  );

  return (
    <div className="sw-double-grid">
      <Panel title="IPP coloured by VTEC" color={vtecColor} />
      <Panel title="IPP coloured by observation hour" color={hourColor} />
    </div>
  );
}
