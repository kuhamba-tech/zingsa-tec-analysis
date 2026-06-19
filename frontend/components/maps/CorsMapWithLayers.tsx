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
  catalogOnline?: number;
  catalogTotal?: number;
  liveMsmOnline?: number | null;
  ntripDegraded?: number;
  ntripProbedAt?: string | null;
  stationsLoading?: boolean;
}

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

function riskColor(level: string): string {
  if (level === "High") return "#ff4444";
  if (level === "Moderate") return "#ff8c00";
  return "#00ff88";
}

export default function CorsMapWithLayers({
  stations,
  height = 480,
  riskLevel = "N/A",
  catalogOnline,
  catalogTotal = 24,
  liveMsmOnline = null,
  ntripDegraded = 0,
  ntripProbedAt = null,
  stationsLoading = false,
}: Props) {
  const [layer, setLayer] = useState<MapLayer>("Hybrid");

  const total = stations.length > 0 ? stations.length : catalogTotal;
  const catalogCount = catalogOnline ?? stations.filter((s) => (s.catalog_status ?? s.status) === "online").length;
  const msmCount = liveMsmOnline ?? stations.filter((s) => s.ntrip_verdict === "msm_streaming").length;
  const catalogLabel = `${catalogCount}/${total} catalog archive`;
  const msmLabel = stationsLoading
    ? "NTRIP probe running…"
    : liveMsmOnline != null || ntripProbedAt
      ? `${msmCount}/${total} live MSM · ${ntripDegraded}/${total} RTCM-only`
      : "MSM N/A (NTRIP probe pending)";

  return (
    <div>
      <div className="home-map-toolbar">
        <div className="home-map-toolbar-left">
          <div className="home-map-toolbar-title">
            <span aria-hidden>🔗</span>
            <span>Zimbabwe CORS Network</span>
          </div>
          <div className="home-map-toolbar-summary">
            {total} stations · {catalogLabel} · {msmLabel} · {riskLevel} GNSS risk
          </div>
        </div>

        <div className="home-map-toolbar-center">
          <span className="home-map-layer-label">Map Layer</span>
          {LAYERS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayer(l)}
              className={`home-map-layer-btn${layer === l ? " is-active" : ""}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="home-map-toolbar-right">
          <span className="home-map-risk-label">Risk Level</span>
          <span className="home-map-risk-value" style={{ color: riskColor(riskLevel) }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <CorsMap stations={stations} height={height} layer={layer} />

        <div
          style={{
            position: "absolute",
            bottom: "12px",
            left: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "0.55rem",
            zIndex: 10,
            pointerEvents: "none",
            maxWidth: "calc(100% - 24px)",
          }}
        >
          <div
            style={{
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
            }}
          >
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                marginBottom: "0.2rem",
                fontSize: "0.68rem",
              }}
            >
              Station Status
            </div>
            {[
              { color: "#00ff88", label: "Online (NTRIP MSM streaming)" },
              { color: "#ff8c00", label: "Degraded (connected, no MSM)" },
              { color: "#ff4444", label: "Offline" },
              { color: "#666", label: "Status unavailable" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
            <div style={{ fontSize: "0.62rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.15rem", maxWidth: "210px" }}>
              Markers use live NTRIP probe when the persistent collector is off. Click a marker for site Details.
            </div>
          </div>
          {layer === "TEC Heat Map" && <TecHeatMapLegend />}
        </div>
      </div>
    </div>
  );
}
