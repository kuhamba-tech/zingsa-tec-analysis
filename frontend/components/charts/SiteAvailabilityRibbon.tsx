"use client";

import type { StationUptimeTimelinePoint } from "@/lib/types";

function bucketColor(onlinePct: number): string {
  if (onlinePct >= 95) return "#00ff88";
  if (onlinePct >= 70) return "#eab308";
  if (onlinePct >= 40) return "#ff8c00";
  return "#ff4444";
}

interface Props {
  points: StationUptimeTimelinePoint[];
  label?: string;
}

/**
 * Horizontal availability ribbon — each block is one time bucket.
 * Green = healthy, amber/orange/red = degraded network or site uptime.
 */
export default function SiteAvailabilityRibbon({ points, label = "Availability" }: Props) {
  if (!points.length) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.35rem",
          fontSize: "0.72rem",
          color: "var(--text-muted)",
        }}
      >
        <span>{label}</span>
        <span>
          <span style={{ color: "#00ff88" }}>■</span> ≥95%
          <span style={{ marginLeft: "0.6rem", color: "#eab308" }}>■</span> 70–94%
          <span style={{ marginLeft: "0.6rem", color: "#ff8c00" }}>■</span> 40–69%
          <span style={{ marginLeft: "0.6rem", color: "#ff4444" }}>■</span> &lt;40%
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 2,
          height: 28,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid rgba(36, 77, 115, 0.5)",
        }}
        title="Each segment is one archive bucket — colour shows online % in that period"
      >
        {points.map((p) => (
          <div
            key={p.time}
            style={{
              flex: 1,
              minWidth: 2,
              backgroundColor: bucketColor(p.online_pct),
              opacity: p.samples > 0 ? 1 : 0.25,
            }}
            title={`${p.time.replace("T", " ").slice(0, 16)} UTC · ${p.online_pct.toFixed(1)}% online · ${p.offline_count} offline · ${p.samples} samples`}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "0.25rem",
          fontSize: "0.68rem",
          color: "var(--text-muted)",
        }}
      >
        <span>{points[0]?.time.replace("T", " ").slice(0, 16)}</span>
        <span>{points[points.length - 1]?.time.replace("T", " ").slice(0, 16)}</span>
      </div>
    </div>
  );
}
