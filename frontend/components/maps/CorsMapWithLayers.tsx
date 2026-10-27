"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import CorsMap from "./CorsMap";
import IntermagnetMapReadout from "./IntermagnetMapReadout";
import LiveTecMethodComparePanel from "./LiveTecMethodComparePanel";
import NetworkDistancesPanel from "./NetworkDistancesPanel";
import TecHeatMapLegend, { TecMapColorbar } from "./TecHeatMapLegend";
import { getTecMethodComparison, getTrigNet } from "@/lib/api";
import { idwFillByStation, stationCodeKey, type LatLonSite } from "@/lib/idwSurface";
import { measuredLiveTec } from "@/lib/measuredLiveTec";
import { heatmapQualityBanner, icaoTecLabel, icaoTecLevel, inferHeatmapQuality } from "@/lib/icaoTecAdvisory";
import type { ProposedCorsSite } from "@/lib/corsGeneticOptimizer";
import type { Station, TecHeatmapResponse, TrigNetResponse } from "@/lib/types";
import { igrf14Epoch } from "@/lib/geomagneticEquator";
import { dipLatitudeDeg, eiaRegion, polewardOfSouthernCrestDeg } from "@/lib/igrf14Dip";
import { getLiveStationStatus, isSurveyorGeneral, type LiveStationCounts } from "@/lib/liveStationStatus";

const StationVtecTimePlots = dynamic(
  () => import("@/components/charts/StationVtecTimePlots"),
  { ssr: false },
);
export type MapLayer =
  | "Hybrid"
  | "Satellite"
  | "Street"
  | "TEC Heat Map"
  | "Geomagnetic"
  | "Zimbabwe ROTI Map"
  | "Global TEC"
  | "TrigNet"
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
  /** Layer shown on first paint. Space weather opens on live TEC. */
  initialLayer?: MapLayer;
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
  "Geomagnetic",
  "Zimbabwe ROTI Map",
  "Global TEC",
  "TrigNet",
  "Network Distances",
];

/** Network Distances only — optional focused view. */
export const NETWORK_DISTANCES_LAYERS: MapLayer[] = ["Network Distances"];

/** Base basemap options only — used by RINEX Data, Network Uptime, and similar pickers. */
export const BASE_MAP_LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street"];

const LAYERS: MapLayer[] = HOME_MAP_LAYERS;
/** One caster rotation. Own Gg inside this window stays; older gaps are interpolated. */
const GG_FRESH_MS = 30 * 60_000;
/** TrigNet TEC must fall in this window around now, the same window as the live feed. */
const SAME_TIME_MS = 30 * 60_000;

function isSameLiveTime(iso: string | null | undefined): boolean {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) && Math.abs(Date.now() - ms) <= SAME_TIME_MS;
}

function zimbabweLiveGopi(station: Station, heatmap: TecHeatmapResponse | null): number | null {
  const key = stationCodeKey(station.code);
  const heat = heatmap?.stations?.find((row) => stationCodeKey(row.code) === key);
  const measuredHeat = measuredLiveTec(heat);
  if (measuredHeat != null) return measuredHeat;
  if (
    typeof station.current_tec === "number" &&
    Number.isFinite(station.current_tec) &&
    station.current_tec > 0 &&
    (station.ntrip_verdict === "msm_streaming" || station.status_source === "ntrip") &&
    getLiveStationStatus(station) !== "offline"
  ) {
    return measuredLiveTec({ vtec: station.current_tec, source: "live_ntrip", obs_count: 1 });
  }
  return null;
}

function riskColor(level: string): string {
  if (level === "High") return "#ff4444";
  if (level === "Moderate") return "#ff8c00";
  return "#00ff88";
}

