"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LogarithmicScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import SwSectionBanner from "@/components/spaceWeather/SwSectionBanner";
import { getHeliosphericMonitor } from "@/lib/api";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import {
  alignTimeDomain,
  seriesEpochsFromApi,
  sharedTimeDomain,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";
import {
  analyzeHeliosphericOverview,
  analyzeHeliosphericPanel,
  type HeliosphericPanelId,
} from "@/lib/heliosphericChartAnalysis";
import type { HeliosphericMonitorResponse } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Tooltip, Legend);

const PROTON_COLORS: Record<string, string> = {
  ">=10 MeV": "#38bdf8",
  ">=50 MeV": "#a78bfa",
  ">=100 MeV": "#f97316",
  ">=500 MeV": "#ef4444",
};

function PanelShell({
  title,
  subtitle,
  panelId,
  selected,
  onToggle,
  children,
  analysis,
}: {
  title: string;
  subtitle: string;
  panelId: HeliosphericPanelId;
  selected: boolean;
  onToggle: (id: HeliosphericPanelId) => void;
  children: ReactNode;
  analysis: ReturnType<typeof analyzeHeliosphericPanel>;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(panelId);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={selected}
      aria-label={title}
      onClick={() => onToggle(panelId)}
      onKeyDown={onKeyDown}
      style={{
        background: selected ? "rgba(22, 139, 210, 0.12)" : "#0a1929",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "0.85rem 0.9rem 0.55rem",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "0.12rem", letterSpacing: "0.02em" }}>{title}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.55rem" }}>
        {subtitle}
      </div>
      {children}
      <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.45rem", fontWeight: 700 }}>
        {selected ? "Click panel to hide scientific explanation" : "Click panel for scientific explanation"}
      </div>
      {selected && <ChartAnalysisBox block={analysis} title="Scientific interpretation" />}
    </div>
  );
}

