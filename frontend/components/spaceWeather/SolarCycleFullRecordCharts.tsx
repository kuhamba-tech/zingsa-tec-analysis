"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getSolarCycleIndices } from "@/lib/api";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import { CYCLE_25_SCALE } from "@/lib/scientistBulletin";
import type { SolarCycleIndicesResponse } from "@/lib/types";

const START_YEAR = 1965;

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

export default function SolarCycleFullRecordCharts() {
  const [data, setData] = useState<SolarCycleIndicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<"f107" | "ssn" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSolarCycleIndices(START_YEAR)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load solar-cycle indices");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const toggle = (id: "f107" | "ssn") => setSelected((prev) => (prev === id ? null : id));
  const onKeyToggle = (id: "f107" | "ssn") => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(id);
    }
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: "0.35rem" }}>
          F10.7 &amp; Sunspot Number — Full Record
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Monthly mean solar flux and sunspot activity · Solar cycles 19–25 · {rangeNote}. Click a
          chart for the scientific explanation.
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

      {loading && (
        <div className="banner banner-info">Loading NOAA / LISIRD monthly solar-cycle indices…</div>
      )}
      {error && !loading && <div className="banner banner-warn">{error}</div>}
      {!loading && !error && (!data || data.point_count === 0) && (
        <div className="banner banner-info">
          Monthly F10.7 / SSN record unavailable from NOAA SWPC / LISIRD.
        </div>
      )}

      {!loading && data && data.point_count > 0 && (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={selected === "f107"}
            aria-label="Solar Flux Index F10.7 graph"
            onClick={() => toggle("f107")}
            onKeyDown={onKeyToggle("f107")}
            style={{
              background: selected === "f107" ? "rgba(22, 139, 210, 0.12)" : "#0a1929",
              border: `1px solid ${selected === "f107" ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "0.85rem 0.9rem 0.5rem",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.15rem" }}>Solar Flux Index (F10.7)</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
              Monthly mean · {coverageLabel(data.f107_from, data.f107_to)} · SFU
            </div>
            <LineChart
              labels={chartModel.labels}
              xValues={chartModel.xValues}
              xLabel="Year"
              xMin={chartModel.xMin}
              xMax={chartModel.xMax}
              xStepSize={10}
              formatXTick={formatYearTick}
              yLabel="F10.7 (SFU)"
              height={260}
              datasets={[
                {
                  label: "Solar Flux Index (F10.7) (SFU)",
                  data: chartModel.f107,
                  color: "#fbbf24",
                },
              ]}
              thresholds={[
                { value: 70, label: "Quiet", color: "#4ade80" },
                { value: 150, label: "High", color: "#ef4444" },
              ]}
            />
            {selected === "f107" && <ChartAnalysisBox block={F107_ANALYSIS} title="Scientific interpretation" />}
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-expanded={selected === "ssn"}
            aria-label="Sunspot Number graph"
            onClick={() => toggle("ssn")}
            onKeyDown={onKeyToggle("ssn")}
            style={{
              background: selected === "ssn" ? "rgba(22, 139, 210, 0.12)" : "#0a1929",
              border: `1px solid ${selected === "ssn" ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "0.85rem 0.9rem 0.5rem",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.15rem" }}>Sunspot Number (SSN)</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
              Monthly mean · {coverageLabel(data.ssn_from, data.ssn_to)} · SSN
            </div>
            <LineChart
              labels={chartModel.labels}
              xValues={chartModel.xValues}
              xLabel="Year"
              xMin={chartModel.xMin}
              xMax={chartModel.xMax}
              xStepSize={10}
              formatXTick={formatYearTick}
              yLabel="SSN"
              height={260}
              datasets={[
                {
                  label: "Sunspot Number (SSN) (SSN)",
                  data: chartModel.ssn,
                  color: "#f97316",
                },
              ]}
              thresholds={[
                { value: 50, label: "Min cycle", color: "#f97316" },
                { value: 150, label: "Max cycle", color: "#ef4444" },
              ]}
            />
            {selected === "ssn" && <ChartAnalysisBox block={SSN_ANALYSIS} title="Scientific interpretation" />}
          </div>

          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Source: {data.source || "NOAA SWPC / LISIRD"}
            {data.updated_utc ? ` · Updated ${data.updated_utc.replace("T", " ").replace("Z", " UTC")}` : ""}
            {data.lisird_error
              ? ` · LISIRD backfill unavailable (${data.lisird_error.slice(0, 120)})`
              : ""}
          </div>
        </>
      )}
    </div>
  );
}
