"use client";

import { memo, useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getSolarCycleIndices } from "@/lib/api";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import { CYCLE_25_SCALE } from "@/lib/scientistBulletin";
import { SOLAR_FLUX_GUIDES } from "@/lib/solarFluxGuides";
import type { SolarCycleIndicesResponse } from "@/lib/types";
import styles from "./SolarCycleFullRecordCharts.module.css";

const START_YEAR = 1965;
const LIVE_CACHE_MS = 10 * 60_000;
let snapshotRequest: Promise<SolarCycleIndicesResponse> | undefined;
let liveRequest: Promise<SolarCycleIndicesResponse> | undefined;
let liveCachedAt = 0;

function loadSnapshot() {
  snapshotRequest ??= fetch("/solar-cycle-indices-1965.json")
    .then(async response => {
      if (!response.ok) throw new Error("Solar-cycle snapshot unavailable");
      return await response.json() as SolarCycleIndicesResponse;
    })
    .catch(error => {
      snapshotRequest = undefined;
      throw error;
    });
  return snapshotRequest;
}

function loadLiveRecord() {
  if (liveRequest && liveCachedAt && Date.now() - liveCachedAt >= LIVE_CACHE_MS) {
    liveRequest = undefined;
  }
  if (!liveRequest) {
    liveCachedAt = 0;
    liveRequest = getSolarCycleIndices(START_YEAR).then(payload => {
      if (payload.points.length) liveCachedAt = Date.now();
      else liveRequest = undefined;
      return payload;
    }).catch(error => {
      liveRequest = undefined;
      throw error;
    });
  }
  return liveRequest;
}

function mergeMonthlyRecords(snapshot: SolarCycleIndicesResponse | null, live: SolarCycleIndicesResponse | null) {
  if (!snapshot?.points.length) return live;
  if (!live?.points.length || (live.updated_utc ?? "") < (snapshot.updated_utc ?? "")) return snapshot;

  const months = new Map(snapshot.points.map(point => [point.year_month, point]));
  for (const point of live.points) {
    const saved = months.get(point.year_month);
    months.set(point.year_month, {
      ...point,
      f107: point.f107 ?? saved?.f107 ?? null,
      f107_source: point.f107 != null ? point.f107_source : saved?.f107_source ?? null,
      ssn: point.ssn ?? saved?.ssn ?? null,
      ssn_source: point.ssn != null ? point.ssn_source : saved?.ssn_source ?? null,
    });
  }
  const points = [...months.values()].sort((a, b) => a.year_frac - b.year_frac);
  const flux = points.filter(point => point.f107 != null);
  const sunspots = points.filter(point => point.ssn != null);
  return {
    ...live,
    source: [...new Set([snapshot.source, live.source].flatMap(source => source?.split(" · ") ?? []))].join(" · "),
    point_count: points.length,
    points,
    f107_from: flux[0]?.year_month ?? null,
    f107_to: flux.at(-1)?.year_month ?? null,
    ssn_from: sunspots[0]?.year_month ?? null,
    ssn_to: sunspots.at(-1)?.year_month ?? null,
  };
}

function formatYearTick(value: number): string {
  return String(Math.round(value));
}

function coverageLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "coverage unavailable";
  const start = from.slice(0, 4);
  const endMonth = to.slice(5, 7);
  const endYear = to.slice(0, 4);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthIdx = Number(endMonth) - 1;
  const monthName = monthIdx >= 0 && monthIdx < 12 ? months[monthIdx] : endMonth;
  return `${start} – ${monthName} ${endYear}`;
}

const F107_ANALYSIS: ChartAnalysisBlock = {
  lead: "Monthly mean 10.7 cm flux in sfu. This is the solar-cycle climate behind Zimbabwe's daytime TEC, not today's storm.",
  bullets: [
    "Near the 2020 minimum the flux often sat around 70 sfu. Through the 2024 maximum it commonly exceeded 150 sfu, and that raised the quiet-day TEC background over Zimbabwe.",
    CYCLE_25_SCALE,
    "A month of high F10.7 does not prove a geomagnetic storm. The storm sentence still needs an Earth-directed CME or a fast stream, southward Bz, and Kp or Dst.",
  ],
};

const SSN_ANALYSIS: ChartAnalysisBlock = {
  lead: "Sunspot number counts spotted regions and tracks the same ~11-year cycle as F10.7. It is the chance of flares over weeks, not a storm on a given day.",
  bullets: [
    "Write it as the disk climate. A high sunspot number raises the chance of M- and X-class flares. Each flare still needs a UTC peak and a direction: Earth-directed, glancing, or leaving the limb.",
    CYCLE_25_SCALE,
    "The on-disk count used on the visible-disk card is 10 × groups + spots for regions still facing Earth. This monthly series is the longer sunspot-number record.",
  ],
};