function GeomagneticCorsTable({
  stations,
  heatmap,
}: {
  stations: Station[];
  heatmap: TecHeatmapResponse | null;
}) {
  const epoch = igrf14Epoch();
  const rows = useMemo(() => {
    return stations
      .map((station) => {
        const dip = dipLatitudeDeg(station.lat, station.lon, epoch);
        if (dip == null) return null;
        return {
          code: station.code.toUpperCase(),
          name: station.name || station.code.toUpperCase(),
          surveyor: isSurveyorGeneral(station.code),
          tec: zimbabweLiveGopi(station, heatmap),
          dip,
          region: eiaRegion(dip),
          poleward: polewardOfSouthernCrestDeg(dip),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => b.dip - a.dip);
  }, [stations, heatmap, epoch]);

  return (
    <div className="card" style={{ marginTop: "0.75rem", padding: "0.85rem 1rem" }}>
      <div className="metric-label" style={{ marginBottom: "0.35rem" }}>
        CORS and the equatorial ionization anomaly
      </div>
      <p style={{ margin: "0 0 0.6rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        The cyan line is the magnetic dip equator around the Earth. Where that field is horizontal,
        the dayside equatorial electrojet flows along it (geomag.org). Oryema, Jurua, D’ujanga and
        Ssebiyonga (2015) put the anomaly trough on this equator and the crests near ±15° dip latitude.
        Coordinates are IGRF-14 dip latitude at epoch {epoch.toFixed(3)} (tan μ = ½ tan I).
        Stations are ordered from the equator southward. GOPI is the live NTRIP code TEC.
        Surveyor General sites stay on the map and are left out of the ZINGSA TEC count.
      </p>
      <div style={{ overflowX: "auto", maxHeight: 280 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {["Station", "GOPI (TECU)", "Dip latitude", "Anomaly region", "From southern crest"].map((heading) => (
                <th key={heading} style={{ textAlign: "left", padding: "0.35rem 0.5rem", position: "sticky", top: 0 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td style={{ padding: "0.28rem 0.5rem" }}>
                  {row.code}
                  <span style={{ color: "var(--text-muted)" }}> · {row.name}</span>
                  {row.surveyor ? " · Surveyor General" : ""}
                </td>
                <td style={{ padding: "0.28rem 0.5rem", color: "#38bdf8", fontWeight: 700 }}>
                  {row.tec != null ? row.tec.toFixed(1) : "—"}
                </td>
                <td style={{ padding: "0.28rem 0.5rem" }}>{row.dip.toFixed(2)}°</td>
                <td style={{ padding: "0.28rem 0.5rem" }}>{row.region}</td>
                <td style={{ padding: "0.28rem 0.5rem" }}>
                  {row.poleward > 0.25 ? `${row.poleward.toFixed(1)}° poleward` : "Equatorward of the crest"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  initialLayer,
  layers = LAYERS,
  showSourcetableWarning = true,
}: Props) {
  const availableLayers = layers.length > 0 ? layers : LAYERS;
  const startingLayer =
    initialLayer && availableLayers.includes(initialLayer)
      ? initialLayer
      : (availableLayers[0] ?? "Hybrid");
  const [layer, setLayer] = useState<MapLayer>(startingLayer);
  const [proposedCorsSites, setProposedCorsSites] = useState<ProposedCorsSite[]>([]);
  const [measuredGg, setMeasuredGg] = useState<Record<string, number>>({});
  const [trignet, setTrignet] = useState<TrigNetResponse | null>(null);

  useEffect(() => {
    if (!availableLayers.includes(layer)) {
      setLayer(availableLayers[0] ?? "Hybrid");
    }
  }, [availableLayers, layer]);

  const tecLayerActive = layer === "TEC Heat Map";
  const geomagneticLayerActive = layer === "Geomagnetic";
  const scienceMapLayerActive = layer === "Zimbabwe ROTI Map";
  const globalTecLayerActive = layer === "Global TEC";
  const networkDistancesActive = layer === "Network Distances";
  const trignetActive = layer === "TrigNet";
  const showLayerSwitcher = availableLayers.length > 1;

  useEffect(() => {
    if (!trignetActive) return;
    let cancelled = false;
    const load = () => {
      getTrigNet()
        .then((payload) => {
          if (!cancelled) setTrignet(payload);
        })
        .catch(() => {
          if (!cancelled) setTrignet(null);
        });
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [trignetActive]);

  const trignetStations = useMemo<Station[]>(() => {
    const trigCodes = new Set((trignet?.stations ?? []).map((row) => row.code.toLowerCase()));
    const trig = (trignet?.stations ?? []).map((row) => {
      const sameTime = isSameLiveTime(row.vtec_time) && row.vtec != null;
      return {
        code: row.code.toLowerCase(),
        name: row.name,
        lat: row.lat,
        lon: row.lon,
        status: sameTime ? "online" : "offline",
        status_source: "catalog" as const,
        constellations: row.constellations,
        current_tec: sameTime ? row.vtec : null,
        height_m: null,
        mountpoint: row.mountpoint,
      };
    });
    const zimbabwe = stations
      .filter((station) => {
        const code = stationCodeKey(station.code);
        return Boolean(code) && !trigCodes.has(code) && Number.isFinite(station.lat) && Number.isFinite(station.lon);
      })
      .map((station) => {
        const tec = zimbabweLiveGopi(station, heatmap);
        return {
          ...station,
          current_tec: tec,
          status: tec != null ? station.status : "offline",
        };
      });
    return [...zimbabwe, ...trig];
  }, [trignet, stations, heatmap]);

  const trignetGg = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of trignet?.stations ?? []) {
      if (!isSameLiveTime(row.vtec_time)) continue;
      if (typeof row.gg_vtec === "number" && Number.isFinite(row.gg_vtec) && row.gg_vtec > 0) {
        map[row.code.toLowerCase()] = row.gg_vtec;
      }
    }
    return map;
  }, [trignet]);

  const trignetHeatmap = useMemo<TecHeatmapResponse | null>(() => {
    const ready = trignetStations.filter(
      (row) => typeof row.current_tec === "number" && Number.isFinite(row.current_tec) && row.current_tec > 0,
    );
    if (!ready.length) return null;
    const values = ready.map((row) => row.current_tec as number);
    return {
      available: true,
      stations: [],
      heat_points: ready.map((row) => ({
        lon: row.lon,
        lat: row.lat,
        vtec: row.current_tec as number,
        weight: 1,
        code: row.code,
      })),
      grid: null,
      bounds: [],
      tec_min: Math.min(...values),
      tec_max: Math.max(...values),
      station_count: ready.length,
      updated_at: trignet?.rinex_day ?? null,
      message: null,
    };
  }, [trignetStations, trignet?.rinex_day]);

  // Load Gg / Cesaroni VTEC for dual map labels on the TEC heat map and TrigNet.
  useEffect(() => {
    if (!tecLayerActive && !trignetActive) return;
    let cancelled = false;
    const load = () => {
      getTecMethodComparison(2, undefined, 300, 60_000)
        .then((res) => {
          if (cancelled) return;
          const map: Record<string, number> = {};
          for (const row of res.stations ?? []) {
            const code = row.station.toLowerCase().replace(/_+$/, "");
            const val =
              typeof row.gg_latest === "number" && Number.isFinite(row.gg_latest)
                ? row.gg_latest
                : null;
            const observationMs = Date.parse(row.gg_time ?? "");
            // Historical calibration means must never masquerade as live labels.
            if (val == null || !Number.isFinite(observationMs) || Date.now() - observationMs > GG_FRESH_MS) {
              continue;
            }
            map[code] = val;
          }
          setMeasuredGg(map);
        })
        .catch(() => {
          if (!cancelled) setMeasuredGg({});
        });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tecLayerActive, trignetActive]);

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

  const surfaceSites = useMemo(() => {
    const byCode = new Map<string, LatLonSite>();
    for (const site of stations) {
      if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      byCode.set(stationCodeKey(site.code), { code: site.code, lat: site.lat, lon: site.lon });
    }
    for (const site of heatmap?.stations ?? []) {
      const key = stationCodeKey(site.code);
      if (byCode.has(key) || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      byCode.set(key, { code: site.code, lat: site.lat, lon: site.lon });
    }
    return [...byCode.values()];
  }, [stations, heatmap]);

  const ggByStation = measuredGg;

  const trignetGgCombined = useMemo(() => {
    const map: Record<string, number> = { ...trignetGg };
    const trigCodes = new Set((trignet?.stations ?? []).map((row) => row.code.toLowerCase()));
    for (const station of stations) {
      const code = stationCodeKey(station.code);
      if (!code || trigCodes.has(code)) continue;
      const value = ggByStation[code];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        map[code] = value;
      }
    }
    return map;
  }, [trignetGg, ggByStation, stations, trignet]);

  const trignetLines = useMemo(() => {
    return trignetStations.map((station) => {
      const code = station.code.toUpperCase();
      const gopi =
        typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
          ? station.current_tec
          : null;
      const gg = trignetGgCombined[stationCodeKey(station.code)];
      const ggVal = typeof gg === "number" && Number.isFinite(gg) ? gg : null;
      if (gopi != null && ggVal != null) return `${code} G ${gopi.toFixed(1)} / Gg ${ggVal.toFixed(1)}`;
      if (gopi != null) return `${code} G ${gopi.toFixed(1)}`;
      if (ggVal != null) return `${code} Gg ${ggVal.toFixed(1)}`;
      return null;
    }).filter((line): line is string => line != null);
  }, [trignetStations, trignetGgCombined]);

  const trignetRanges = useMemo(() => {
    const gopi = trignetStations
      .map((station) => station.current_tec)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    const gg = Object.values(trignetGgCombined).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    );
    return {
      gopi: gopi.length ? { min: Math.min(...gopi), max: Math.max(...gopi) } : null,
      gg: gg.length ? { min: Math.min(...gg), max: Math.max(...gg) } : null,
    };
  }, [trignetStations, trignetGgCombined]);

  const dualStationLines = useMemo(() => {
    if (!heatmap?.stations?.length) return [];
    return heatmap.stations.filter((s) => !isSurveyorGeneral(s.code)).map((s) => {
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
      ? `Online ${liveCounts.online} · Offline ${liveCounts.offline}${liveCounts.unavailable > 0 ? ` · Unavailable ${liveCounts.unavailable}` : ""}`
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
                : trignetActive
                  ? "TrigNet + Zimbabwe CORS"
                  : geomagneticLayerActive
                    ? "Equatorial anomaly — magnetic equator and crests"
                    : "Zimbabwe CORS Network"}
            </span>
          </div>
          <div className="home-map-toolbar-summary">
            {trignetActive
              ? `${trignet?.station_count ?? "…"} TrigNet · ${stations.length} Zimbabwe · G ${trignetHeatmap?.station_count ?? 0} · Gg ${Object.keys(trignetGgCombined).length}${trignet?.rinex_day ? ` · RINEX ${trignet.rinex_day}` : ""}`
              : `${liveCounts.total} stations · ${liveLabel} · ${riskLevel} GNSS risk`}
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
          stations={trignetActive ? trignetStations : stations}
          height={height}
          layer={layer}
          heatmap={trignetActive ? trignetHeatmap : heatmap}
          ggByStation={trignetActive ? trignetGgCombined : tecLayerActive ? ggByStation : {}}
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

        {(tecLayerActive || trignetActive) && <TecMapColorbar />}

        {!globalTecLayerActive && !scienceMapLayerActive && !networkDistancesActive && (
          <div
            className="map-float-panels"
            style={{
            position: "absolute",
            top: geomagneticLayerActive ? "12px" : undefined,
            bottom: geomagneticLayerActive ? undefined : "12px",
            left: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "0.55rem",
              zIndex: 10,
              pointerEvents: "none",
              maxWidth: "calc(100% - 24px)",
            }}
          >
          <IntermagnetMapReadout />
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
              { color: "#c8c8c8", label: "Surveyor general" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
            {geomagneticLayerActive && (
              <>
                {[
                  { color: "#67e8f9", label: "Magnetic equator" },
                  { color: "#f59e0b", label: "Southern EIA crest (−15°)" },
                  { color: "#c4b5fd", label: "Northern EIA crest (+15°)" },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ width: 18, height: 3, background: color, display: "inline-block" }} />
                    <span>{label}</span>
                  </div>
                ))}
              </>
            )}
            <div className="map-status-note" style={{ fontSize: "0.62rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.15rem", maxWidth: "210px" }}>
              Live from Spider Site Status (Status=3 online). Green = online, red = offline, grey = Surveyor General. Click a marker for Details.
              {geomagneticLayerActive && (
                <>
                  {" "}
                  The cyan magnetic equator runs around the Earth. Amber and violet are the ±15° anomaly crests (IGRF-14 dip latitude). Markers show GOPI TEC.
                </>
              )}
              {(tecLayerActive || trignetActive) && (
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

      {geomagneticLayerActive && (
        <GeomagneticCorsTable stations={stations} heatmap={heatmap} />
      )}

      {trignetActive && (
        <div className="home-live-tec-below" aria-live="polite">
          <div className="home-live-tec-below-label">
            TrigNet + Zimbabwe · G = GOPI · Gg = Cesaroni
          </div>
          <div className="home-live-tec-below-range">
            <span style={{ color: "#38bdf8" }}>
              G{" "}
              {trignetRanges.gopi
                ? `${trignetRanges.gopi.min.toFixed(1)}–${trignetRanges.gopi.max.toFixed(1)}`
                : "—"}
            </span>
            <span style={{ color: "#f59e0b", marginLeft: "0.85rem" }}>
              Gg{" "}
              {trignetRanges.gg
                ? `${trignetRanges.gg.min.toFixed(1)}–${trignetRanges.gg.max.toFixed(1)}`
                : "—"}
            </span>
          </div>
          <div className="home-live-tec-below-stations">
            {trignetLines.length > 0 ? trignetLines.join(" · ") : "Reading the TrigNet sourcetable."}
          </div>
          <div className="home-live-tec-below-updated">
            TEC is shown only for the live time. A TrigNet station with no sample in that window is offline.
          </div>
        </div>
      )}

      {tecLayerActive && (
        <div className="home-live-tec-below" aria-live="polite">
          <div className="home-live-tec-below-label">
            Live TEC · G = GOPI (NTRIP, operational) · Gg = Cesaroni (research calibration)
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

      {tecLayerActive && <LiveTecMethodComparePanel stations={surfaceSites} />}

      {tecLayerActive && (
        <TecHeatMapLegend className="tec-heatmap-legend-below" maxVtec={maxVtec} />
      )}

      {tecLayerActive && <StationVtecTimePlots className="home-station-vtec-plots" />}
    </div>
  );
}
