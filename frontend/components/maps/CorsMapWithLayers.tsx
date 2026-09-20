"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import CorsMap from "./CorsMap";
import LiveTecMethodComparePanel from "./LiveTecMethodComparePanel";
import NetworkDistancesPanel from "./NetworkDistancesPanel";
import TecHeatMapLegend from "./TecHeatMapLegend";
import { getTecMethodComparison } from "@/lib/api";
import { heatmapQualityBanner, icaoTecLabel, icaoTecLevel, inferHeatmapQuality } from "@/lib/icaoTecAdvisory";
import type { ProposedCorsSite } from "@/lib/corsGeneticOptimizer";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";

const StationVtecTimePlots = dynamic(
  () => import("@/components/charts/StationVtecTimePlots"),
  { ssr: false },
);
export type MapLayer =
  | "Hybrid"
  | "Satellite"
  | "Street"
  | "TEC Heat Map"
  | "Zimbabwe ROTI Map"
  | "Global TEC"
  | "Network Distances";

interface Props {
  stations: Station[];
  height?: number;
  riskLevel?: string;
  liveCounts: LiveStationCounts;
  ntripProbedAt?: string | null;
  stationsLoading?: boolean;
  heatmap?: TecHeatmapResponse | null;
  highlightCode?: string | null;
  onStationSelect?: (station: Station | null) => void;
  /** Layer buttons to show. Defaults to the full National Dashboard set. */
  layers?: MapLayer[];
  /** Sourcetable identity mismatch banner (home page). Off for RINEX picker. */
  showSourcetableWarning?: boolean;
}

/** Full National Dashboard map layers (Hybrid → Network Distances). */
export const HOME_MAP_LAYERS: MapLayer[] = [
  "Hybrid",
  "Satellite",
  "Street",
  "TEC Heat Map",
  "Zimbabwe ROTI Map",
  "Global TEC",
  "Network Distances",
];

/** Network Distances only — optional focused view. */
export const NETWORK_DISTANCES_LAYERS: MapLayer[] = ["Network Distances"];

/** Base basemap options only — used by RINEX Data, Network Uptime, and similar pickers. */
export const BASE_MAP_LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street"];