const SOLAR_CYCLE_PLOTS = [
  {
    metric: "f107" as const,
    title: "Solar Flux Index (F10.7)",
    unit: "SFU",
    yLabel: "F10.7 (SFU)",
    color: "#fbbf24",
    thresholds: SOLAR_FLUX_GUIDES,
    explanation: F107_ANALYSIS,
  },
  {
    metric: "ssn" as const,
    title: "Sunspot Number (SSN)",
    unit: "SSN",
    yLabel: "SSN",
    color: "#f97316",
    thresholds: [
      { value: 50, label: "Min cycle", color: "#f97316" },
      { value: 150, label: "Max cycle", color: "#ef4444" },
    ],
    explanation: SSN_ANALYSIS,
  },
];

const SolarCyclePlot = memo(function SolarCyclePlot({ plot, model, coverage }: {
  plot: (typeof SOLAR_CYCLE_PLOTS)[number];
  model: { labels: string[]; xValues: number[]; xMin: number; xMax: number; f107: (number | null)[]; ssn: (number | null)[] };
  coverage: string;
}) {
  return (
    <section className={styles.plot} aria-label={plot.title}>
      <h3 className={styles.title}>{plot.title}</h3>
      <p className={styles.coverage}>Monthly mean &middot; {coverage} &middot; {plot.unit}</p>
      <LineChart
        labels={model.labels}
        xValues={model.xValues}
        xLabel="Year"
        xMin={model.xMin}
        xMax={model.xMax}
        xStepSize={10}
        formatXTick={formatYearTick}
        yLabel={plot.yLabel}
        height="clamp(200px, 34vw, 260px)"
        datasets={[{ label: plot.title, data: model[plot.metric], color: plot.color }]}
        thresholds={plot.thresholds}
      />
      <details>
        <summary className={styles.explanation}>Scientific explanation</summary>
        <ChartAnalysisBox block={plot.explanation} title="Scientific interpretation" />
      </details>
    </section>
  );
});

export default function SolarCycleFullRecordCharts() {
  const [snapshot, setSnapshot] = useState<SolarCycleIndicesResponse | null>(null);
  const [live, setLive] = useState<SolarCycleIndicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const savedRequest = loadSnapshot().then(payload => {
      if (!cancelled) setSnapshot(payload);
    });
    const freshRequest = loadLiveRecord().then(payload => {
      if (!cancelled) setLive(payload);
    });
    void Promise.allSettled([savedRequest, freshRequest]).then(([saved, fresh]) => {
      if (cancelled) return;
      if (saved.status === "rejected" && fresh.status === "rejected") {
        setError("Could not load monthly solar-cycle indices.");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => mergeMonthlyRecords(snapshot, live), [snapshot, live]);
  const chartModel = useMemo(() => {
    const points = data?.points ?? [];
    const labels = points.map((p) => p.year_month);
    const xValues = points.map((p) => p.year_frac);
    const f107 = points.map((p) => p.f107);
    const ssn = points.map((p) => p.ssn);
    const xMin = START_YEAR;
    const xMax = Math.max(
      START_YEAR + 1,
      Math.ceil(Math.max(...xValues, START_YEAR + 1)),
    );
    return { labels, xValues, f107, ssn, xMin, xMax };
  }, [data]);

  const rangeNote = data
    ? coverageLabel(data.ssn_from ?? data.f107_from, data.ssn_to ?? data.f107_to)
    : `${START_YEAR} – present`;

  return (
    <section className={`card ${styles.record}`} aria-label="F10.7 and sunspot full record">
      <div>
        <div className="metric-label" style={{ marginBottom: "0.35rem" }}>
          F10.7 &amp; Sunspot Number — Full Record
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Monthly mean solar flux and sunspot activity · Solar cycles 19–25 · {rangeNote}.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem 1.25rem",
          fontSize: "0.72rem",
          color: "var(--text-muted)",
        }}
        aria-label="Solar activity level legend"
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, borderTop: "2px solid #4ade80" }} />
          Quiet (&lt; 70 SFU)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, borderTop: "2px solid #fbbf24" }} />
          Active (70–150 SFU)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, borderTop: "2px solid #ef4444" }} />
          High (&gt; 150 SFU)
        </span>
      </div>

      {loading && !data?.point_count && (
        <div className="banner banner-info">Loading NOAA / LISIRD monthly solar-cycle indices…</div>
      )}
      {error && !loading && <div className="banner banner-warn">{error}</div>}
      {!loading && !error && (!data || data.point_count === 0) && (
        <div className="banner banner-info">
          Monthly F10.7 / SSN record unavailable from NOAA SWPC / LISIRD.
        </div>
      )}

      {data && data.point_count > 0 && (
        <>
          {SOLAR_CYCLE_PLOTS.map(plot => (
            <SolarCyclePlot
              key={plot.metric}
              plot={plot}
              model={chartModel}
              coverage={plot.metric === "f107"
                ? coverageLabel(data.f107_from, data.f107_to)
                : coverageLabel(data.ssn_from, data.ssn_to)}
            />
          ))}

          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Source: {data.source || "NOAA SWPC / LISIRD"}
            {data.updated_utc ? ` · Updated ${data.updated_utc.replace("T", " ").replace("Z", " UTC")}` : ""}
            {data.lisird_error
              ? ` · LISIRD backfill unavailable (${data.lisird_error.slice(0, 120)})`
              : ""}
          </div>
        </>
      )}
    </section>
  );
}
