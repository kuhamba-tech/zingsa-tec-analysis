"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getStations, getTecHeatmap } from "@/lib/api";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";
import TecHeatMapLegend from "@/components/maps/TecHeatMapLegend";

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), { ssr: false });

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

export default function TecHeatmapPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [heatmap, setHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayer>("Hybrid");
  const [status, setStatus] = useState<FeedStatus>("pending");
  const [heatmapStatus, setHeatmapStatus] = useState<FeedStatus>("pending");

  useEffect(() => {
    getStations()
      .then((s) => {
        setStations(s);
        setStatus("ok");
      })
      .catch(() => {
        setStations([]);
        setStatus("down");
      });
  }, []);

  useEffect(() => {
    setHeatmapStatus("pending");
    getTecHeatmap(2)
      .then((payload) => {
        setHeatmap(payload);
        setHeatmapStatus(payload.available ? "ok" : "down");
      })
      .catch(() => {
        setHeatmap(null);
        setHeatmapStatus("down");
      });
  }, []);

  const freshnessMsg = useFeedFreshness("cors-stations", status);
  const showHeatLegend = Boolean(heatmap?.available);

  return (
    <div className="tec-map-page">
      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}
      {heatmapStatus === "down" && (
        <div className="banner banner-warn">
          {heatmap?.message ??
            "Live VTEC heat map unavailable — no recent pipeline observations. Station markers still show CORS network status."}
        </div>
      )}
      {heatmap?.available && heatmap.updated_at && (
        <div className="banner banner-info">
          Live TEC grid from {heatmap.station_count} station{heatmap.station_count === 1 ? "" : "s"} — updated{" "}
          {heatmap.updated_at}
          {heatmap.tec_min != null && heatmap.tec_max != null
            ? ` · range ${heatmap.tec_min.toFixed(1)}–${heatmap.tec_max.toFixed(1)} TECU`
            : ""}
        </div>
      )}

      <div className="tec-map-header">
        <div>
          <h1 className="tec-map-title">Zimbabwe TEC Heat Map</h1>
          <p className="tec-map-subtitle">
            Hybrid satellite base with place names and roads. VTEC is interpolated across Zimbabwe from live CORS
            observations when at least three stations report data.
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
        <CorsMap stations={stations} height={520} layer={mapLayer} heatmap={heatmap} />
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

      {showHeatLegend && <TecHeatMapLegend className="tec-heatmap-legend-below" />}
    </div>
  );
}
