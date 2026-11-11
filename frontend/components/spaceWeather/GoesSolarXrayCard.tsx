"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { FLARE_SCALE, xrayFluxColor } from "@/lib/solarEventColors";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";
import type { GoesXrayTimelinePoint } from "@/lib/types";
import { loadLineChart } from "@/lib/loadLineChart";
import {
  ONE_H_MS,
  parseTimelineEpoch,
  utcTimeAxisProps,
} from "@/lib/chartTimeAxis";

/** Shared Chart.js line chunk — one download for all Space Weather graphs. */
const LineChart = dynamic(() => loadLineChart().then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="banner banner-info" role="status">
      Loading chart…
    </div>
  ),
});
const ChartAnalysisBox = dynamic(() => import("@/components/dashboard/ChartAnalysisBox"), {
  ssr: false,
});

export type GoesXrayRange = "6H" | "1D" | "3D" | "7D";

const RANGE_HOURS: Record<GoesXrayRange, number> = {
  "6H": 6,
  "1D": 24,
  "3D": 72,
  "7D": 168,
};

const FLARE_THRESHOLDS = [
  { value: 1e-8, label: "A", color: "#94a3b8" },
  { value: 1e-7, label: "B", color: "#38bdf8" },
  { value: 1e-6, label: "C", color: "#f97316" },
  { value: 1e-5, label: "M", color: "#ef4444" },
  { value: 1e-4, label: "X", color: "#a855f7" },
];

function fluxClass(flux: number | null | undefined): string {
  if (flux == null || !Number.isFinite(flux) || flux <= 0) return "—";
  if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
  if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
  if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
  if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
  return `A${Math.max(flux / 1e-8, 0.1).toFixed(1)}`;
}

function formatFlux(flux: number | null | undefined): string {
  if (flux == null || !Number.isFinite(flux) || flux <= 0) return "N/A";
  return `${flux.toExponential(2)} W/m² · class ${fluxClass(flux)}`;
}

function flareYTick(value: number): string {
  const decades: Array<[number, string]> = [
    [1e-8, "A"],
    [1e-7, "B"],
    [1e-6, "C"],
    [1e-5, "M"],
    [1e-4, "X"],
    [1e-3, "X+"],
  ];
  for (const [mark, label] of decades) {
    const ratio = value / mark;
    if (ratio > 0.85 && ratio < 1.15) return label;
  }
  return "";
}

/**
 * NOAA SWPC-style GOES X-ray flux card for Live Metric Timelines and Solar Activity.
 * Log scale with A–X class bands, long + short wavelength, timed samples.
 */
