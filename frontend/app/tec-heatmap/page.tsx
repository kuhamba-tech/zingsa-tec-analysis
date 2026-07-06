"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getStations, getTecHeatmap } from "@/lib/api";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { heatmapQualityBanner, icaoTecLabel, icaoTecLevel, inferHeatmapQuality } from "@/lib/icaoTecAdvisory";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";
import TecHeatMapLegend from "@/components/maps/TecHeatMapLegend";

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), { ssr: false });

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];
const HEATMAP_REFRESH_MS = 90_000;

export default function TecHeatmapPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [heatmap, setHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayer>("TEC Heat Map");
  const [status, setStatus] = useState<FeedStatus>("pending");
  const [heatmapStatus, setHeatmapStatus] = useState<FeedStatus>("pending");
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const loadHeatmap = useCallback(async () => {
    setHeatmapStatus("pending");
    try {
      const payload = await getTecHeatmap(2);
      setHeatmap(payload);
      setHeatmapStatus(payload.available ? "ok" : "down");
      setLastFetchedAt(new Date());
    } catch {
      setHeatmap(null);
      setHeatmapStatus("down");
    }
  }, []);

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
    loadHeatmap();
    const id = window.setInterval(loadHeatmap, HEATMAP_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadHeatmap]);

  const freshnessMsg = useFeedFreshness("cors-stations", status);
  const qualityBanner = heatmapQualityBanner(inferHeatmapQuality(heatmap), heatmap?.message);
  const maxVtec = heatmap?.tec_max ?? null;
  const aviationAdvisory =
    maxVtec != null && (icaoTecLevel(maxVtec) === "mod" || icaoTecLevel(maxVtec) === "sev");

  const ageMinutes =
    lastFetchedAt != null ? Math.floor((Date.now() - lastFetchedAt.getTime()) / 60_000) : null;
  const staleHeatmap = ageMinutes != null && ageMinutes >= 15;

  return (
    <div className="tec-map-page">
      {freshnessMsg && <div className="banner banner-warn">{freshnessMsg}</div>}
      {qualityBanner && (
        <div className="banner banner-warn" role="status">
          {qualityBanner}
        </div>
      )}
      {heatmapStatus === "down" && !qualityBanner && (
        <div className="banner banner-warn">
          {heatmap?.message ??
            "Live VTEC heat map unavailable — no recent pipeline observations. Station markers still show CORS network status."}
        </div>
      )}
      {aviationAdvisory && maxVtec != null && (
        <div className="banner banner-alert" role="alert">
          ICAO GNSS advisory threshold reached — max VTEC {maxVtec.toFixed(1)} TECU ({icaoTecLabel(maxVtec)}).
          Pilots and operators should monitor GNSS performance per ICAO Annex 3 / Doc 10100.
        </div>
      )}
      {heatmap?.available && heatmap.updated_at && (
        <div className={`banner ${staleHeatmap ? "banner-warn" : "banner-info"}`}>
          Live TEC grid from {heatmap.station_count} station{heatmap.station_count === 1 ? "" : "s"} — updated{" "}
          {heatmap.updated_at}
          {heatmap.tec_min != null && heatmap.tec_max != null
            ? ` · range ${heatmap.tec_min.toFixed(1)}–${heatmap.tec_max.toFixed(1)} TECU`
            : ""}
          {staleHeatmap ? ` · data is ${ageMinutes} min old — refreshing…` : ` · auto-refresh every ${HEATMAP_REFRESH_MS / 60_000} min`}
        </div>
      )}

      <div className="tec-map-header">
        <div>
          <h1 className="tec-map-title">Zimbabwe TEC Heat Map</h1>
          <p className="tec-map-subtitle">
            Hybrid satellite base with place names and roads. VTEC is interpolated across Zimbabwe from live CORS
            observations when at least three stations report data. Colours use a fixed 0–200 TECU scale with ICAO Doc
            10100 MOD ({heatmap?.icao_mod_tecu ?? 125}) / SEV ({heatmap?.icao_sev_tecu ?? 175}) aviation thresholds.
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

      <TecHeatMapLegend className="tec-heatmap-legend-below" maxVtec={maxVtec} />
    </div>
  );
}
