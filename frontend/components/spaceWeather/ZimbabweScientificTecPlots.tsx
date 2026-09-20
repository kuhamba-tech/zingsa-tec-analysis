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
import { Line, Scatter } from "react-chartjs-2";
import { getZimbabweScientificPlots } from "@/lib/api";
import { getLoadProfile } from "@/lib/loadBudget";
import type { SciPercentileSeries, ZimbabweScientificPlotsResponse } from "@/lib/types";
import { ZIMBABWE_LAT_BANDS } from "@/lib/zimbabweLatBands";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);
ChartJS.defaults.color = "#ffffff";

const QUIET_COLOR = "#0ea5e9";
const DIST_COLOR = "#dc2626";
const SEASON_COLORS: Record<string, string> = {
  mar_equinox: "#2563eb",
  jun_solstice: "#ca8a04",
  sep_equinox: "#16a34a",
  dec_solstice: "#7c3aed",
};

function ribbonDatasets(
  hours: number[],
  series: SciPercentileSeries,
  color: string,
  label: string,
) {
  const fill = color.startsWith("#")
    ? `${color}33`
    : color;
  return [
    {
      label: `${label} IQR`,
      data: hours.map((h, i) => ({ x: h, y: series.p75[i] })),
      borderColor: "transparent",
      backgroundColor: fill,
      fill: "+1",
      pointRadius: 0,
      tension: 0.25,
      order: 2,
    },
    {
      label: `${label} p25`,
      data: hours.map((h, i) => ({ x: h, y: series.p25[i] })),
      borderColor: "transparent",
      backgroundColor: "transparent",
      fill: false,
      pointRadius: 0,
      order: 2,
    },
    {
      label,
      data: hours.map((h, i) => ({ x: h, y: series.p50[i] })),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2.2,
      pointRadius: 3.5,
      tension: 0.25,
      spanGaps: false,
      order: 1,
    },
  ];
}

function PlotCard({
  title,
  subtitle,
  uncertainty,
  note,
  children,
  empty,
}: {
  title: string;
  subtitle: string;
  uncertainty?: string;
  note?: string;
  children: ReactNode;
  empty?: string | null;
}) {
  return (
    <section
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}
    >
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>{title}</div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>{subtitle}</p>
      </div>
      {empty ? (
        <div className="banner banner-info">{empty}</div>
      ) : (
        <div style={{ background: "#0a1929", borderRadius: 8, padding: "0.55rem 0.45rem 0.25rem", height: 300 }}>
          {children}
        </div>
      )}
      {uncertainty && (
        <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
          Uncertainty: {uncertainty}
        </p>
      )}
      {note && (
        <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>{note}</p>
      )}
    </section>
  );
}

const axisOpts = {
  xColor: "#ffffff",
  yColor: "#ffffff",
  tick: "#ffffff",
  title: "#ffffff",
};

