"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getStations } from "@/lib/api";
import type { Station } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), { ssr: false });

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

export default function TecHeatmapPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [mapLayer, setMapLayer] = useState<MapLayer>("Hybrid");

  useEffect(() => {
    getStations().then(setStations).catch(() => setStations([]));
  }, []);

  return (
    <div className="tec-map-page">
      <div className="tec-map-header">
        <div>
          <h1 className="tec-map-title">Zimbabwe CORS Processing Map</h1>
          <p className="tec-map-subtitle">
            {stations.length > 0
              ? `${stations.length} stations loaded for TEC mapping.`
              : "No stations loaded for processing. Select RINEX/CMN files to add sites."}
          </p>
        </div>

        <div className="tec-map-layer-control">
          <span>Map Layer</span>
          <div className="tec-map-layer-buttons">
            {LAYERS.map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => setMapLayer(layer)}
                className={mapLayer === layer ? "active" : ""}
              >
                {layer}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tec-map-frame">
        <CorsMap stations={stations} height={500} layer={mapLayer} />
        <div className="tec-map-legend">
          <div className="tec-map-legend-title">Station Status</div>
          {[
            { color: "#00ff88", label: "Online" },
            { color: "#ff8c00", label: "Degraded" },
            { color: "#ff4444", label: "Offline" },
            { color: "#666", label: "Telemetry Unavailable" },
          ].map(({ color, label }) => (
            <div key={label} className="tec-map-legend-row">
              <span className="dot" style={{ background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
