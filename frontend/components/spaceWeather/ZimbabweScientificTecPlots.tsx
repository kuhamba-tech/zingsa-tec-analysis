"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
ChartJS.defaults.animation = false;

const QUIET_COLOR = "#0ea5e9";
const DIST_COLOR = "#dc2626";
const SEASON_PANELS = [
  { id: "mar_equinox", title: "March-Equinox" },
  { id: "jun_solstice", title: "June-Solstice" },
  { id: "sep_equinox", title: "September-Equinox" },
  { id: "dec_solstice", title: "December-Solstice" },
] as const;

const GPS_TEC_COLOR = "#5b7cfa";

function archiveYearLabel(start: unknown, end: unknown): string {
  const years = [start, end]
    .filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
    .map((value) => value.slice(0, 4));
  const unique = [...new Set(years)].sort();
  return unique.join("–");
}

type PlotsPart = "climatology" | "research" | "all";

let plotCache: { key: string; data: ZimbabweScientificPlotsResponse; at: number } | null = null;
let plotInflight: { key: string; promise: Promise<ZimbabweScientificPlotsResponse> } | null = null;

function loadScientificPlots(
  hours: number,
  resampleMinutes: number,
  timeoutMs: number,
  day: string | null,
) {
  const key = `${hours}|${resampleMinutes}|${day ?? ""}`;
  if (plotCache && plotCache.key === key && Date.now() - plotCache.at < 120_000) {
    return Promise.resolve(plotCache.data);
  }
  if (plotInflight?.key === key) return plotInflight.promise;
  const promise = getZimbabweScientificPlots(hours, resampleMinutes, timeoutMs, day)
    .then((data) => {
      plotCache = { key, data, at: Date.now() };
      return data;
    })
    .finally(() => {
      if (plotInflight?.key === key) plotInflight = null;
    });
  plotInflight = { key, promise };
  return promise;
}

function sharedSeasonYMax(
  seasons: ZimbabweScientificPlotsResponse["seasonal"]["seasons"] | undefined,
): number {
  let max = 0;
  for (const season of seasons ?? []) {
    for (const value of season.p50) {
      if (value != null && Number.isFinite(value) && value > max) max = value;
    }
  }
  if (max <= 0) return 40;
  return Math.max(20, Math.ceil(max / 10) * 10);
}

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
      spanGaps: false,
      order: 2,
    },
    {
      label: `${label} p25`,
      data: hours.map((h, i) => ({ x: h, y: series.p25[i] })),
      borderColor: "transparent",
      backgroundColor: "transparent",
      fill: false,
      pointRadius: 0,
      spanGaps: false,
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

function seasonPanelOptions(yMax: number) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    color: "#ffffff",
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        align: "start" as const,
        labels: {
          color: "#ffffff",
          boxWidth: 28,
          boxHeight: 2,
          font: { size: 11 },
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => {
            const y = ctx.parsed.y;
            if (y == null || !Number.isFinite(y)) return "GPS-TEC: —";
            return `GPS-TEC: ${y.toFixed(1)} TECU`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear" as const,
        min: 0,
        max: 23,
        title: { display: true, text: "Hour (UT)", color: "#ffffff" },
        ticks: {
          color: "#ffffff",
          stepSize: 2,
          autoSkip: false,
          maxRotation: 0,
          callback: (value: number | string) => {
            const hour = Number(value);
            return Number.isInteger(hour) && hour % 2 === 0 && hour <= 22 ? String(hour) : "";
          },
        },
        grid: { color: "rgba(148,163,184,0.35)" },
      },
      y: {
        min: 0,
        max: yMax,
        title: { display: true, text: "VTEC (TECU)", color: "#ffffff" },
        ticks: { color: "#ffffff", stepSize: yMax > 40 ? 10 : 5 },
        grid: { color: "rgba(148,163,184,0.35)" },
      },
    },
  };
}

function dayButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,0.45)",
    background: active ? "rgba(14,165,233,0.22)" : "transparent",
    color: "#ffffff",
    borderRadius: 6,
    padding: "0.15rem 0.45rem",
    fontSize: "0.75rem",
    cursor: "pointer",
  };
}