function KpBarChart({
  labels,
  observed,
  estimated,
  predicted,
}: {
  labels: string[];
  observed: (number | null)[];
  estimated: (number | null)[];
  predicted: (number | null)[];
}) {
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Observed Kp",
          data: observed,
          backgroundColor: "#22c55e",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
        {
          label: "Estimated Kp",
          data: estimated,
          backgroundColor: "#eab308",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
        {
          label: "NOAA predicted Kp",
          data: predicted,
          backgroundColor: "#38bdf8aa",
          borderSkipped: false,
          barPercentage: 0.9,
          categoryPercentage: 0.85,
        },
      ],
    }),
    [labels, observed, estimated, predicted],
  );

  return (
    <div style={{ height: 220, position: "relative" }}>
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true,
              labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 10 } },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  return v == null ? `${ctx.dataset.label}: —` : `${ctx.dataset.label}: ${v.toFixed(2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: "#94a3b8",
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 10,
                font: { size: 9 },
              },
              grid: { color: "#1e3a5f" },
            },
            y: {
              min: 0,
              max: 9,
              title: { display: true, text: "Kp", color: "#e2e8f0" },
              ticks: { color: "#94a3b8", stepSize: 1 },
              grid: { color: "#1e3a5f" },
            },
          },
        }}
      />
    </div>
  );
}

export default function HeliosphericMonitorStack() {
  const [data, setData] = useState<HeliosphericMonitorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HeliosphericPanelId | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = peekHeliosphericMonitor();
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    getHeliosphericMonitor()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load heliospheric monitor");
          if (!cached) setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: HeliosphericPanelId) => {
    setSelected((prev) => (prev === id ? null : id));
  };

  const protonDatasets = useMemo(() => {
    const series = data?.protons.series ?? {};
    return Object.entries(series).map(([energy, values]) => ({
      label: energy,
      data: values,
      color: PROTON_COLORS[energy] ?? "#94a3b8",
      fill: true,
    }));
  }, [data]);

  const overviewOpen = selected === "overview";
  const overview = analyzeHeliosphericOverview();

  const panelAxis = useMemo(() => {
    if (!data) {
      return {
        protons: {} as ReturnType<typeof utcTimeAxisProps> & { xValues?: number[]; epochMs?: number[] },
        imf: {} as ReturnType<typeof utcTimeAxisProps> & { xValues?: number[]; epochMs?: number[] },
        solar_wind: {} as ReturnType<typeof utcTimeAxisProps> & { xValues?: number[]; epochMs?: number[] },
      };
    }
    const build = (
      labels: string[],
      epochMs?: (number | null)[],
      times?: string[],
    ) => {
      const epochs = seriesEpochsFromApi(labels, epochMs, times);
      if (!epochs) return {};
      const domain =
        sharedTimeDomain([epochs]) ??
        alignTimeDomain(epochs[0], epochs[epochs.length - 1]);
      return {
        xValues: epochs,
        epochMs: epochs,
        ...utcTimeAxisProps(domain, {
          rangeHours: (domain.max - domain.min) / (60 * 60 * 1000),
        }),
      };
    };
    return {
      protons: build(data.protons.labels, data.protons.epoch_ms, data.protons.times),
      imf: build(data.imf.labels, data.imf.epoch_ms, data.imf.times),
      solar_wind: build(
        data.solar_wind.labels,
        data.solar_wind.epoch_ms,
        data.solar_wind.times,
      ),
    };
  }, [data]);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={overviewOpen}
        aria-label="Heliospheric monitor overview"
        onClick={() => toggle("overview")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle("overview");
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <SwSectionBanner
          icon="🛰️"
          title="Heliospheric Monitor · L1 & GOES"
          tone={error ? "warn" : loading ? "warn" : data ? "ok" : "off"}
          meta={
            <span>
              {error
                ? "Feed issue"
                : loading
                  ? "Loading"
                  : data
                    ? "Live Data · NOAA SWPC"
                    : "Unavailable"}
              {" · "}
              {overviewOpen ? "Hide chain explanation" : "Click for Sun→Earth chain"}
            </span>
          }
        />
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5, marginTop: "0.55rem" }}>
          KNMI-style stack: GOES proton flux, IMF at Sun–Earth L1, solar-wind speed, and NOAA Kp
          observed / forecast — live NOAA SWPC only. Click any panel (or this title) for the scientific
          explanation of how it links Sun → solar wind → IMF → magnetosphere → Zimbabwe TEC/GNSS.
        </div>
        {overviewOpen && <ChartAnalysisBox block={overview} title="How to read this timeline stack" />}
      </div>

      {loading && <div className="banner banner-info">Loading NOAA heliospheric timelines…</div>}
      {error && !loading && <div className="banner banner-warn">{error}</div>}

      {!loading && data && (
        <>
          <PanelShell
            title="GOES proton flux"
            subtitle="Integral channels · last ~3 days · pfu (particles cm⁻² s⁻¹ sr⁻¹)"
            panelId="protons"
            selected={selected === "protons"}
            onToggle={toggle}
            analysis={analyzeHeliosphericPanel("protons", data)}
          >
            {data.protons.labels.length > 0 ? (
              <LineChart
                labels={data.protons.labels}
                datasets={protonDatasets}
                yLabel="Proton flux (pfu)"
                height={220}
                toggleableLegend
                {...panelAxis.protons}
              />
            ) : (
              <div className="banner banner-info">
                Proton flux unavailable{data.errors?.protons ? `: ${data.errors.protons}` : "."}
              </div>
            )}
          </PanelShell>

          <PanelShell
            title="Interplanetary magnetic field near Sun–Earth L1"
            subtitle="RTSW magnetometer · Bt magnitude · GSM By / Bz · nT"
            panelId="imf"
            selected={selected === "imf"}
            onToggle={toggle}
            analysis={analyzeHeliosphericPanel("imf", data)}
          >
            {data.imf.labels.length > 0 ? (
              <LineChart
                labels={data.imf.labels}
                yLabel="IMF (nT)"
                height={220}
                toggleableLegend
                thresholds={[{ value: 0, label: "Bz = 0", color: "#64748b" }]}
                datasets={[
                  { label: "IMF Bt", data: data.imf.bt, color: "#f8fafc" },
                  { label: "IMF GSM By", data: data.imf.by, color: "#38bdf8" },
                  { label: "IMF GSM Bz", data: data.imf.bz, color: "#ef4444", fill: true },
                ]}
                {...panelAxis.imf}
              />
            ) : (
              <div className="banner banner-info">
                IMF series unavailable{data.errors?.imf ? `: ${data.errors.imf}` : "."}
              </div>
            )}
          </PanelShell>

          <PanelShell
            title="Solar wind near Sun–Earth L1"
            subtitle="RTSW plasma · proton speed · density · temperature"
            panelId="solar_wind"
            selected={selected === "solar_wind"}
            onToggle={toggle}
            analysis={analyzeHeliosphericPanel("solar_wind", data)}
          >
            {data.solar_wind.labels.length > 0 ? (() => {
              const speeds = data.solar_wind.speed.filter((v): v is number => v != null && Number.isFinite(v));
              const dMin = speeds.length ? Math.min(...speeds) : 400;
              const dMax = speeds.length ? Math.max(...speeds) : 550;
              return (
              <LineChart
                labels={data.solar_wind.labels}
                yLabel="Speed (km/s)"
                secondaryYLabel="Density (cm⁻³)"
                tertiaryYLabel="Proton temp. (K)"
                height={220}
                toggleableLegend
                ySuggestedMin={Math.max(200, Math.floor(Math.min(dMin, 400) / 20) * 20 - 20)}
                ySuggestedMax={Math.ceil(Math.max(dMax, 600, 500) / 20) * 20}
                datasets={[
                  {
                    label: "Speed",
                    data: data.solar_wind.speed,
                    color: "#eab308",
                    fill: true,
                    yAxisId: "y",
                  },
                  {
                    label: "Density",
                    data: data.solar_wind.density ?? data.solar_wind.speed.map(() => null),
                    color: "#38bdf8",
                    yAxisId: "y2",
                  },
                  {
                    label: "Proton Temp.",
                    data: data.solar_wind.temperature ?? data.solar_wind.speed.map(() => null),
                    color: "#f97316",
                    yAxisId: "y3",
                  },
                ]}
                thresholds={[
                  {
                    value: 500,
                    label: "Fast stream (500 km/s)",
                    color: "#ff8c00",
                    fillAbove: true,
                  },
                ]}
                {...panelAxis.solar_wind}
              />
              );
            })() : (
              <div className="banner banner-info">
                Solar-wind plasma unavailable
                {data.errors?.solar_wind ? `: ${data.errors.solar_wind}` : "."}
              </div>
            )}
          </PanelShell>

          <PanelShell
            title="GFZ / NOAA planetary Kp · observed & forecast"
            subtitle="NOAA planetary K-index forecast product · observed (green) · estimated (amber) · predicted (cyan)"
            panelId="kp"
            selected={selected === "kp"}
            onToggle={toggle}
            analysis={analyzeHeliosphericPanel("kp", data)}
          >
            {data.kp.labels.length > 0 ? (
              <KpBarChart
                labels={data.kp.labels}
                observed={data.kp.observed}
                estimated={data.kp.estimated}
                predicted={data.kp.predicted}
              />
            ) : (
              <div className="banner banner-info">
                Kp forecast unavailable{data.errors?.kp ? `: ${data.errors.kp}` : "."}
              </div>
            )}
          </PanelShell>

          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Source: {data.source}
            {data.updated_utc
              ? ` · Updated ${data.updated_utc.replace("T", " ").replace("Z", " UTC")}`
              : ""}
            {" · Inspired by "}
            <a
              href="https://spaceweather.knmi.nl/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
              onClick={(event) => event.stopPropagation()}
            >
              KNMI Space Weather
            </a>
          </div>
        </>
      )}
    </div>
  );
}
