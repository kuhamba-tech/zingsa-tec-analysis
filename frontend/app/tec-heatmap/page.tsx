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
  const borderComparison = diagnostics?.border_station_comparison ?? [];
  const matamba = diagnostics?.matamba;
  const evaluation = diagnostics?.evaluation;
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

          {evaluation && (
            <div className="tec-map-diagnostic-panel tec-map-diagnostic-panel--wide">
              <h2>Matamba Evaluation</h2>
              <p>
                {evaluation.method ?? "NRT TEC estimates are extracted from the median-filtered grid at ionosonde coordinates."}
                {" "}Matched points only; every {evaluation.comparison_interval_minutes ?? 60} min over the last{" "}
                {evaluation.comparison_window_days ?? 5} days. Map RMSE uses the previous{" "}
                {evaluation.rmse_window_minutes ?? 15} min of IPP/control observations.
              </p>
              <div className="tec-map-diagnostic-grid">
                {(evaluation.targets ?? []).map((target) => (
                  <div key={target.code}>
                    <span>{target.code} {target.name}</span>
                    <strong>{target.nrt_tec_est != null ? `${target.nrt_tec_est.toFixed(2)} TECU` : "N/A"}</strong>
                    <small>
                      Iono {target.ionosonde?.difference_tecu != null ? `${target.ionosonde.difference_tecu.toFixed(2)} TECU diff` : "awaiting"} ·
                      AfriTEC {target.afritec?.difference_tecu != null ? `${target.afritec.difference_tecu.toFixed(2)} TECU diff` : "awaiting"}
                    </small>
                  </div>
                ))}
              </div>
              <p className="tec-map-diagnostic-note">
                Paper benchmark: ionosonde r about 0.96 in the example, operational r &gt; 0.82 since 2021-05-06;
                slopes 0.65-1.12 for ionosonde and 0.59-1.15 for AfriTEC.
              </p>
            </div>
          )}

          <div className="tec-map-diagnostic-panel">
            <h2>TEC Gradients</h2>
            <p>
              Matamba-style adjacent-cell gradients on the median-filtered 1 degree grid. ICAO advisory severity remains
              based on absolute TEC; gradients support GNSS impact assessment.
            </p>
            <div className="tec-map-diagnostic-grid">
              <div>
                <span>Spatial max</span>
                <strong>{gradients?.spatial_max_tecu_per_deg != null ? `${gradients.spatial_max_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
                <small>{gradients?.spatial_max_direction ?? "direction unavailable"}</small>
              </div>
              <div>
                <span>North-south</span>
                <strong>{gradients?.spatial_lat_max_tecu_per_deg != null ? `${gradients.spatial_lat_max_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
              </div>
              <div>
                <span>East-west</span>
                <strong>{gradients?.spatial_lon_max_tecu_per_deg != null ? `${gradients.spatial_lon_max_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
              </div>
              <div>
                <span>Spatial mean</span>
                <strong>{gradients?.spatial_mean_tecu_per_deg != null ? `${gradients.spatial_mean_tecu_per_deg.toFixed(3)} TECU/deg` : "N/A"}</strong>
              </div>
              <div>
                <span>Temporal max</span>
                <strong>{gradients?.temporal_max_tecu_per_hour != null ? `${gradients.temporal_max_tecu_per_hour.toFixed(2)} TECU/hr` : "Awaiting history"}</strong>
                <small>{gradients?.temporal_available ? `${gradients.temporal_cadence_minutes ?? 5} min map-to-map` : "previous map unavailable"}</small>
              </div>
              <div>
                <span>Temporal mean</span>
                <strong>{gradients?.temporal_mean_tecu_per_hour != null ? `${gradients.temporal_mean_tecu_per_hour.toFixed(2)} TECU/hr` : "Awaiting history"}</strong>
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
            <div className="tec-map-diagnostic-grid">
              <div>
                <span>DIDBase</span>
                <strong>{ionosonde?.source ?? "DIDBase/IonoWeb"}</strong>
                <small>{ionosonde?.latest_available_year ? `latest public year ${ionosonde.latest_available_year}` : "availability unknown"}</small>
              </div>
              <div>
                <span>Public NRT TEC</span>
                <strong>{ionosonde?.has_near_realtime_public_tec ? "Available" : "Not exposed"}</strong>
                <small>Use DIDBase/LGDC account feed or MADIMBO_IONOSONDE_TEC for numeric TEC.</small>
              </div>
            </div>
          </div>

          {borderComparison.length > 0 && (
            <div className="tec-map-diagnostic-panel tec-map-diagnostic-panel--wide">
              <h2>Madimbo vs Zimbabwe Border Sites</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                      <th style={{ padding: "0.4rem", textAlign: "left" }}>Station</th>
                      <th style={{ padding: "0.4rem", textAlign: "right" }}>Distance</th>
                      <th style={{ padding: "0.4rem", textAlign: "right" }}>Station TEC</th>
                      <th style={{ padding: "0.4rem", textAlign: "right" }}>Grid Diff</th>
                      <th style={{ padding: "0.4rem", textAlign: "right" }}>Iono Diff</th>
                      <th style={{ padding: "0.4rem", textAlign: "left" }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {borderComparison.map((row) => (
                      <tr key={row.code} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                        <td style={{ padding: "0.4rem", fontWeight: 700 }}>{row.code.toUpperCase()} {row.name}</td>
                        <td style={{ padding: "0.4rem", textAlign: "right" }}>{row.distance_km.toFixed(1)} km</td>
                        <td style={{ padding: "0.4rem", textAlign: "right" }}>{row.station_vtec.toFixed(2)} TECU</td>
                        <td style={{ padding: "0.4rem", textAlign: "right" }}>
                          {row.difference_from_madimbo_grid_tecu != null ? `${row.difference_from_madimbo_grid_tecu.toFixed(2)} TECU` : "N/A"}
                        </td>
                        <td style={{ padding: "0.4rem", textAlign: "right" }}>
                          {row.difference_from_madimbo_ionosonde_tecu != null ? `${row.difference_from_madimbo_ionosonde_tecu.toFixed(2)} TECU` : "awaiting"}
                        </td>
                        <td style={{ padding: "0.4rem" }}>{row.source ?? "unknown"} · {row.obs_count} obs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tec-map-diagnostic-note">
                Beitbridge is normally the closest Zimbabwe CORS site to Madimbo; compare only matched-time values for Matamba-style validation.
              </p>
            </div>
          )}

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
