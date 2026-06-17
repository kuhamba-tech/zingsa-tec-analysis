"use client";
import { useState } from "react";
import CorsMap from "./CorsMap";
import TecHeatMapLegend from "./TecHeatMapLegend";
import type { Station } from "@/lib/types";

export type MapLayer = "Hybrid" | "Satellite" | "Street" | "TEC Heat Map";

interface Props {
  stations: Station[];
  height?: number;
  riskLevel?: string;
}

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

export default function CorsMapWithLayers({ stations, height = 480, riskLevel = "N/A" }: Props) {
  const [layer, setLayer] = useState<MapLayer>("Hybrid");

  const online = stations.filter((s) => s.status === "online").length;
  const total = stations.length;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Zimbabwe CORS Network</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            · {total > 0 ? `${total} stations` : "24 stations"} · {online > 0 ? `${online} live online` : "N/A live online"} · {riskLevel} risk
          </span>
        </div>

        {/* Right: risk level badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>Risk Level</span>
          <span style={{
            fontWeight: 800,
            fontSize: "1rem",
            color: riskLevel === "High" ? "#ff4444" : riskLevel === "Moderate" ? "#ff8c00" : "#00ff88",
          }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Layer switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginRight: "0.3rem" }}>
          Map Layer
        </span>
        {LAYERS.map((l) => (
          <button
            key={l}
            onClick={() => setLayer(l)}
            style={{
              padding: "0.35rem 0.9rem",
              borderRadius: "6px",
              fontSize: "0.83rem",
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${layer === l ? "var(--accent)" : "var(--border)"}`,
              background: layer === l ? "var(--accent)" : "transparent",
              color: layer === l ? "#000" : "var(--text)",
              transition: "background 0.12s, border-color 0.12s",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Map + legend overlay */}
      <div style={{ position: "relative" }}>
        <CorsMap stations={stations} height={height} layer={layer} />

        {/* Map legends — pinned inside map, bottom-left */}
        <div style={{
          position: "absolute",
          bottom: "12px",
          left: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "0.55rem",
          zIndex: 10,
          pointerEvents: "none",
          maxWidth: "calc(100% - 24px)",
        }}>
          <div style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "0.3rem",
            background: "rgba(0,0,0,0.82)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "0.55rem 0.8rem",
            fontSize: "0.75rem",
            fontWeight: 700,
            alignSelf: "flex-start",
          }}>
            <div style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.2rem", fontSize: "0.68rem" }}>
              Station Status
            </div>
            {[
              { color: "#00ff88", label: "Online" },
              { color: "#ff8c00", label: "Degraded" },
              { color: "#ff4444", label: "Offline" },
              { color: "#666",    label: "Telemetry Unavailable" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          {layer === "TEC Heat Map" && <TecHeatMapLegend />}
        </div>
      </div>
    </div>
  );
}