export default function ZimbabweScientificTecPlots() {
  const [data, setData] = useState<ZimbabweScientificPlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      const profile = getLoadProfile();
      const hours = profile.constrained ? 18 : 24;
      getZimbabweScientificPlots(hours, profile.constrained ? 20 : 15, profile.constrained ? 60_000 : 90_000)
        .then((payload) => {
          if (cancelled) return;
          setData(payload);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Scientific TEC plots unavailable");
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

  const diurnal = data?.diurnal_latband;
  const seasonal = data?.seasonal;
  const transect = data?.modip_transect;
  const qd = data?.quiet_disturbed;

  const diurnalDatasets = useMemo(() => {
    if (!diurnal) return [];
    return ZIMBABWE_LAT_BANDS.flatMap((b) =>
      ribbonDatasets(diurnal.hours, diurnal[b.id], b.color, b.label),
    );
  }, [diurnal]);

  const seasonalDatasets = useMemo(() => {
    if (!seasonal?.seasons) return [];
    return seasonal.seasons
      .filter((s) => s.available)
      .flatMap((s) =>
        ribbonDatasets(
          s.hours,
          { p50: s.p50, p25: s.p25, p75: s.p75, n: s.n },
          SEASON_COLORS[s.id] ?? "#64748b",
          s.label,
        ),
      );
  }, [seasonal]);

  const transectScatter = useMemo(() => {
    if (!transect?.points?.length) return null;
    const pts = transect.points.map((p) => ({
      x: p.modip_deg,
      y: p.vtec_mean,
      station: p.name,
      lo: p.vtec_p25,
      hi: p.vtec_p75,
    }));
    const errLow = transect.points.map((p) => ({
      x: p.modip_deg,
      y: p.vtec_p25,
    }));
    const errHigh = transect.points.map((p) => ({
      x: p.modip_deg,
      y: p.vtec_p75,
    }));
    const datasets: object[] = [
      {
        label: "IQR high",
        data: errHigh,
        showLine: false,
        pointRadius: 0,
        backgroundColor: "transparent",
      },
      {
        label: "Station IQR",
        data: errLow,
        showLine: false,
        pointRadius: 0,
        backgroundColor: "rgba(37, 99, 235, 0.2)",
        fill: "-1",
      },
      {
        label: "Station mean VTEC",
        data: pts,
        backgroundColor: "#2563eb",
        borderColor: "#2563eb",
        pointRadius: 5,
        showLine: false,
      },
    ];
    if (transect.regression) {
      const xs = transect.points.map((p) => p.modip_deg);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const { slope_tecu_per_deg: m, intercept_tecu: b } = transect.regression;
      datasets.push({
        label: `Fit (R²=${transect.regression.r2.toFixed(2)})`,
        data: [
          { x: minX, y: m * minX + b },
          { x: maxX, y: m * maxX + b },
        ],
        showLine: true,
        borderColor: "#64748b",
        backgroundColor: "#64748b",
        borderDash: [5, 4],
        pointRadius: 0,
        borderWidth: 1.5,
      });
    }
    return datasets;
  }, [transect]);

  const qdDatasets = useMemo(() => {
    if (!qd) return [];
    return [
      ...ribbonDatasets(qd.hours, qd.quiet, QUIET_COLOR, `Quiet (Kp < ${qd.kp_threshold})`),
      ...ribbonDatasets(qd.hours, qd.disturbed, DIST_COLOR, `Disturbed (Kp ≥ ${qd.kp_threshold})`),
    ];
  }, [qd]);

  const lineOpts = (xLabel: string, yLabel = "VTEC [TECU]") => ({
    responsive: true,
    maintainAspectRatio: false,
    color: "#ffffff",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: "#ffffff",
          boxWidth: 10,
          font: { size: 10 },
          filter: (item: { text?: string }) =>
            !!(item.text && !item.text.endsWith("p25") && !item.text.endsWith("IQR") && item.text !== "IQR high" && item.text !== "Station IQR"),
        },
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
        title: { display: true, text: xLabel, color: axisOpts.xColor },
        ticks: { color: axisOpts.tick },
        grid: { color: "rgba(148,163,184,0.28)", borderDash: [4, 4] },
      },
      y: {
        min: 0,
        title: { display: true, text: yLabel, color: axisOpts.yColor },
        ticks: { color: axisOpts.tick },
        grid: { color: "rgba(148,163,184,0.28)", borderDash: [4, 4] },
      },
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="card">
        <div className="metric-label" style={{ marginBottom: 4 }}>
          Scientific TEC analysis — four observation-based plots
        </div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          Diurnal latitudinal comparison, equinox/solstice seasonal composites, TEC versus
          approximate MODIP along the Zimbabwe north–south CORS transect, and quiet versus
          disturbed geomagnetic conditions. Shaded ribbons are interquartile ranges (25th–75th
          percentile) from measured samples — not arbitrary error bars.
        </p>
        {loading && (
          <p className="sw-supporting-text" style={{ margin: "0.5rem 0 0" }}>
            Computing scientific plots from live CORS + CMN archive…
          </p>
        )}
        {error && <div className="banner banner-warn" style={{ marginTop: "0.55rem" }}>{error}</div>}
        {data?.integrity?.seasonal_archive_limited && (
          <div className="banner banner-info" style={{ marginTop: "0.55rem" }}>
            Seasonal archive currently covers Apr–Jun 2024 CMN hours (four stations). September
            equinox and December solstice windows are unavailable until more months are archived.
          </div>
        )}
      </div>

      <PlotCard
        title="1 · Diurnal TEC — northern / central / southern Zimbabwe"
        subtitle="Median VTEC by UT hour with IQR bands from live CORS stations in each latitude band."
        uncertainty={diurnal?.uncertainty}
        note={diurnal?.note}
        empty={
          !diurnal || diurnal.sample_count === 0
            ? loading
              ? "Waiting for live station VTEC…"
              : "No live VTEC samples for latitudinal diurnal bands."
            : null
        }
      >
        <Line
          data={{ datasets: diurnalDatasets }}
          options={{
            ...lineOpts("UT [hours]"),
            scales: {
              ...lineOpts("UT [hours]").scales,
              x: {
                ...lineOpts("UT [hours]").scales.x,
                min: 0,
                max: 23,
                ticks: { ...lineOpts("UT [hours]").scales.x.ticks, stepSize: 3 },
              },
            },
          }}
        />
      </PlotCard>

      <PlotCard
        title="2 · Seasonal TEC — equinox & solstice windows"
        subtitle="Diurnal composites within ±15 days of March equinox, June solstice, September equinox, and December solstice (CMN archive)."
        uncertainty={seasonal?.uncertainty}
        note={seasonal?.note}
        empty={
          !seasonal?.available
            ? loading
              ? "Loading CMN seasonal archive…"
              : "No equinox/solstice archive windows available yet."
            : null
        }
      >
        <Line
          data={{ datasets: seasonalDatasets }}
          options={{
            ...lineOpts("UT [hours]"),
            scales: {
              ...lineOpts("UT [hours]").scales,
              x: {
                ...lineOpts("UT [hours]").scales.x,
                min: 0,
                max: 23,
                ticks: { ...lineOpts("UT [hours]").scales.x.ticks, stepSize: 3 },
              },
            },
          }}
        />
      </PlotCard>
      {seasonal?.seasons?.length ? (
        <div className="sw-supporting-text" style={{ marginTop: "-0.35rem", fontSize: "0.75rem" }}>
          {seasonal.seasons.map((s) => (
            <div key={s.id}>
              <strong>{s.label}:</strong>{" "}
              {s.available
                ? `${s.sample_count.toLocaleString()} hourly samples · ${s.stations.join(", ")} · ${s.date_start?.slice(0, 10)} → ${s.date_end?.slice(0, 10)}${s.partial ? " · partial edge coverage" : ""}`
                : s.note || "unavailable"}
            </div>
          ))}
        </div>
      ) : null}

      <PlotCard
        title="3 · TEC versus geomagnetic latitude (N–S transect)"
        subtitle="Station-mean live VTEC vs approximate MODIP (geographic lat − 5° Africa offset). Whiskers show per-station IQR."
        uncertainty={transect?.uncertainty}
        note={transect?.note}
        empty={
          !transect?.points?.length
            ? loading
              ? "Waiting for transect stations…"
              : "No live stations available for the MODIP transect."
            : null
        }
      >
        {transectScatter ? (
          <Scatter
            data={{ datasets: transectScatter as never }}
            options={{
              ...lineOpts("Approximate MODIP μ [°]"),
              plugins: {
                ...lineOpts("Approximate MODIP μ [°]").plugins,
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const raw = ctx.raw as { station?: string; y?: number; lo?: number; hi?: number } | undefined;
                      if (raw?.station) {
                        const y = ctx.parsed.y;
                        const x = ctx.parsed.x;
                        if (y == null || x == null) return `${raw.station}: —`;
                        return `${raw.station}: ${y.toFixed(1)} TECU (IQR ${raw.lo?.toFixed(1)}–${raw.hi?.toFixed(1)}) @ μ=${x.toFixed(1)}°`;
                      }
                      const y = ctx.parsed.y;
                      return `${ctx.dataset.label}: ${y == null ? "—" : Number(y).toFixed(1)} TECU`;
                    },
                  },
                },
              },
            }}
          />
        ) : null}
      </PlotCard>
      {transect?.modip_model && (
        <p className="sw-supporting-text" style={{ marginTop: "-0.35rem", fontSize: "0.75rem" }}>
          {transect.modip_model.description}
          {transect.regression
            ? ` · Linear fit slope ${transect.regression.slope_tecu_per_deg} TECU/° (R²=${transect.regression.r2}).`
            : ""}
        </p>
      )}

      <PlotCard
        title="4 · TEC variability — geomagnetically quiet vs disturbed"
        subtitle={`Composite diurnal VTEC when nearest NOAA Kp is quiet (Kp < ${qd?.kp_threshold ?? 3}) versus disturbed (Kp ≥ ${qd?.kp_threshold ?? 3}).`}
        uncertainty={qd?.uncertainty}
        note={qd?.note}
        empty={
          !qd?.available
            ? loading
              ? "Aligning live VTEC with Kp…"
              : "Need overlapping live VTEC and Kp to build quiet/disturbed composites."
            : null
        }
      >
        <Line
          data={{ datasets: qdDatasets }}
          options={{
            ...lineOpts("UT [hours]"),
            scales: {
              ...lineOpts("UT [hours]").scales,
              x: {
                ...lineOpts("UT [hours]").scales.x,
                min: 0,
                max: 23,
                ticks: { ...lineOpts("UT [hours]").scales.x.ticks, stepSize: 3 },
              },
            },
          }}
        />
      </PlotCard>
    </div>
  );
}
