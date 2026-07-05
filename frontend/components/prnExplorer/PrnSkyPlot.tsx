"use client";

import type { PrnObservation } from "@/lib/types";

interface Props {
  observations: PrnObservation[];
  prns: string[];
  title: string;
}

const COLORS = ["#168bd2", "#ff4444", "#00ff88", "#ff8c00", "#a78bfa", "#ffcc00", "#34d399", "#f472b6", "#60a5fa"];

export default function PrnSkyPlot({ observations, prns, title }: Props) {
  const latestByPrn = new Map<string, PrnObservation>();
  for (const obs of observations) {
    if (!prns.includes(obs.prn)) continue;
    const prev = latestByPrn.get(obs.prn);
    if (!prev || obs.timestamp > prev.timestamp) latestByPrn.set(obs.prn, obs);
  }
  const points = [...latestByPrn.values()].filter((p) => p.elevation_deg != null);

  return (
    <div>
      <div style={{ fontWeight: 800, marginBottom: "0.75rem" }}>{title}</div>
      <div className="prn-sky-layout">
        <div style={{ aspectRatio: "1 / 1", position: "relative", border: "1px solid var(--border)", borderRadius: "50%", background: "radial-gradient(circle, rgba(22,139,210,0.16), transparent 62%)" }}>
          {[25, 50, 75].map((r) => (
            <div
              key={r}
              style={{
                position: "absolute",
                inset: `${(100 - r) / 2}%`,
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "50%",
              }}
            />
          ))}
          <Axis label="N" top="2%" left="50%" />
          <Axis label="E" top="50%" left="96%" />
          <Axis label="S" top="96%" left="50%" />
          <Axis label="W" top="50%" left="4%" />
          {points.map((p, i) => {
            const az = ((p.azimuth_deg ?? i * 45) - 90) * Math.PI / 180;
            const el = Math.max(0, Math.min(90, p.elevation_deg ?? 0));
            const radius = (90 - el) / 90 * 46;
            const x = 50 + radius * Math.cos(az);
            const y = 50 + radius * Math.sin(az);
            return (
              <div
                key={p.prn}
                title={`${p.prn} elev ${el.toFixed(1)} deg`}
                style={{
                  position: "absolute",
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.75)",
                  background: COLORS[i % COLORS.length],
                  color: "#00111f",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  fontSize: "0.68rem",
                }}
              >
                {p.prn}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            Sky plot uses each selected PRN's latest elevation and azimuth when available. Satellites near the center are high elevation; satellites near the rim are low elevation.
          </p>
          <p>
            Showing {points.length} satellite{points.length === 1 ? "" : "s"} with geometry data.
          </p>
        </div>
      </div>
    </div>
  );
}

function Axis({ label, top, left }: { label: string; top: string; left: string }) {
  return (
    <span style={{ position: "absolute", top, left, transform: "translate(-50%, -50%)", color: "var(--text-muted)", fontSize: "0.7rem", fontWeight: 800 }}>
      {label}
    </span>
  );
}
