"use client";

import type { PrnConstellationInfo } from "@/lib/types";

interface Props {
  info: PrnConstellationInfo | null;
  stats: {
    count: number;
    meanVtec: number | null;
    meanQual: number | null;
  };
}

export default function PrnConstellationPanel({ info, stats }: Props) {
  if (!info) {
    return (
      <div className="card">
        <div className="banner banner-info">Constellation reference is loading.</div>
      </div>
    );
  }

  return (
    <div className="card card-accent">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(220px, 0.7fr)", gap: "1rem", alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", gap: "0.65rem", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "1.8rem" }}>{info.icon}</span>
            <div>
              <div className="operations-chart-title" style={{ margin: 0 }}>{info.label}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>PRN range {info.prn_range}</div>
            </div>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.55, margin: "0.35rem 0 0" }}>
            {info.summary}
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.55rem" }}>
          <Metric label="Satellites" value={stats.count ? String(stats.count) : "N/A"} color={info.color} />
          <Metric label="Mean VTEC" value={stats.meanVtec != null ? `${stats.meanVtec.toFixed(1)}` : "N/A"} color="#00ff88" />
          <Metric label="Quality" value={stats.meanQual != null ? `${stats.meanQual.toFixed(0)}%` : "N/A"} color="#ffcc00" />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
      <div style={{ color, fontSize: "1.35rem", fontWeight: 900, marginTop: "0.25rem" }}>{value}</div>
    </div>
  );
}
