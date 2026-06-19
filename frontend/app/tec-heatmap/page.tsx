"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getStations } from "@/lib/api";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import type { Station } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), { ssr: false });

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

export default function TecHeatmapPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [mapLayer, setMapLayer] = useState<MapLayer>("Hybrid");
  const [status, setStatus] = useState<FeedStatus>("pending");

  useEffect(() => {
    getStations()
      .then((s) => { setStations(s); setStatus("ok"); })
      .catch(() => { setStations([]); setStatus("down"); });
  }, []);

  const freshnessMsg = useFeedFreshness("cors-stations", status);

  return (
    <div className="tec-map-page">
      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}
      <div className="tec-map-header">
        <div>
          <h1 className="tec-map-title">Zimbabwe CORS Processing Map</h1>
          <p className="tec-map-subtitle">
            {stations.length > 0
              ? `${stations.length} CORS stations on the live network feed.`
              : status === "down"
              ? "Live CORS station feed is unreachable — no station telemetry to map."
              : "Live CORS station feed reports zero stations."}
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
