"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getSolarCycleIndices } from "@/lib/api";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
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
  lead: "F10.7 is the monthly mean 10.7 cm solar radio flux (SFU) — a long-term proxy for solar EUV that drives the ionospheric electron density background.",
  bullets: [
    "Quiet conditions are typically below ~70 SFU; active levels sit near 70–150 SFU; high activity exceeds ~150 SFU.",
    "Unlike X-ray flares or Kp, F10.7 describes the solar-cycle climate, not an instantaneous storm trigger.",
    "Higher F10.7 usually means a thicker daytime ionosphere and higher baseline TEC over Zimbabwe — useful context for quiet-day TEC models.",
    "Always pair F10.7 with IMF Bz, solar-wind speed, and Kp/Dst when judging whether a TEC departure is storm-driven.",
  ],
};

const SSN_ANALYSIS: ChartAnalysisBlock = {
  lead: "Sunspot Number (SSN) counts solar active regions and tracks the ~11-year solar cycle together with F10.7.",
  bullets: [
    "Elevated SSN raises the chance of flares and CMEs over weeks to months, but SSN alone does not prove a geomagnetic storm on a given day.",
    "Use SSN/F10.7 for solar-cycle context; use X-rays, IMF Bz, solar wind, and Kp for event-level interpretation.",
    "Min-cycle and max-cycle reference lines help place the current month in the cycle envelope.",
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
            aria-label="Solar Flux Index F10.7 graph. Click for scientific explanation."
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
            <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.45rem", fontWeight: 700 }}>
              {selected === "f107" ? "Click graph to hide scientific explanation" : "Click graph for scientific explanation"}
            </div>
            {selected === "f107" && <ChartAnalysisBox block={F107_ANALYSIS} title="Scientific interpretation" />}
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-expanded={selected === "ssn"}
            aria-label="Sunspot Number graph. Click for scientific explanation."
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
            <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.45rem", fontWeight: 700 }}>
              {selected === "ssn" ? "Click graph to hide scientific explanation" : "Click graph for scientific explanation"}
            </div>
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
