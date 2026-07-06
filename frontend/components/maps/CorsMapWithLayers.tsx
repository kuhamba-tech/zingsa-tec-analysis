"use client";
import { useState } from "react";
import CorsMap from "./CorsMap";
import TecHeatMapLegend from "./TecHeatMapLegend";
import { heatmapQualityBanner, icaoTecLabel, icaoTecLevel, inferHeatmapQuality } from "@/lib/icaoTecAdvisory";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";

export type MapLayer = "Hybrid" | "Satellite" | "Street" | "TEC Heat Map";

interface Props {
  stations: Station[];
  height?: number;
  riskLevel?: string;
  liveCounts: LiveStationCounts;
  ntripProbedAt?: string | null;
  stationsLoading?: boolean;
  heatmap?: TecHeatmapResponse | null;
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
  liveCounts,
  ntripProbedAt = null,
  stationsLoading = false,
  heatmap = null,
}: Props) {
  const [layer, setLayer] = useState<MapLayer>("Hybrid");
  const tecLayerActive = layer === "TEC Heat Map";
  const maxVtec = heatmap?.tec_max ?? null;
  const qualityBanner = heatmapQualityBanner(inferHeatmapQuality(heatmap ?? null), heatmap?.message);
  const aviationAdvisory =
    maxVtec != null && (icaoTecLevel(maxVtec) === "mod" || icaoTecLevel(maxVtec) === "sev");

  const liveLabel = stationsLoading
    ? "NTRIP probe running…"
    : ntripProbedAt || stations.length > 0
      ? `Online ${liveCounts.online} · Degraded ${liveCounts.degraded} · Offline ${liveCounts.offline} · Unavailable ${liveCounts.unavailable}`
      : "Live stream status";

  return (
    <div>
      {qualityBanner && (
        <div className="banner banner-warn" style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }} role="status">
          {qualityBanner}
        </div>
      )}
      <div className="home-map-toolbar">
        <div className="home-map-toolbar-left">
          <div className="home-map-toolbar-title">
            <span aria-hidden>🔗</span>
            <span>Zimbabwe CORS Network</span>
          </div>
          <div className="home-map-toolbar-summary">
            {liveCounts.total} stations · {liveLabel} · {riskLevel} GNSS risk
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
          {aviationAdvisory && maxVtec != null && (
            <span className="home-map-icao-chip" title={icaoTecLabel(maxVtec)}>
              ✈ ICAO {icaoTecLevel(maxVtec).toUpperCase()}
            </span>
          )}
          <span className="home-map-risk-label">Risk Level</span>
          <span className="home-map-risk-value" style={{ color: riskColor(riskLevel) }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <CorsMap stations={stations} height={height} layer={layer} heatmap={heatmap} />

        {tecLayerActive && (
          <div
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              zIndex: 10,
              background: "rgba(0,0,0,0.82)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.65rem 0.85rem",
              minWidth: "150px",
              pointerEvents: "none",
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase" }}>
              Live TEC
            </div>
            {heatmap?.available ? (
              <>
                <div style={{ color: "#57ff65", fontSize: "1.45rem", fontWeight: 900, lineHeight: 1.1 }}>
                  {heatmap.tec_min != null && heatmap.tec_max != null
                    ? `${heatmap.tec_min.toFixed(1)}-${heatmap.tec_max.toFixed(1)}`
                    : `${heatmap.station_count}`}
                </div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700 }}>
                  {heatmap.stations.length > 0
                    ? heatmap.stations
                        .map((s) => `${s.code.toUpperCase()} ${s.vtec.toFixed(1)}`)
                        .join(" · ")
                    : `TECU from ${heatmap.station_count} live station${heatmap.station_count === 1 ? "" : "s"}`}
                </div>
                {heatmap.updated_at && (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", marginTop: "0.2rem" }}>
                    {heatmap.updated_at}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ color: "#ffb347", fontSize: "0.82rem", fontWeight: 800, marginTop: "0.25rem" }}>
                  Waiting for live VTEC
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.65rem", marginTop: "0.2rem", maxWidth: "210px" }}>
                  {heatmap?.message ?? "No recent live TEC observations available yet."}
                </div>
              </>
            )}
          </div>
        )}

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
              Markers and counts use only the current live NTRIP stream status. Click a marker for site Details.
            </div>
          </div>
        </div>
      </div>

      {tecLayerActive && (
        <TecHeatMapLegend className="tec-heatmap-legend-below" maxVtec={maxVtec} />
      )}
    </div>
  );
}
