"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { FLARE_SCALE } from "@/lib/solarEventColors";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";

type AxisProps = {
  xMin?: number;
  xMax?: number;
  xTickStepMs?: number;
  formatXTick?: (value: number) => string;
  majorXTicks?: number[];
};

/**
 * Solar Activity GOES X-ray card (6H/24H, ×10⁻⁷ scale, A–X legend).
 * Shared by Live Metric Timelines and the Solar Activity tab.
 */
export default function GoesSolarXrayCard({
  title = "SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm",
  xraySlice,
  xrayLabels,
  xrayEpochs,
  xrayAxis,
  xrayRange,
  onRangeChange,
  explanationOpen,
  onToggle,
  analysis,
}: {
  title?: string;
  xraySlice: number[];
  xrayLabels: string[];
  xrayEpochs: number[];
  xrayAxis: AxisProps;
  xrayRange: "6H" | "24H";
  onRangeChange: (range: "6H" | "24H") => void;
  explanationOpen: boolean;
  onToggle: () => void;
  analysis: ChartAnalysisBlock;
}) {
  const hasData = xraySlice.length > 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (hasData && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className="card"
      role={hasData ? "button" : undefined}
      tabIndex={hasData ? 0 : undefined}
      aria-expanded={hasData ? explanationOpen : undefined}
      aria-label={hasData ? "GOES X-ray flux graph" : undefined}
      onClick={() => hasData && onToggle()}
      onKeyDown={onKeyDown}
      style={{ cursor: hasData ? "pointer" : "default" } satisfies CSSProperties}
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
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {(["6H", "24H"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRangeChange(r);
              }}
              style={{
                padding: "0.2rem 0.7rem",
                fontSize: "0.85rem",
                fontWeight: 700,
                borderRadius: "5px",
                border: `1px solid ${xrayRange === r ? "var(--accent)" : "var(--border)"}`,
                background: xrayRange === r ? "var(--accent)" : "var(--surface)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <>
          <LineChart
            labels={xrayLabels}
            datasets={[{ label: "0.1–0.8 nm X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#60a5fa" }]}
            yLabel="Flux ×10⁻⁷ W/m²"
            height={240}
            xValues={xrayEpochs}
            epochMs={xrayEpochs}
            {...xrayAxis}
          />
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              flexWrap: "wrap",
              marginTop: "0.6rem",
              fontSize: "0.85rem",
            }}
          >
            {FLARE_SCALE.map((f) => (
              <span key={f.cls} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "3px",
                    background: f.color,
                    borderRadius: "2px",
                  }}
                />
                {f.label}
              </span>
            ))}
          </div>
          {explanationOpen && <ChartAnalysisBox block={analysis} title="Scientific interpretation" />}
        </>
      ) : (
        <div className="banner banner-info">
          GOES X-ray flux data unavailable — NOAA SWPC feed offline or rate-limited.
        </div>
      )}
    </div>
  );
}