const LAYERS: MapLayer[] = HOME_MAP_LAYERS;

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
  highlightCode = null,
  onStationSelect,
  layers = LAYERS,
  showSourcetableWarning = true,
}: Props) {
  const availableLayers = layers.length > 0 ? layers : LAYERS;
  const [layer, setLayer] = useState<MapLayer>(availableLayers[0] ?? "Hybrid");
  const [proposedCorsSites, setProposedCorsSites] = useState<ProposedCorsSite[]>([]);
  const [ggByStation, setGgByStation] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!availableLayers.includes(layer)) {
      setLayer(availableLayers[0] ?? "Hybrid");
    }
  }, [availableLayers, layer]);

  const tecLayerActive = layer === "TEC Heat Map";
  const scienceMapLayerActive = layer === "Zimbabwe ROTI Map";
  const globalTecLayerActive = layer === "Global TEC";
  const networkDistancesActive = layer === "Network Distances";
  const showLayerSwitcher = availableLayers.length > 1;

  // Load Gg / Cesaroni VTEC for dual map labels when TEC Heat Map is active.
  useEffect(() => {
    if (!tecLayerActive) return;
    let cancelled = false;
    const load = () => {
      getTecMethodComparison(2, undefined, 300, 60_000)
        .then((res) => {
          if (cancelled) return;
          const map: Record<string, number | null> = {};
          for (const row of res.stations ?? []) {
            const code = row.station.toLowerCase().replace(/_+$/, "");
            const val =
              typeof row.gg_latest === "number" && Number.isFinite(row.gg_latest)
                ? row.gg_latest
                : typeof row.gg_mean === "number" && Number.isFinite(row.gg_mean)
                  ? row.gg_mean
                  : null;
            map[code] = val;
          }
          setGgByStation(map);
        })
        .catch(() => {
          if (!cancelled) setGgByStation({});
        });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tecLayerActive]);

  useEffect(() => {
    if (!networkDistancesActive && proposedCorsSites.length > 0) {
      setProposedCorsSites([]);
    }
  }, [networkDistancesActive, proposedCorsSites.length]);
  const maxVtec = heatmap?.tec_max ?? null;
  const qualityBanner = heatmapQualityBanner(inferHeatmapQuality(heatmap ?? null), heatmap?.message);
  const awaitingVtecBanner =
    qualityBanner != null &&
    /NTRIP-connected|awaiting MSM|decode needs|sampled live VTEC/i.test(qualityBanner);
  const aviationAdvisory =
    maxVtec != null && (icaoTecLevel(maxVtec) === "mod" || icaoTecLevel(maxVtec) === "sev");

  const dualStationLines = useMemo(() => {
    if (!heatmap?.stations?.length) return [];
    return heatmap.stations.map((s) => {
      const code = s.code.toUpperCase();
      const key = s.code.toLowerCase().replace(/_+$/, "");
      const gopi = typeof s.vtec === "number" && Number.isFinite(s.vtec) ? s.vtec : null;
      const gg = ggByStation[key];
      const ggVal = typeof gg === "number" && Number.isFinite(gg) ? gg : null;
      if (gopi != null && ggVal != null) {
        return `${code} G ${gopi.toFixed(1)} / Gg ${ggVal.toFixed(1)}`;
      }
      if (gopi != null) return `${code} G ${gopi.toFixed(1)}`;
      if (ggVal != null) return `${code} Gg ${ggVal.toFixed(1)}`;
      return code;
    });
  }, [heatmap, ggByStation]);

  const ggRange = useMemo(() => {
    const vals = Object.values(ggByStation).filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
    );
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [ggByStation]);

  const liveLabel = stationsLoading
    ? "NTRIP probe running…"
    : ntripProbedAt || stations.length > 0
      ? `Online ${liveCounts.online} · Offline ${liveCounts.offline} · Unavailable ${liveCounts.unavailable}`
      : "Live stream status";

  const sourcetableMismatches = stations.filter((s) => s.sourcetable_mismatch);
  const sharedIdentifier = sourcetableMismatches[0]?.sourcetable_identifier || null;

  return (
    <div>
      {tecLayerActive && qualityBanner && (
        <div
          className={`banner ${awaitingVtecBanner ? "banner-info" : "banner-warn"}`}
          style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}
          role="status"
        >
          {qualityBanner}
        </div>
      )}
      {showSourcetableWarning && sourcetableMismatches.length > 0 && (
        <div
          className="banner banner-warn"
          style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}
          role="status"
        >
          Warning: NTRIP caster sourcetable reports {sourcetableMismatches.length} mountpoint
          {sourcetableMismatches.length === 1 ? "" : "s"} under {sharedIdentifier ? `"${sharedIdentifier}"'s` : "another station's"}{" "}
          identity - likely no distinct receiver is wired to{" "}
          {sourcetableMismatches.length === 1 ? "that mountpoint" : "those mountpoints"} yet. Click a marker for details.
        </div>
      )}
      <div className="home-map-toolbar">
        <div className="home-map-toolbar-left">
          <div className="home-map-toolbar-title">
            <span aria-hidden>🔗</span>
            <span>
              {networkDistancesActive
                ? "CORS Network Distances — Zimbabwe"
                : "Zimbabwe CORS Network"}
            </span>
          </div>
          <div className="home-map-toolbar-summary">
            {liveCounts.total} stations · {liveLabel} · {riskLevel} GNSS risk
          </div>
        </div>

        <div className="home-map-toolbar-center">
          {showLayerSwitcher && (
            <>
              <span className="home-map-layer-label">Map Layer</span>
              {availableLayers.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayer(l)}
                  className={`home-map-layer-btn${layer === l ? " is-active" : ""}`}
                >
                  {l}
                </button>
              ))}
            </>
          )}
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

      <div
        className={networkDistancesActive ? "home-map-network-layout" : undefined}
        style={networkDistancesActive ? undefined : { position: "relative" }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <CorsMap
          stations={stations}
          height={height}
          layer={layer}
          heatmap={heatmap}
          ggByStation={tecLayerActive ? ggByStation : {}}
          proposedCorsSites={networkDistancesActive ? proposedCorsSites : []}
          highlightCode={highlightCode}
          onStationSelect={onStationSelect}
        />

        {networkDistancesActive && (
          <div className="network-distances-map-legend" aria-hidden>
            <div className="network-distances-map-legend-title">Legend</div>
            <div className="network-distances-map-legend-row">
              <span className="dot" style={{ background: "#00ff88" }} />
              <span>CORS Station</span>
            </div>
            <div className="network-distances-map-legend-row">
              <span className="dot" style={{ background: "#5ec8ff" }} />
              <span>Reference Station (HARARE)</span>
            </div>
            {proposedCorsSites.length > 0 && (
              <div className="network-distances-map-legend-row">
                <span className="dot" style={{ background: "#ffb020" }} />
                <span>GA proposed CORS site</span>
              </div>
            )}
            {stations.some((s) => s.connected_rovers != null) && (
              <div className="network-distances-map-legend-row">
                <span className="dot" style={{ background: "#c4b5fd" }} />
                <span>Label shows connected rovers</span>
              </div>
            )}
          </div>
        )}

        {!globalTecLayerActive && !scienceMapLayerActive && !networkDistancesActive && (
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
              { color: "#00ff88", label: "Online" },
              { color: "#ff4444", label: "Offline" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
            <div style={{ fontSize: "0.62rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.15rem", maxWidth: "210px" }}>
              Live from Spider Site Status (Status=3 online). Green = online, red = offline. Click a marker for Details.
              {tecLayerActive && (
                <>
                  {" "}
                  TEC labels: <span style={{ color: "#38bdf8" }}>G</span> = GOPI ·{" "}
                  <span style={{ color: "#f59e0b" }}>Gg</span> = Cesaroni
                </>
              )}
            </div>
          </div>
          </div>
        )}
        </div>
        {networkDistancesActive && (
          <NetworkDistancesPanel
            stations={stations}
            proposedSites={proposedCorsSites}
            onProposedSitesChange={setProposedCorsSites}
          />
        )}
      </div>

      {tecLayerActive && (
        <div className="home-live-tec-below" aria-live="polite">
          <div className="home-live-tec-below-label">
            Live TEC · G = GOPI (NTRIP) · Gg = Cesaroni
          </div>
          {heatmap?.available ? (
            <>
              <div className="home-live-tec-below-range">
                <span style={{ color: "#38bdf8" }}>
                  G{" "}
                  {heatmap.tec_min != null && heatmap.tec_max != null
                    ? `${heatmap.tec_min.toFixed(1)}–${heatmap.tec_max.toFixed(1)}`
                    : `${heatmap.station_count}`}
                </span>
                {ggRange && (
                  <span style={{ color: "#f59e0b", marginLeft: "0.85rem" }}>
                    Gg {ggRange.min.toFixed(1)}–{ggRange.max.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="home-live-tec-below-stations">
                {dualStationLines.length > 0
                  ? dualStationLines.join(" · ")
                  : `TECU from ${heatmap.station_count} live station${heatmap.station_count === 1 ? "" : "s"}`}
              </div>
              {heatmap.updated_at && (
                <div className="home-live-tec-below-updated">{heatmap.updated_at}</div>
              )}
            </>
          ) : (
            <>
              <div className="home-live-tec-below-waiting">Waiting for live VTEC</div>
              <div className="home-live-tec-below-updated">
                {heatmap?.message ?? "No recent live TEC observations available yet."}
              </div>
            </>
          )}
        </div>
      )}

      {tecLayerActive && <LiveTecMethodComparePanel />}

      {tecLayerActive && (
        <TecHeatMapLegend className="tec-heatmap-legend-below" maxVtec={maxVtec} />
      )}

      {tecLayerActive && <StationVtecTimePlots className="home-station-vtec-plots" />}
    </div>
  );
}
