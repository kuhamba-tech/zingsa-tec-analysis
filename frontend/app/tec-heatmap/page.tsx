"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getStations, getTecHeatmap } from "@/lib/api";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import { heatmapQualityBanner, icaoTecLabel, icaoTecLevel, inferHeatmapQuality } from "@/lib/icaoTecAdvisory";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
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
      const payload = await getTecHeatmap(6);
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
  const displayHeatmap = useMemo(
    () => mergeTecHeatmapWithStations(heatmap, stations),
    [heatmap, stations],
  );
  const qualityBanner = heatmapQualityBanner(inferHeatmapQuality(displayHeatmap), displayHeatmap?.message);
  const maxVtec = displayHeatmap?.tec_max ?? null;
  const diagnostics = displayHeatmap?.diagnostics ?? null;
  const fit = diagnostics?.fit;
  const gradients = diagnostics?.gradients;
  const ionosonde = diagnostics?.ionosonde_comparison;
  const matamba = diagnostics?.matamba;
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
          {displayHeatmap?.message ??
            "Live VTEC heat map unavailable - no recent pipeline observations. Station markers still show CORS network status."}
        </div>
      )}
      {aviationAdvisory && maxVtec != null && (
        <div className="banner banner-alert" role="alert">
          ICAO GNSS advisory threshold reached - max VTEC {maxVtec.toFixed(1)} TECU ({icaoTecLabel(maxVtec)}).
          Pilots and operators should monitor GNSS performance per ICAO Annex 3 / Doc 10100.
        </div>
      )}
      {displayHeatmap?.available && displayHeatmap.updated_at && (
        <div className={`banner ${staleHeatmap ? "banner-warn" : "banner-info"}`}>
          Live TEC grid from {displayHeatmap.station_count} station{displayHeatmap.station_count === 1 ? "" : "s"} - updated{" "}
          {displayHeatmap.updated_at}
          {displayHeatmap.tec_min != null && displayHeatmap.tec_max != null
            ? ` - range ${displayHeatmap.tec_min.toFixed(1)}-${displayHeatmap.tec_max.toFixed(1)} TECU`
            : ""}
          {staleHeatmap ? ` - data is ${ageMinutes} min old - refreshing...` : ` - auto-refresh every ${HEATMAP_REFRESH_MS / 60_000} min`}
        </div>
      )}

      <div className="tec-map-header">
        <div>
          <h1 className="tec-map-title">Zimbabwe TEC Heat Map</h1>
          <p className="tec-map-subtitle">
            Hybrid satellite base with place names and roads. The TEC grid follows the Matamba and Danskin
            near-real-time pattern: 5-minute updates from a 15-minute observation window, 1 degree nearest-neighbour
            gridding, and median filtering. Colours use a fixed 0-200 TECU scale with ICAO Doc 10100 MOD (
            {heatmap?.icao_mod_tecu ?? 125}) / SEV ({heatmap?.icao_sev_tecu ?? 175}) aviation thresholds.
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
        <CorsMap stations={stations} height={520} layer={mapLayer} heatmap={displayHeatmap} />
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

      {diagnostics && (
        <section className="tec-map-diagnostics" aria-label="TEC interpolation diagnostics">
          <div className="tec-map-diagnostic-panel">
            <h2>Matamba Method</h2>
            <div className="tec-map-diagnostic-grid">
              <div><span>Cadence</span><strong>{matamba?.cadence_minutes ?? 5} min</strong></div>
              <div><span>Window</span><strong>{matamba?.window_minutes ?? 15} min</strong></div>
              <div><span>Grid</span><strong>{matamba?.grid_resolution_deg ?? 1} deg</strong></div>
              <div><span>Filter</span><strong>{matamba?.median_filter_size ?? 7}-cell median</strong></div>
            </div>
          </div>

          <div className="tec-map-diagnostic-panel">
            <h2>Map Quality</h2>
            <div className="tec-map-diagnostic-grid">
              <div><span>RMSE</span><strong>{fit?.rmse_tecu != null ? `${fit.rmse_tecu.toFixed(2)} TECU` : "N/A"}</strong></div>
              <div><span>Quality</span><strong>{fit?.quality_factor != null ? fit.quality_factor.toFixed(2) : "N/A"}</strong></div>
              <div><span>Control Sites</span><strong>{fit?.control_station_count ?? 0}</strong></div>
              <div><span>Observations</span><strong>{fit?.control_observation_count ?? 0}</strong></div>
            </div>
          </div>

          <div className="tec-map-diagnostic-panel">
            <h2>TEC Gradients</h2>
            <div className="tec-map-diagnostic-grid">
              <div>
                <span>Spatial max</span>
                <strong>{gradients?.spatial_max_tecu_per_deg != null ? `${gradients.spatial_max_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
              </div>
              <div>
                <span>Spatial mean</span>
                <strong>{gradients?.spatial_mean_tecu_per_deg != null ? `${gradients.spatial_mean_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
              </div>
              <div>
                <span>Temporal max</span>
                <strong>{gradients?.temporal_max_tecu_per_hour != null ? `${gradients.temporal_max_tecu_per_hour.toFixed(2)} TECU/hr` : "Awaiting history"}</strong>
              </div>
            </div>
          </div>

          <div className="tec-map-diagnostic-panel">
            <h2>Madimbo Ionosonde</h2>
            <p>
              {ionosonde?.name ?? "Madimbo ionosonde"} ({ionosonde?.code ?? "MU12K"}) near Zimbabwe: map-estimated TEC{" "}
              <strong>{ionosonde?.estimated_vtec != null ? `${ionosonde.estimated_vtec.toFixed(2)} TECU` : "N/A"}</strong>.
              {ionosonde?.ionosonde_vtec != null
                ? ` Ionosonde TEC ${ionosonde.ionosonde_vtec.toFixed(2)} TECU; difference ${ionosonde.difference_tecu?.toFixed(2) ?? "N/A"} TECU.`
                : " Set MADIMBO_IONOSONDE_TEC when a live ionosonde TEC feed is available to calculate the comparison residual."}
            </p>
          </div>

          <div className="tec-map-diagnostic-panel tec-map-diagnostic-panel--wide">
            <h2>Frequency Recommendations</h2>
            <div className="tec-map-recommendations">
              {(diagnostics.frequency_recommendations ?? []).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