export default function GoesSolarXrayCard({
  title = "GOES X-ray flux",
  timeline,
  fallbackSeries,
  fallbackUpdated,
  xrayRange,
  onRangeChange,
  explanationOpen,
  onToggle,
  analysis,
}: {
  title?: string;
  timeline?: GoesXrayTimelinePoint[] | null;
  /** Legacy untimed long-band samples (W/m²), used only if timeline is empty. */
  fallbackSeries?: number[] | null;
  fallbackUpdated?: string | null;
  xrayRange?: GoesXrayRange;
  onRangeChange?: (range: GoesXrayRange) => void;
  explanationOpen?: boolean;
  onToggle?: () => void;
  analysis?: ChartAnalysisBlock;
}) {
  const [localRange, setLocalRange] = useState<GoesXrayRange>(xrayRange ?? "1D");
  const range = onRangeChange != null ? (xrayRange ?? localRange) : localRange;
  const setRange = onRangeChange ?? setLocalRange;

  const chart = useMemo(() => {
    const hours = RANGE_HOURS[range];
    const points = (timeline ?? []).filter((p) => p?.t);
    let epochs: number[] = [];
    let longBand: (number | null)[] = [];
    let shortBand: (number | null)[] = [];
    let labels: string[] = [];

    if (points.length) {
      const parsed = points
        .map((p) => {
          const ms = parseTimelineEpoch(p.t);
          return ms == null
            ? null
            : {
                ms,
                t: p.t,
                long: p.long != null && p.long > 0 ? p.long : null,
                short: p.short != null && p.short > 0 ? p.short : null,
              };
        })
        .filter((p): p is NonNullable<typeof p> => p != null);
      const endMs = parsed[parsed.length - 1]?.ms ?? Date.now();
      const startMs = endMs - hours * ONE_H_MS;
      const sliced = parsed.filter((p) => p.ms >= startMs && p.ms <= endMs);
      epochs = sliced.map((p) => p.ms);
      longBand = sliced.map((p) => p.long);
      shortBand = sliced.map((p) => p.short);
      labels = sliced.map((p) => p.t);
    } else if (fallbackSeries?.length) {
      const endMs = parseTimelineEpoch(fallbackUpdated ?? "") ?? Date.now();
      const step = Math.max(60_000, Math.floor((hours * ONE_H_MS) / Math.max(fallbackSeries.length - 1, 1)));
      const all = fallbackSeries.map((v, i) => ({
        ms: endMs - (fallbackSeries.length - 1 - i) * step,
        v: v > 0 ? v : null,
      }));
      const startMs = endMs - hours * ONE_H_MS;
      const sliced = all.filter((p) => p.ms >= startMs && p.ms <= endMs);
      epochs = sliced.map((p) => p.ms);
      longBand = sliced.map((p) => p.v);
      shortBand = sliced.map(() => null);
      labels = epochs.map((ms) => new Date(ms).toISOString());
    }

    if (!epochs.length) return null;
    const endMs = epochs[epochs.length - 1];
    const startMs = endMs - hours * ONE_H_MS;
    const domain = { min: startMs, max: endMs };
    const axis = utcTimeAxisProps(domain, {
      rangeHours: hours,
      majorHours: hours <= 6 ? 1 : hours <= 24 ? 4 : hours <= 72 ? 12 : 24,
    });
    const classDetails = longBand.map((v) => (v != null ? fluxClass(v) : null));
    return { labels, epochs, longBand, shortBand, axis, classDetails, startMs, endMs };
  }, [timeline, fallbackSeries, fallbackUpdated, range]);

  const hasData = Boolean(chart);
  const interactive = Boolean(hasData && onToggle);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (interactive && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onToggle?.();
    }
  };

  return (
    <div
      className="card"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? explanationOpen : undefined}
      aria-label={hasData ? "GOES X-ray flux graph" : undefined}
      onClick={() => interactive && onToggle?.()}
      onKeyDown={onKeyDown}
      style={{ cursor: interactive ? "pointer" : "default" } satisfies CSSProperties}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.7rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div className="metric-label">{title}</div>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }} role="group" aria-label="GOES X-ray zoom">
          {(["6H", "1D", "3D", "7D"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setRange(r);
              }}
              style={{
                padding: "0.2rem 0.65rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                borderRadius: "5px",
                border: `1px solid ${range === r ? "var(--accent)" : "var(--border)"}`,
                background: range === r ? "var(--accent)" : "var(--surface)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {r === "6H" ? "6 Hour" : r === "1D" ? "1 Day" : r === "3D" ? "3 Day" : "7 Day"}
            </button>
          ))}
        </div>
      </div>

      {chart ? (
        <>
          <LineChart
            preserveSamples
            labels={chart.labels}
            toggleableLegend
            datasets={[
              {
                label: "0.1–0.8 nm (long)",
                data: chart.longBand,
                color: "#f59e0b",
                valueColor: xrayFluxColor,
                borderWidth: 2,
              },
              {
                label: "0.05–0.4 nm (short)",
                data: chart.shortBand,
                color: "#a78bfa",
                borderWidth: 1.5,
              },
            ]}
            yLabel="X-ray flux (W/m²)"
            height={260}
            yLogScale
            yMin={1e-9}
            yMax={1e-3}
            formatYTick={flareYTick}
            thresholds={FLARE_THRESHOLDS}
            tooltipDetails={chart.classDetails}
            tooltipDetailLabel="GOES class"
            xValues={chart.epochs}
            epochMs={chart.epochs}
            {...chart.axis}
          />
          <div
            style={{
              display: "flex",
              gap: "1.1rem",
              flexWrap: "wrap",
              marginTop: "0.55rem",
              fontSize: "0.82rem",
            }}
          >
            {FLARE_SCALE.map((f) => (
              <span
                key={f.cls}
                title={`${f.label}: ${f.desc} (${f.flux})`}
                style={{ display: "flex", alignItems: "center", gap: "3px" }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "3px",
                    background: f.color,
                    borderRadius: "2px",
                  }}
                />
                {f.cls} · {f.desc}
              </span>
            ))}
          </div>
          <p className="sw-supporting-text" style={{ margin: "0.55rem 0 0" }}>
            NOAA SWPC GOES style: logarithmic flux with A–X class bands. Hover a point for UTC time,
            flux, and GOES class. Long band (0.1–0.8 nm) defines the operational flare class; short
            band (0.05–0.4 nm) is shown for comparison.
            {chart.longBand.length
              ? ` Latest long-band ${formatFlux(chart.longBand[chart.longBand.length - 1])}.`
              : ""}
          </p>
          {explanationOpen && analysis ? (
            <ChartAnalysisBox block={analysis} title="Scientific interpretation" />
          ) : null}
        </>
      ) : (
        <div className="banner banner-info">
          GOES X-ray flux data unavailable — NOAA SWPC feed offline or rate-limited.
        </div>
      )}
    </div>
  );
}
