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
import LineChart from "@/components/charts/LineChart";
import { getLiveVtec, getLiveVtecByStation, getStations } from "@/lib/api";
import { formatKnmiUtcTick, sharedTimeDomain, utcTimeAxisProps } from "@/lib/chartTimeAxis";
import {
  diurnalPercentilesFullDay,
  flatLayerStec,
  hourOfDayUtc,
} from "@/lib/tecTeachingMath";
import type { LiveObservation, LiveStationVtecSeries, Station } from "@/lib/types";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const STATION_COLORS = ["#38bdf8", "#fbbf24", "#a78bfa", "#34d399", "#f97316", "#f472b6", "#22d3ee", "#fb7185"];
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

export default function ZimbabweTecTeachingLab() {
  const [stations, setStations] = useState<LiveStationVtecSeries[]>([]);
  const [obs, setObs] = useState<LiveObservation[]>([]);
  const [catalog, setCatalog] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      getLiveVtecByStation(24, 15, 90_000),
      getLiveVtec(2, undefined, 90_000, 6000),
      getStations(),
    ]).then(([st, live, cat]) => {
      if (cancelled) return;
      if (st.status === "fulfilled") setStations(Array.isArray(st.value) ? st.value : []);
      if (live.status === "fulfilled") setObs(Array.isArray(live.value) ? live.value : []);
      if (cat.status === "fulfilled") setCatalog(Array.isArray(cat.value) ? cat.value : []);
      const fails = [st, live].filter((r) => r.status === "rejected").length;
      setError(fails === 2 ? "Live CORS VTEC feeds unavailable right now." : null);
      setUpdatedAt(new Date().toISOString());
      setLoading(false);
    });
    const unlock = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(unlock);
    };
  }, []);

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
    // Supplement with live observation samples for denser coverage
    for (const o of obs) {
      if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
      const h = hourOfDayUtc(o.time);
      if (h == null) continue;
      hoursArr.push(h);
      vals.push(o.vtec_tecu);
    }
    if (hoursArr.length < 8) return null;
    const fan = diurnalPercentilesFullDay(hoursArr, vals, { maxVtec: 70 });
    const hasAny = fan.p50.some((v) => v != null);
    if (!hasAny) return null;

    // VEq (zenith): median of high-elevation live samples per half-hour bin
    const veqBuckets = new Map<number, number[]>();
    for (const o of obs) {
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
    const veq = fan.hours.map((h) => {
      const arr = veqBuckets.get(h);
      if (!arr?.length) return null;
      const sorted = arr.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    });

    return { ...fan, veq };
  }, [stations, obs]);

  const constellationSeries = useMemo(() => {
    const byConst = new Map<string, { x: number; y: number }[]>();
    for (const o of obs) {
      if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
      const ms = Date.parse(o.time);
      if (!Number.isFinite(ms)) continue;
      const key = (o.constellation || "UNK").toUpperCase();
      const arr = byConst.get(key) ?? [];
      arr.push({ x: ms, y: o.vtec_tecu });
      byConst.set(key, arr);
    }
    return [...byConst.entries()].map(([label, pts], i) => {
      const step = Math.max(1, Math.floor(pts.length / 600));
      return {
        label,
        data: pts.filter((_, idx) => idx % step === 0),
        backgroundColor: CONST_COLORS[label.charAt(0)] ?? STATION_COLORS[i % STATION_COLORS.length],
        pointRadius: 1.3,
      };
    });
  }, [obs]);

  const stationMap = useMemo(() => {
    const byCode = new Map(catalog.map((s) => [s.code.toLowerCase(), s]));
    return stationSeries
      .map((s) => {
        const meta = byCode.get(s.station.toLowerCase());
        if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lon)) return null;
        const vtec = s.latest ?? s.mean;
        if (vtec == null || !Number.isFinite(vtec)) return null;
        return { code: s.station.toUpperCase(), lat: meta.lat, lon: meta.lon, vtec, color: s.color };
      })
      .filter(Boolean) as { code: string; lat: number; lon: number; vtec: number; color: string }[];
  }, [catalog, stationSeries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card">
        <div className="metric-label" style={{ marginBottom: "0.35rem" }}>Live CORS ionosphere graphs</div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Zimbabwe CORS NTRIP VTEC / STEC from the live pipeline — station timelines, elevation geometry,
          constellation samples, station map, and diurnal distribution.
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
        title="1 · Live VTEC time series"
        subtitle="Vertical TEC vs UT from Zimbabwe CORS stations (live NTRIP pipeline)."
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
        title="2 · Live STEC and VTEC versus elevation"
        subtitle="Slant and vertical TEC from live CORS observations. Dashed curve: STEC ≈ median(VTEC) / sin(E)."
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
        title="3 · Live VTEC by constellation"
        subtitle="Live CORS samples coloured by GNSS constellation (GPS / GLONASS / Galileo / BeiDou)."
      >
        {constellationSeries.length > 0 ? (
          <Scatter
            data={{ datasets: constellationSeries }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 10, font: { size: 10 } } } },
              scales: {
                x: {
                  type: "linear",
                  title: { display: true, text: "UT", color: "#94a3b8" },
                  ticks: {
                    color: "#94a3b8",
                    maxTicksLimit: 8,
                    callback: (v) => formatKnmiUtcTick(Number(v)),
                  },
                },
                y: { title: { display: true, text: "VTEC (TECU)", color: "#94a3b8" }, ticks: { color: "#94a3b8" } },
              },
            }}
            height={120}
          />
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for constellation samples…" : "No live constellation VTEC samples yet."}
          </div>
        )}
      </Section>

      <Section
        title="4 · Live CORS stations by VTEC"
        subtitle="Station locations coloured by latest live VTEC from the CORS network."
      >
        {stationMap.length > 0 ? (
          <CorsVtecMap points={stationMap} />
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for station coordinates and VTEC…" : "No stations with both coordinates and live VTEC."}
          </div>
        )}
      </Section>

      <Section
        title="Diurnal VTEC distribution — Live CORS"
        subtitle="UT [hours] 0–24 · live Zimbabwe CORS VTEC · 10–90th and 25–75th percentile bands, median, and VEq (zenith, elev ≥ 60°)."
      >
        {diurnalLive ? (
          <div style={{ background: "#0b1220", borderRadius: 8, padding: "0.65rem 0.5rem 0.35rem", height: 340 }}>
            <DiurnalFanChart
              hours={diurnalLive.hours}
              p10={diurnalLive.p10}
              p25={diurnalLive.p25}
              p50={diurnalLive.p50}
              p75={diurnalLive.p75}
              p90={diurnalLive.p90}
              veq={diurnalLive.veq}
            />
          </div>
        ) : (
          <div className="banner banner-info">
            {loading ? "Waiting for diurnal live samples…" : "Not enough live VTEC points yet for percentile bands."}
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

function DiurnalFanChart({
  hours,
  p10,
  p25,
  p50,
  p75,
  p90,
  veq,
}: {
  hours: number[];
  p10: (number | null)[];
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  p90: (number | null)[];
  veq: (number | null)[];
}) {
  return (
    <Line
      data={{
        datasets: [
          {
            label: "10-90th pct",
            data: xy(hours, p90),
            borderColor: "transparent",
            backgroundColor: "rgba(37, 99, 180, 0.38)",
            fill: "+1",
            pointRadius: 0,
            tension: 0.3,
            spanGaps: false,
            order: 4,
          },
          {
            label: "p10",
            data: xy(hours, p10),
            borderColor: "transparent",
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            spanGaps: false,
            order: 4,
          },
          {
            label: "25-75th pct",
            data: xy(hours, p75),
            borderColor: "transparent",
            backgroundColor: "rgba(56, 160, 230, 0.45)",
            fill: "+1",
            pointRadius: 0,
            tension: 0.3,
            spanGaps: false,
            order: 3,
          },
          {
            label: "p25",
            data: xy(hours, p25),
            borderColor: "transparent",
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            spanGaps: false,
            order: 3,
          },
          {
            label: "Median VTEC",
            data: xy(hours, p50),
            borderColor: "#3b9eff",
            backgroundColor: "#3b9eff",
            borderWidth: 2.5,
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            spanGaps: false,
            order: 2,
          },
          {
            label: "VEq (zenith)",
            data: xy(hours, veq),
            borderColor: "#e8eef7",
            backgroundColor: "#e8eef7",
            borderWidth: 1.6,
            borderDash: [6, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            spanGaps: false,
            order: 1,
          },
        ],
      }}
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
              filter: (item) => !["p10", "p25"].includes(String(item.text)),
            },
          },
          title: {
            display: true,
            text: "Diurnal VTEC distribution — Live CORS",
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

function CorsVtecMap({
  points,
}: {
  points: { code: string; lat: number; lon: number; vtec: number; color: string }[];
}) {
  const lonMin = 24;
  const lonMax = 34;
  const latMin = -23;
  const latMax = -15.5;
  const project = (lon: number, lat: number) => ({
    x: ((lon - lonMin) / (lonMax - lonMin)) * 100,
    y: ((latMax - lat) / (latMax - latMin)) * 100,
  });
  const vmax = Math.max(...points.map((p) => p.vtec), 1);
  const vmin = Math.min(...points.map((p) => p.vtec), 0);

  return (
    <div style={{ position: "relative", height: 280, border: "1px solid var(--border)", borderRadius: 8, background: "#071422", overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <text x="2" y="6" fill="#64748b" fontSize="3.2">{latMax.toFixed(1)}°S</text>
        <text x="2" y="98" fill="#64748b" fontSize="3.2">{Math.abs(latMin).toFixed(1)}°S</text>
        <text x="2" y="99.5" fill="#64748b" fontSize="2.8">{lonMin}°E</text>
        <text x="88" y="99.5" fill="#64748b" fontSize="2.8">{lonMax}°E</text>
        {points.map((p) => {
          const { x, y } = project(p.lon, p.lat);
          const t = vmax === vmin ? 0.5 : (p.vtec - vmin) / (vmax - vmin);
          const fill = `hsl(${210 - t * 160}, 85%, ${45 + t * 15}%)`;
          return (
            <g key={p.code}>
              <circle cx={x} cy={y} r="1.8" fill={fill} stroke="#fff" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
              <text x={Math.min(x + 2.2, 88)} y={y + 1} fill="#cbd5e1" fontSize="2.3">{p.code} {p.vtec.toFixed(1)}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", left: 8, bottom: 6, fontSize: "0.7rem", color: "#94a3b8" }}>
        Latest live VTEC (TECU) · {points.length} stations
      </div>
    </div>
  );
}