export default function ZimbabweScientificTecPlots({ part = "all" }: { part?: PlotsPart }) {
  const showClimatology = part !== "research";
  const showResearch = part !== "climatology";
  const [data, setData] = useState<ZimbabweScientificPlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      const profile = getLoadProfile();
      const hours = profile.constrained ? 18 : 24;
      const resample = profile.constrained ? 20 : 15;
      if (showClimatology && !showResearch) {
        getZimbabweScientificPlots(hours, resample, 20_000, null, true)
          .then((payload) => {
            if (cancelled || !payload?.seasonal) return;
            setData(payload);
            setError(null);
            loadScientificPlots(hours, resample, profile.constrained ? 60_000 : 90_000, selectedDay)
              .then((full) => {
                if (!cancelled && full?.diurnal_latband) setData(full);
              })
              .catch(() => {
                /* Seasonal panels stay on the archive curves. */
              });
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            setError(err instanceof Error ? err.message : "Seasonal TEC archive unavailable");
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return;
      }
      loadScientificPlots(hours, resample, profile.constrained ? 60_000 : 90_000, selectedDay)
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
  }, [selectedDay, showClimatology, showResearch]);

  const diurnal = data?.diurnal_latband;
  const seasonal = data?.seasonal;
  const seasonalYears = archiveYearLabel(seasonal?.archive?.first_date, seasonal?.archive?.last_date);
  const transect = data?.modip_transect;
  const qd = data?.quiet_disturbed;

  const diurnalDatasets = useMemo(() => {
    if (!diurnal) return [];
    return ZIMBABWE_LAT_BANDS.flatMap((b) =>
      ribbonDatasets(diurnal.hours, diurnal[b.id], b.color, b.label),
    );
  }, [diurnal]);

  const seasonYMax = useMemo(() => sharedSeasonYMax(seasonal?.seasons), [seasonal]);
  const seasonById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof seasonal>["seasons"][number]>();
    for (const season of seasonal?.seasons ?? []) map.set(season.id, season);
    return map;
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
    animation: false as const,
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
          {showClimatology
            ? "Diurnal and seasonal TEC"
            : "TEC versus latitude and geomagnetic activity"}
        </div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          {showClimatology
            ? "Northern, central, and southern Zimbabwe diurnal VTEC, then the four equinox and solstice diurnal panels. GPS-TEC is the measured median. RBF and IRI-2020 are not drawn because those model series are not in the archive. Read the hour of the peak and which band is highest from the measurements. A seasonal change in the daytime peak is the EUV climate. A storm sentence still needs Kp, Dst and southward Bz on that day."
            : "Station-mean VTEC along the Zimbabwe north–south transect, and quiet versus disturbed diurnal composites. Shaded ribbons are interquartile ranges from measured samples. Quiet is Kp below the threshold and disturbed is Kp at or above it. The gap between those two curves is the local storm departure, not the ordinary noon rise."}
        </p>
        {showClimatology && (data?.logged_days?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.55rem" }}>
            <button
              type="button"
              className="sw-supporting-text"
              onClick={() => setSelectedDay(null)}
              style={dayButtonStyle(selectedDay == null)}
            >
              Latest window
            </button>
            {data?.logged_days?.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                style={dayButtonStyle(selectedDay === day)}
              >
                {day}
              </button>
            ))}
          </div>
        )}
        {loading && (
          <p className="sw-supporting-text" style={{ margin: "0.5rem 0 0" }}>
            Computing scientific plots from live CORS + CMN archive…
          </p>
        )}
        {error && !seasonal?.available && (
          <div className="banner banner-warn" style={{ marginTop: "0.55rem" }}>{error}</div>
        )}
        {showClimatology && data?.integrity?.seasonal_archive_limited && (
          <div className="banner banner-info" style={{ marginTop: "0.55rem" }}>
            Seasonal archive currently covers Apr–Jun 2024 CMN hours (four stations). September
            equinox and December solstice windows are unavailable until more months are archived.
          </div>
        )}
      </div>

      {showClimatology && <PlotCard
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
                ticks: {
                  ...lineOpts("UT [hours]").scales.x.ticks,
                  stepSize: 1,
                  autoSkip: false,
                  maxRotation: 0,
                  callback: (value: number | string) => {
                    const hour = Number(value);
                    return Number.isInteger(hour) && hour >= 0 && hour <= 23
                      ? String(hour).padStart(2, "0")
                      : "";
                  },
                },
              },
            },
          }}
        />
      </PlotCard>}

      {showClimatology && (
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        <div>
          <div className="metric-label" style={{ marginBottom: 4 }}>2 · Seasonal diurnal TEC — equinox and solstice{seasonalYears ? ` · ${seasonalYears}` : ""}</div>
          <p className="sw-supporting-text" style={{ margin: 0 }}>
            Median GPS-TEC by hour within ±15 days of each equinox and solstice, from the CMN hourly archive.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {SEASON_PANELS.map((panel) => {
            const season = seasonById.get(panel.id);
            const years = archiveYearLabel(season?.date_start, season?.date_end) || seasonalYears;
            const title = `${panel.title}${years ? ` — ${years}` : ""}`;
            const hasCurve = !!season?.available && season.p50.some((value) => value != null && Number.isFinite(value));
            return (
              <div
                key={panel.id}
                style={{
                  background: "#0a1929",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.28)",
                  padding: "0.35rem 0.3rem 0.15rem",
                }}
              >
                <div style={{ textAlign: "center", color: "#ffffff", fontSize: "0.95rem" }}>{title}</div>
                {season?.available && (
                  <p className="sw-supporting-text" style={{ textAlign: "center", margin: "0.25rem 0", fontSize: "0.75rem" }}>
                    Observed dates: {season.date_start?.slice(0, 10)} to {season.date_end?.slice(0, 10)}
                    {season.partial ? " · Partial edge coverage" : ""}
                  </p>
                )}
                <div style={{ height: 260 }}>
                  {hasCurve && season ? (
                    <Line
                      data={{
                        datasets: [
                          {
                            label: `GPS-TEC${years ? ` (${years})` : ""}`,
                            data: season.hours.map((hour, index) => ({ x: hour, y: season.p50[index] })),
                            borderColor: GPS_TEC_COLOR,
                            backgroundColor: GPS_TEC_COLOR,
                            borderWidth: 1.7,
                            pointRadius: 0,
                            tension: 0.35,
                            spanGaps: false,
                          },
                        ],
                      }}
                      options={seasonPanelOptions(seasonYMax)}
                    />
                  ) : (
                    <div className="banner banner-info" style={{ margin: "4.5rem 0.6rem 0" }}>
                      {years && <div>No observations for {years} in this seasonal window.</div>}
                      {season?.note || (loading ? "Loading this season window…" : "No measured GPS-TEC in this window.")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {seasonal?.uncertainty && (
          <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>
            Uncertainty: {seasonal.uncertainty}
          </p>
        )}
        {seasonal?.note && (
          <p className="sw-supporting-text" style={{ margin: 0, fontSize: "0.75rem" }}>{seasonal.note}</p>
        )}
      </section>
      )}
      {showClimatology && seasonal?.seasons?.length ? (
        <div className="sw-supporting-text" style={{ marginTop: "-0.35rem", fontSize: "0.75rem" }}>
          {seasonal.seasons.map((s) => (
            <div key={s.id}>
              <strong>{s.label}{archiveYearLabel(s.date_start, s.date_end) || seasonalYears ? ` — ${archiveYearLabel(s.date_start, s.date_end) || seasonalYears}` : ""}:</strong>{" "}
              {s.available
                ? `${s.sample_count.toLocaleString()} hourly samples · ${s.stations.join(", ")} · ${s.date_start?.slice(0, 10)} → ${s.date_end?.slice(0, 10)}${s.partial ? " · partial edge coverage" : ""}`
                : s.note || "unavailable"}
            </div>
          ))}
        </div>
      ) : null}

      {showResearch && <PlotCard
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
      </PlotCard>}
      {showResearch && transect?.modip_model && (
        <p className="sw-supporting-text" style={{ marginTop: "-0.35rem", fontSize: "0.75rem" }}>
          {transect.modip_model.description}
          {transect.regression
            ? ` · Linear fit slope ${transect.regression.slope_tecu_per_deg} TECU/° (R²=${transect.regression.r2}).`
            : ""}
        </p>
      )}

      {showResearch && <PlotCard
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
                ticks: {
                  ...lineOpts("UT [hours]").scales.x.ticks,
                  stepSize: 1,
                  autoSkip: false,
                  maxRotation: 0,
                  callback: (value: number | string) => {
                    const hour = Number(value);
                    return Number.isInteger(hour) && hour >= 0 && hour <= 23
                      ? String(hour).padStart(2, "0")
                      : "";
                  },
                },
              },
            },
          }}
        />
      </PlotCard>}
    </div>
  );
}
