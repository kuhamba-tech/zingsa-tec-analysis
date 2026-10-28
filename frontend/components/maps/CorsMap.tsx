"use client";
import { useEffect, useRef, useState } from "react";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import { igrf14Epoch } from "@/lib/geomagneticEquator";
import { anomalyPaths, anomalyReading, dipLatitudeDeg } from "@/lib/igrf14Dip";
import { getLiveStationStatus } from "@/lib/liveStationStatus";
import { buildCorsNetworkEdges, isReferenceCorsStation } from "@/lib/corsNetworkDistances";
import type { ProposedCorsSite } from "@/lib/corsGeneticOptimizer";
import { isValidProposedCorsSite } from "@/lib/zimbabweBoundary";
import { icaoTecColor, icaoTecDistanceLabel, icaoTecLabel } from "@/lib/icaoTecAdvisory";
import { liveVtecSourceFromHeatmap, liveVtecSourceLabel } from "@/lib/liveVtecLabels";
import { measuredLiveTec } from "@/lib/measuredLiveTec";
import { idwFillByStation, type LatLonSite } from "@/lib/idwSurface";
import { fetchGlobalTecForecastObjectUrl } from "@/lib/api";
import { vtecToRgba } from "@/lib/tecHeatmapColors";
import { loadOpenLayers } from "@/lib/loadOpenLayers";
import type { MapLayer } from "./CorsMapWithLayers";
import SiteDetailsPanel from "./SiteDetailsPanel";

interface Props {
  stations: Station[];
  height?: number;
  layer?: MapLayer;
  heatmap?: TecHeatmapResponse | null;
  /** Station code → Gg / Cesaroni live VTEC (TECU) for dual labels on TEC Heat Map. */
  ggByStation?: Record<string, number | null>;
  proposedCorsSites?: ProposedCorsSite[];
  /** Emphasize one station marker (e.g. uptime analysis selection). */
  highlightCode?: string | null;
  /** Fired when a CORS marker is clicked (or map background clears selection). */
  onStationSelect?: (station: Station | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#00ff88",
  offline: "#ff4444",
  unavailable: "#666",
  surveyor_general: "#c8c8c8",
};

/** Operational focus for the national CORS map (lon, lat). */
const ZIMBABWE_CENTER: [number, number] = [29.5, -19.0];
const ZIMBABWE_ZOOM = 6.2;
const GLOBAL_TEC_CENTER: [number, number] = [0, 0];
const GLOBAL_TEC_ZOOM = 2;
/** Zimbabwe through South Africa, so both CORS networks sit in one frame. */
const TRIGNET_CENTER: [number, number] = [26.5, -25.2];
const TRIGNET_ZOOM = 4.65;
/** Whole-Earth dip equator, with Zimbabwe still inside the frame. */
const GEOMAGNETIC_CENTER: [number, number] = [0, 0];
const GEOMAGNETIC_ZOOM = 2;

function mapFrame(layer: MapLayer): { center: [number, number]; zoom: number } {
  if (layer === "Global TEC") return { center: GLOBAL_TEC_CENTER, zoom: GLOBAL_TEC_ZOOM };
  if (layer === "TrigNet") return { center: TRIGNET_CENTER, zoom: TRIGNET_ZOOM };
  if (layer === "Geomagnetic") return { center: GEOMAGNETIC_CENTER, zoom: GEOMAGNETIC_ZOOM };
  return { center: ZIMBABWE_CENTER, zoom: ZIMBABWE_ZOOM };
}

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREET_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TRANSPORT_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";
/** DLR rewrites the same "latest" path; refresh via our no-store API proxy. */
const GLOBAL_TEC_REFRESH_MS = 45_000;

function baseTileUrl(layer: MapLayer): string {
  return layer === "Street" ? STREET_URL : SATELLITE_URL;
}

function usesHybridOverlays(layer: MapLayer): boolean {
  return (
    layer === "Hybrid" ||
    layer === "TEC Heat Map" ||
    layer === "Geomagnetic" ||
    layer === "Zimbabwe ROTI Map" ||
    layer === "TrigNet" ||
    layer === "Network Distances"
  );
}

function heatOverlayOpacity(layer: MapLayer): number {
  return layer === "TEC Heat Map" ? 0.78 : 0.65;
}

function shouldShowHeatOverlay(layer: MapLayer, heatmap: TecHeatmapResponse | null | undefined): boolean {
  if (layer !== "TEC Heat Map" && layer !== "TrigNet") return false;
  if (!heatmap?.available) return false;
  if (heatmap.grid) return true;
  return (heatmap.heat_points?.length ?? 0) >= 1;
}

function isZimbabweScienceLayer(layer: MapLayer): boolean {
  return layer === "Zimbabwe ROTI Map";
}

function scienceLayerMeta(_layer: MapLayer) {
  return {
    title: "Zimbabwe ROTI Map",
    subtitle: "Rate of TEC Index · ionospheric gradient / irregularity monitor",
    unit: "TECU/min",
    note: "ROTI highlights rapid TEC change that can disrupt GNSS carrier tracking.",
    ticks: ["0.00", "0.25", "0.50", "0.75", "1.00+"],
    colors: ["#0b33ff", "#00c8ff", "#28f06a", "#ffe600", "#ff3b30"],
    contours: ["0.25", "0.50", "0.75"],
  };
}

function scienceLayerLabelPositions(_layer: MapLayer): Array<{ label: string; lon: number; lat: number }> {
  const meta = scienceLayerMeta(_layer);
  return [
    { label: meta.contours[0], lon: -62, lat: 4 },
    { label: meta.contours[1], lon: 2, lat: -6 },
    { label: meta.contours[2], lon: 55, lat: -20 },
  ];
}

function drawStationVtecMarkers(
  ctx: CanvasRenderingContext2D,
  stations: TecHeatmapResponse["stations"],
  fromLonLat: (coord: [number, number]) => [number, number],
  extent: [number, number, number, number],
  size: [number, number],
) {
  const [minX, minY, maxX, maxY] = extent;
  for (const station of stations) {
    const [x, y] = fromLonLat([station.lon, station.lat]);
    const px = ((x - minX) / (maxX - minX)) * size[0];
    const py = ((maxY - y) / (maxY - minY)) * size[1];
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = vtecToRgba(station.vtec, 0.95);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawPointHeatBlobs(
  ctx: CanvasRenderingContext2D,
  points: NonNullable<TecHeatmapResponse["heat_points"]>,
  fromLonLat: (coord: [number, number]) => [number, number],
  extent: [number, number, number, number],
  size: [number, number],
  opacity: number,
) {
  const [minX, minY, maxX, maxY] = extent;
  const radius = Math.max(Math.min(size[0], size[1]) * 0.22, 48);
  for (const point of points) {
    const [x, y] = fromLonLat([point.lon, point.lat]);
    const px = ((x - minX) / (maxX - minX)) * size[0];
    const py = ((maxY - y) / (maxY - minY)) * size[1];
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
    gradient.addColorStop(0, vtecToRgba(point.vtec, opacity * 0.9));
    gradient.addColorStop(0.5, vtecToRgba(point.vtec, opacity * 0.45));
    gradient.addColorStop(1, vtecToRgba(point.vtec, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  }
}

function stationKey(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/_+$/, "");
}

function heatmapStationFor(station: Station, heatmap: TecHeatmapResponse | null | undefined) {
  const code = stationKey(station.code);
  return heatmap?.stations.find((s) => stationKey(s.code) === code) ?? null;
}

function stationTecValue(station: Station, heatmap: TecHeatmapResponse | null | undefined): number | null {
  if (getLiveStationStatus(station) === "surveyor_general") return null;
  const heatStation = heatmapStationFor(station, heatmap);
  if (heatStation && /processed_archive/i.test(heatStation.source ?? "")) {
    return null;
  }

  const liveStatus = getLiveStationStatus(station);
  const cardTec =
    typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
      ? station.current_tec
      : null;
  const ntripLive =
    station.ntrip_verdict === "msm_streaming" ||
    station.status_source === "ntrip";

  if (cardTec != null && ntripLive && liveStatus !== "offline") {
    return measuredLiveTec({ vtec: cardTec, source: "live_ntrip", obs_count: 1 });
  }

  return measuredLiveTec(heatStation);
}

function surfaceTec(
  stations: Station[],
  heatmap: TecHeatmapResponse | null | undefined,
  ggByStation: Record<string, number | null> | null | undefined,
) {
  const sites: LatLonSite[] = [];
  const measuredGopi: Record<string, number> = {};
  const measuredGg: Record<string, number> = {};
  for (const station of stations) {
    if (getLiveStationStatus(station) === "surveyor_general") continue;
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const key = stationKey(station.code);
    sites.push({ code: station.code, lat: station.lat, lon: station.lon });
    const gopi = stationTecValue(station, heatmap);
    if (gopi != null) measuredGopi[key] = gopi;
    const gg = stationGgValue(station, ggByStation);
    if (gg != null) measuredGg[key] = gg;
  }
  return {
    gopi: idwFillByStation(sites, measuredGopi),
    gg: idwFillByStation(sites, measuredGg),
  };
}

function stationGgValue(
  station: Station,
  ggByStation: Record<string, number | null> | null | undefined,
): number | null {
  if (getLiveStationStatus(station) === "surveyor_general") return null;
  if (!ggByStation) return null;
  const raw = ggByStation[stationKey(station.code)];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function formatDualTecLabel(code: string, gopi: number | null, gg: number | null): string {
  const id = code.toUpperCase();
  if (gopi != null && gg != null) {
    return `${id}\nG ${gopi.toFixed(1)}\nGg ${gg.toFixed(1)}`;
  }
  if (gopi != null) return `${id}\nG ${gopi.toFixed(1)}`;
  if (gg != null) return `${id}\nGg ${gg.toFixed(1)}`;
  return id;
}

function formatGeomagneticLabel(code: string, gopi: number | null): string {
  const key = code.toLowerCase().replace(/_+$/, "");
  // ZINGSA HQ sits in Harare. At world scale it is the station the label should name.
  const id = key === "zinh" ? "HARARE" : code.toUpperCase();
  return gopi != null ? `${id} G ${gopi.toFixed(1)}` : id;
}

/** Lower rank is drawn first and keeps its label when the world view overlaps Zimbabwe. */
function geomagneticLabelRank(station: { code?: string; status?: string; status_source?: string } | undefined): number {
  if (!station) return 9;
  const code = String(station.code ?? "").toLowerCase().replace(/_+$/, "");
  const status = getLiveStationStatus(station as Station);
  if (code === "zinh") return 0;
  if (status === "online") return 1;
  if (status === "offline" || status === "unavailable") return 4;
  return 2;
}

function geomagneticRenderOrder(a: { get: (key: string) => unknown }, b: { get: (key: string) => unknown }): number {
  const left = geomagneticLabelRank(a.get("station") as Station | undefined);
  const right = geomagneticLabelRank(b.get("station") as Station | undefined);
  return left - right;
}

export default function CorsMap({
  stations,
  height = 420,
  layer = "Hybrid",
  heatmap = null,
  ggByStation = {},
  proposedCorsSites = [],
  highlightCode = null,
  onStationSelect,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupElementRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olMapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseTileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelTileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transportTileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scienceLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkSourceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposedLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geomagneticLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vectorSourceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stationLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olHelpersRef = useRef<any>(null);
  const stationsRef = useRef(stations);
  const heatmapRef = useRef(heatmap);
  const ggByStationRef = useRef(ggByStation);
  const layerRef = useRef(layer);
  const proposedSitesRef = useRef(proposedCorsSites);
  const highlightCodeRef = useRef(highlightCode);
  const onStationSelectRef = useRef(onStationSelect);
  /** Tracks layer used for the last view animation — ignore heatmap-only updates. */
  const viewLayerRef = useRef<MapLayer | null>(null);
  /** TrigNet must frame Zimbabwe and South Africa once the map exists. */
  const trigNetFramedRef = useRef(false);
  const [selected, setSelected] = useState<Station | null>(null);
  const [globalTecSrc, setGlobalTecSrc] = useState<string | null>(null);
  const [globalTecError, setGlobalTecError] = useState<string | null>(null);
  const scienceMeta = scienceLayerMeta(layer);
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;
  stationsRef.current = stations;
  heatmapRef.current = heatmap;
  ggByStationRef.current = ggByStation;
  layerRef.current = layer;
  proposedSitesRef.current = proposedCorsSites;
  highlightCodeRef.current = highlightCode;
  onStationSelectRef.current = onStationSelect;

  useEffect(() => {
    if (layer !== "Global TEC") {
      setGlobalTecError(null);
      setGlobalTecSrc((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        const next = await fetchGlobalTecForecastObjectUrl();
        if (cancelled) {
          if (next.startsWith("blob:")) URL.revokeObjectURL(next);
          return;
        }
        if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
        objectUrl = next.startsWith("blob:") ? next : null;
        setGlobalTecSrc(next);
        setGlobalTecError(null);
      } catch (err) {
        // Keep the last good frame if a refresh fails (cold start / DLR blip).
        if (!cancelled && !objectUrl) {
          setGlobalTecError(
            err instanceof Error ? err.message : "Global TEC forecast unavailable",
          );
        }
      }
    };

    void load();
    const id = window.setInterval(() => void load(), GLOBAL_TEC_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [layer]);

  const buildFeatures = (list: Station[]) => {
    const helpers = olHelpersRef.current;
    if (!helpers) return [];
    const { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text } = helpers;
    const showTecLabels = layerRef.current === "TEC Heat Map" || layerRef.current === "Geomagnetic";
    const geomagnetic = layerRef.current === "Geomagnetic";
    const trigNet = layerRef.current === "TrigNet";
    const networkMode = layerRef.current === "Network Distances";
    const highlight = stationKey(highlightCodeRef.current || "");
    const surface = showTecLabels && !trigNet && !networkMode
      ? surfaceTec(list, heatmapRef.current, ggByStationRef.current)
      : null;
    return list.map((s) => {
      const f = new Feature({ geometry: new Point(fromLonLat([s.lon, s.lat])), station: s });
      const key = stationKey(s.code);
      const measuredTec = stationTecValue(s, heatmapRef.current);
      const measuredGg = stationGgValue(s, ggByStationRef.current);
      const tecValue = measuredTec ?? (surface ? surface.gopi.values[key] ?? null : null);
      const ggValue = measuredGg ?? (surface ? surface.gg.values[key] ?? null : null);
      const trigTec =
        trigNet && typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0
          ? s.current_tec
          : null;
      const labelG = trigNet ? trigTec : tecValue;
      const labelGg = geomagnetic ? null : trigNet ? ggValue : showTecLabels ? ggValue : null;
      const isRef = networkMode && isReferenceCorsStation(s);
      const isHighlight = Boolean(highlight) && stationKey(s.code) === highlight;
      const liveStatus = getLiveStationStatus(s);
      const markerColor = liveStatus === "surveyor_general"
        ? STATUS_COLOR.surveyor_general
        : trigNet
        ? s.status === "offline"
          ? STATUS_COLOR.offline
          : s.status === "online"
            ? STATUS_COLOR.online
            : "#94a3b8"
        : networkMode
        ? isRef
          ? "#5ec8ff"
          : "#00ff88"
        : STATUS_COLOR[liveStatus];
      const dualTec = (showTecLabels || trigNet) && (labelG != null || labelGg != null);
      const harareLabel = stationKey(s.code) === "zinh";
      const label = geomagnetic
        ? !harareLabel && (liveStatus === "offline" || liveStatus === "unavailable")
          ? ""
          : formatGeomagneticLabel(s.code, liveStatus === "online" ? tecValue : null)
        : trigNet
        ? formatDualTecLabel(s.code, labelG, labelGg)
        : networkMode
        ? (() => {
            const base = (s.name || s.code).toUpperCase();
            const rovers = s.connected_rovers;
            return typeof rovers === "number" ? `${base}\n${rovers} rover${rovers === 1 ? "" : "s"}` : base;
          })()
        : dualTec
          ? formatDualTecLabel(s.code, tecValue, ggValue)
          : s.code.toUpperCase();
      const baseRadius = networkMode ? (isRef ? 8 : 7) : 7;
      const narrowMap = typeof window !== "undefined" && window.innerWidth <= 768;
      const dualLines = dualTec && labelG != null && labelGg != null;
      f.setStyle(
        new Style({
          zIndex: geomagnetic ? 100 - geomagneticLabelRank(s) * 10 : undefined,
          image: new Circle({
            radius: isHighlight ? baseRadius + 3 : baseRadius,
            fill: new Fill({ color: markerColor }),
            stroke: new Stroke({
              color: isHighlight ? "#ffd166" : "#fff",
              width: isHighlight ? 3 : 1.5,
            }),
          }),
          text: new Text({
            text: label,
            offsetY: geomagnetic ? -16 : dualLines ? (narrowMap ? -22 : -30) : trigTec != null || (showTecLabels && !networkMode) ? -22 : -14,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: narrowMap ? 2 : 3 }),
            font: dualLines
              ? narrowMap
                ? "bold 9px sans-serif"
                : "bold 10px sans-serif"
              : showTecLabels && !networkMode
                ? "bold 11px sans-serif"
                : "bold 10px sans-serif",
            textAlign: "center",
          }),
        }),
      );
      return f;
    });
  };

  const syncStationFeatures = (list: Station[]) => {
    const source = vectorSourceRef.current;
    const helpers = olHelpersRef.current;
    if (!source || !helpers) return;

    // Update markers in place so online sites do not blink off/on on each poll.
    const existing = source.getFeatures();
    const byCode = new Map<string, any>();
    for (const feature of existing) {
      const station = feature.get("station") as Station | undefined;
      if (station?.code) byCode.set(station.code.toLowerCase(), feature);
    }

    const nextCodes = new Set(list.map((s) => s.code.toLowerCase()));
    for (const [code, feature] of byCode) {
      if (!nextCodes.has(code)) source.removeFeature(feature);
    }

    const fresh = buildFeatures(list);
    for (const feature of fresh) {
      const station = feature.get("station") as Station;
      const code = station.code.toLowerCase();
      const prev = byCode.get(code);
      if (prev) {
        prev.set("station", station);
        prev.setStyle(feature.getStyle());
        const prevGeom = prev.getGeometry();
        const nextGeom = feature.getGeometry();
        if (prevGeom && nextGeom) prevGeom.setCoordinates(nextGeom.getCoordinates());
      } else {
        source.addFeature(feature);
      }
    }
  };

  const syncNetworkLayer = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (networkLayerRef.current) {
      map.removeLayer(networkLayerRef.current);
      networkLayerRef.current = null;
      networkSourceRef.current = null;
    }

    if (layerRef.current !== "Network Distances") return;

    const helpers = olHelpersRef.current;
    if (!helpers) return;

    const { fromLonLat, Feature, Style, Stroke, Fill, Text, LineString, VectorSource, VectorLayer } =
      helpers;

    const edges = buildCorsNetworkEdges(stationsRef.current, 3);
    const source = new VectorSource();
    for (const edge of edges) {
      const geometry = new LineString([
        fromLonLat([edge.fromLon, edge.fromLat]),
        fromLonLat([edge.toLon, edge.toLat]),
      ]);
      const feature = new Feature({ geometry, edge });
      feature.setStyle(
        new Style({
          stroke: new Stroke({ color: "rgba(255,255,255,0.88)", width: 1.6 }),
          text: new Text({
            text: `${edge.distanceKm.toFixed(1)} km`,
            placement: "line",
            fill: new Fill({ color: "#ffffff" }),
            stroke: new Stroke({ color: "rgba(0,0,0,0.75)", width: 3 }),
            font: "bold 11px sans-serif",
            overflow: true,
          }),
        }),
      );
      source.addFeature(feature);
    }

    const layer = new VectorLayer({ source, zIndex: 3, declutter: true });
    map.addLayer(layer);
    networkLayerRef.current = layer;
    networkSourceRef.current = source;
  };

  const syncProposedSitesLayer = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (proposedLayerRef.current) {
      map.removeLayer(proposedLayerRef.current);
      proposedLayerRef.current = null;
    }

    if (layerRef.current !== "Network Distances") return;
    // Hard rule: never plot a proposed CORS outside Zimbabwe.
    const sites = proposedSitesRef.current.filter((s) => isValidProposedCorsSite(s.lat, s.lon));
    if (!sites.length) return;

    const helpers = olHelpersRef.current;
    if (!helpers) return;

    const { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text, VectorSource, VectorLayer } =
      helpers;

    const source = new VectorSource();
    for (const site of sites) {
      const feature = new Feature({
        geometry: new Point(fromLonLat([site.lon, site.lat])),
        proposed: site,
      });
      feature.setStyle(
        new Style({
          image: new Circle({
            radius: 8,
            fill: new Fill({ color: "#ffb020" }),
            stroke: new Stroke({ color: "#fff7e6", width: 2 }),
          }),
          text: new Text({
            text: `${site.label}\nproposed`,
            offsetY: -18,
            fill: new Fill({ color: "#ffd27a" }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: "bold 10px sans-serif",
            textAlign: "center",
          }),
        }),
      );
      source.addFeature(feature);
    }

    const layer = new VectorLayer({ source, zIndex: 5 });
    map.addLayer(layer);
    proposedLayerRef.current = layer;
  };

  const syncGeomagneticLayer = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (geomagneticLayerRef.current) {
      map.removeLayer(geomagneticLayerRef.current);
      geomagneticLayerRef.current = null;
    }
    if (layerRef.current !== "Geomagnetic") return;

    const helpers = olHelpersRef.current;
    if (!helpers) return;
    const { fromLonLat, Feature, Point, Style, Stroke, Fill, Text, LineString, VectorSource, VectorLayer } =
      helpers;
    const epoch = igrf14Epoch();
    const paths = anomalyPaths(epoch);
    if (!paths) return;

    const source = new VectorSource();
    const lines: Array<{ key: "trough" | "southern_crest" | "northern_crest"; color: string; label: string; labelLon: number }> = [
      { key: "trough", color: "#67e8f9", label: "Magnetic equator", labelLon: -30 },
      { key: "southern_crest", color: "#f59e0b", label: "Southern EIA crest (−15°)", labelLon: 110 },
      { key: "northern_crest", color: "#c4b5fd", label: "Northern EIA crest (+15°)", labelLon: 25 },
    ];
    for (const item of lines) {
      const path = paths[item.key];
      if (path.length < 2) continue;
      const line = new Feature({
        geometry: new LineString(path.map(([lon, lat]) => fromLonLat([lon, lat]))),
      });
      line.setStyle([
        new Style({ stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 6 }) }),
        new Style({ stroke: new Stroke({ color: item.color, width: 2.5 }) }),
      ]);
      source.addFeature(line);
      const labelAt = path.find(([lon]) => lon >= item.labelLon) ?? path[0];
      const label = new Feature({
        geometry: new Point(fromLonLat(labelAt)),
      });
      label.setStyle(
        new Style({
          text: new Text({
            text: item.label,
            offsetY: -12,
            fill: new Fill({ color: item.color }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: "bold 12px sans-serif",
          }),
        }),
      );
      source.addFeature(label);
    }

    const vector = new VectorLayer({ source, zIndex: 3 });
    map.addLayer(vector);
    geomagneticLayerRef.current = vector;
  };

  const buildHeatLayer = async () => {
    const data = heatmapRef.current;
    const currentLayer = layerRef.current;
    if (!shouldShowHeatOverlay(currentLayer, data) || !data) return null;

    const helpers = olHelpersRef.current ?? (await loadOpenLayers());
    const { fromLonLat, ImageLayer, ImageCanvas } = helpers;
    const overlayOpacity = heatOverlayOpacity(currentLayer);
    const grid = data.grid;
    const heatPoints = data.heat_points;
    const projectCoord = (coord: [number, number]): [number, number] => {
      const projected = fromLonLat(coord);
      return [projected[0] ?? 0, projected[1] ?? 0];
    };

    const source = new ImageCanvas({
      projection: "EPSG:3857",
      canvasFunction: (extent: number[], _resolution: number, _pixelRatio: number, size: number[]) => {
        const canvas = document.createElement("canvas");
        canvas.width = size[0];
        canvas.height = size[1];
        const ctx = canvas.getContext("2d");
        if (!ctx) return canvas;

        const extentTuple = extent as [number, number, number, number];
        const sizeTuple = size as [number, number];

        if (grid) {
          const gridLons = grid.lons;
          const gridLats = grid.lats;
          const gridVtec = grid.vtec;
          const rows = gridLats.length;
          const cols = gridLons[0]?.length ?? 0;
          const [minX, minY, maxX, maxY] = extentTuple;

          for (let i = 0; i < rows - 1; i++) {
            for (let j = 0; j < cols - 1; j++) {
              const vtec = gridVtec[i]?.[j];
              if (vtec == null || !Number.isFinite(vtec)) continue;

              const lon0 = gridLons[i][j];
              const lat0 = gridLats[i][j];
              const lon1 = gridLons[i + 1]?.[j + 1] ?? gridLons[i][j + 1] ?? lon0;
              const lat1 = gridLats[i + 1]?.[j + 1] ?? gridLats[i][j + 1] ?? lat0;

              const [x0, y0] = projectCoord([lon0, lat0]);
              const [x1, y1] = projectCoord([lon1, lat1]);
              const px0 = ((x0 - minX) / (maxX - minX)) * size[0];
              const px1 = ((x1 - minX) / (maxX - minX)) * size[0];
              const py0 = ((maxY - y0) / (maxY - minY)) * size[1];
              const py1 = ((maxY - y1) / (maxY - minY)) * size[1];

              const left = Math.min(px0, px1);
              const top = Math.min(py0, py1);
              const width = Math.max(Math.abs(px1 - px0), 2);
              const heightPx = Math.max(Math.abs(py1 - py0), 2);

              ctx.fillStyle = vtecToRgba(vtec, overlayOpacity);
              ctx.fillRect(left, top, width, heightPx);
            }
          }
        } else if (heatPoints.length > 0) {
          drawPointHeatBlobs(ctx, heatPoints, projectCoord, extentTuple, sizeTuple, overlayOpacity);
        }

        if (data.stations.length > 0) {
          drawStationVtecMarkers(ctx, data.stations, projectCoord, extentTuple, sizeTuple);
        }

        return canvas;
      },
    });

    return new ImageLayer({
      source,
      opacity: overlayOpacity,
      zIndex: 1.5,
    });
  };

  const buildScienceLayer = async () => {
    const currentLayer = layerRef.current;
    if (!isZimbabweScienceLayer(currentLayer)) return null;

    const helpers = olHelpersRef.current ?? (await loadOpenLayers());
    const { fromLonLat, ImageLayer, ImageCanvas } = helpers;
    const meta = scienceLayerMeta(currentLayer);
    const labels = scienceLayerLabelPositions(currentLayer);

    const source = new ImageCanvas({
      projection: "EPSG:3857",
      canvasFunction: (extent: number[], _resolution: number, _pixelRatio: number, size: number[]) => {
        const canvas = document.createElement("canvas");
        canvas.width = size[0];
        canvas.height = size[1];
        const ctx = canvas.getContext("2d");
        if (!ctx) return canvas;

        const [minX, minY, maxX, maxY] = extent as [number, number, number, number];
        const width = size[0];
        const heightPx = size[1];
        const toPixel = (lon: number, lat: number): [number, number] => {
          const [x, y] = fromLonLat([lon, lat]);
          return [((x - minX) / (maxX - minX)) * width, ((maxY - y) / (maxY - minY)) * heightPx];
        };

        const gradient = ctx.createLinearGradient(0, heightPx * 0.46, width, heightPx * 0.56);
        meta.colors.forEach((color, index) => {
          gradient.addColorStop(index / Math.max(meta.colors.length - 1, 1), color);
        });
        ctx.globalAlpha = 0.46;
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, heightPx);

        const [hotX, hotY] = toPixel(-50, -8);
        const radius = Math.max(Math.min(width, heightPx) * 0.34, 120);
        const hot = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, radius);
        hot.addColorStop(0, `${meta.colors[meta.colors.length - 1]}e8`);
        hot.addColorStop(0.42, `${meta.colors[2]}70`);
        hot.addColorStop(1, `${meta.colors[0]}00`);
        ctx.fillStyle = hot;
        ctx.fillRect(hotX - radius, hotY - radius, radius * 2, radius * 2);

        ctx.globalAlpha = 0.82;
        ctx.lineCap = "round";
        ctx.setLineDash([14, 10]);
        ctx.strokeStyle = "rgba(255,255,255,0.86)";
        ctx.lineWidth = 4;
        [-42, -7, 28].forEach((baseLat, index) => {
          ctx.beginPath();
          for (let lon = -180; lon <= 180; lon += 4) {
            const lat = baseLat + Math.sin(((lon + index * 26) * Math.PI) / 58) * 8;
            const [px, py] = toPixel(lon, lat);
            if (lon === -180) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        });

        ctx.setLineDash([6, 7]);
        ctx.strokeStyle = "rgba(0,0,0,0.52)";
        ctx.lineWidth = 3;
        [-90, 0, 90].forEach((baseLon, index) => {
          ctx.beginPath();
          for (let lat = -85; lat <= 85; lat += 4) {
            const lon = baseLon + Math.sin(((lat + index * 30) * Math.PI) / 45) * 6;
            const [px, py] = toPixel(lon, lat);
            if (lat === -85) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        });

        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "800 30px sans-serif";
        labels.forEach(({ label, lon, lat }) => {
          const [px, py] = toPixel(lon, lat);
          ctx.lineWidth = 6;
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.strokeText(label, px, py);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, px, py);
        });

        return canvas;
      },
    });

    return new ImageLayer({
      source,
      opacity: 0.82,
      zIndex: 1.6,
    });
  };

  const syncScienceLayer = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (scienceLayerRef.current) {
      map.removeLayer(scienceLayerRef.current);
      scienceLayerRef.current = null;
    }

    const next = await buildScienceLayer();
    if (next) {
      map.getLayers().insertAt(3, next);
      scienceLayerRef.current = next;
    }
  };

  const syncHeatLayer = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    const next = await buildHeatLayer();
    if (next) {
      map.getLayers().insertAt(3, next);
      heatLayerRef.current = next;
    }
  };

  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;

    const popupEl = document.createElement("div");
    Object.assign(popupEl.style, {
      display: "none",
      position: "absolute",
      background: "#0a0f1a",
      border: "1px solid #244d73",
      borderRadius: "8px",
      padding: "0.5rem 0.75rem",
      fontSize: "0.75rem",
      lineHeight: "1.35",
      color: "#fff",
      width: "260px",
      maxWidth: "min(260px, calc(100vw - 24px))",
      pointerEvents: "none",
      zIndex: "10",
      boxSizing: "border-box",
    });
    popupElementRef.current = popupEl;

    let disposed = false;

    (async () => {
      // One consolidated OpenLayers chunk — never parallel import("ol/…") races.
      const ol = await loadOpenLayers();
      const {
        Map,
        fromLonLat,
        TileLayer,
        VectorLayer,
        VectorSource,
        XYZ,
        Feature,
        Point,
        Style,
        Circle,
        Fill,
        Stroke,
        Text,
        Overlay,
        View,
        LineString,
        ImageLayer,
        ImageCanvas,
      } = ol;

      if (disposed || olMapRef.current) return;

      olHelpersRef.current = {
        fromLonLat,
        Feature,
        Point,
        Style,
        Circle,
        Fill,
        Stroke,
        Text,
        LineString,
        VectorSource,
        VectorLayer,
        XYZ,
        TileLayer,
        ImageLayer,
        ImageCanvas,
      };

      const baseTile = new TileLayer({
        source: new XYZ({ url: baseTileUrl(layerRef.current), attributions: "Esri" }),
        zIndex: 0,
      });
      const labelTile = new TileLayer({
        source: new XYZ({ url: LABEL_URL, attributions: "Esri Reference" }),
        visible: usesHybridOverlays(layerRef.current),
        zIndex: 2,
        opacity: 0.95,
      });
      const transportTile = new TileLayer({
        source: new XYZ({ url: TRANSPORT_URL, attributions: "Esri Reference" }),
        visible: usesHybridOverlays(layerRef.current),
        zIndex: 2,
        opacity: 0.85,
      });

      const opening = mapFrame(layerRef.current);
      const openingCenter = opening.center;
      const openingZoom = opening.zoom;
      const vectorSource = new VectorSource();
      vectorSourceRef.current = vectorSource;
      syncStationFeatures(stationsRef.current);

      const popup = new Overlay({
        element: popupEl,
        positioning: "bottom-center",
        offset: [0, -14],
        autoPan: { margin: 24, animation: { duration: 180 } },
      });

      const stationLayer = new VectorLayer({
        source: vectorSource,
        zIndex: 4,
        declutter: layerRef.current === "Geomagnetic",
        renderOrder: layerRef.current === "Geomagnetic" ? geomagneticRenderOrder : undefined,
      });
      stationLayerRef.current = stationLayer;
      const layers = [baseTile, labelTile, transportTile, stationLayer];
      const map = new Map({
        target: container,
        layers,
        view: new View({
          center: fromLonLat(openingCenter),
          zoom: openingZoom,
          multiWorld: true,
          showFullExtent: true,
          minZoom: 0,
        }),
        overlays: [popup],
        controls: [],
      });
      viewLayerRef.current = layerRef.current;

      // OpenLayers measures its canvas in physical pixels. Keep that canvas in
      // sync when the dashboard, sidebar, or viewport changes width.
      let resizeFrame: number | null = null;
      const resizeMap = () => {
        if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          map.updateSize();
          resizeFrame = null;
        });
      };
      const resizeObserver = new ResizeObserver(resizeMap);
      resizeObserver.observe(container);
      window.addEventListener("resize", resizeMap);
      resizeMap();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).on("pointermove", (evt: { pixel: [number, number] }) => {
        const hit = map.hasFeatureAtPixel(evt.pixel);
        container.style.cursor = hit ? "pointer" : "";
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).on("click", (evt: { pixel: [number, number]; coordinate: number[] }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const f = map.forEachFeatureAtPixel(evt.pixel, (feat: any) => feat);
        if (f) {
          const s: Station = f.get("station");
          if (!s) return;
          const trigNetClick = layerRef.current === "TrigNet";
          const cardTec =
            typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0
              ? s.current_tec
              : null;
          const surface = trigNetClick
            ? null
            : surfaceTec(stationsRef.current, heatmapRef.current, ggByStationRef.current);
          const codeKey = stationKey(s.code);
          const measuredTec = stationTecValue(s, heatmapRef.current);
          const measuredGg = stationGgValue(s, ggByStationRef.current);
          const tecInterpolated = measuredTec == null && Boolean(surface?.gopi.interpolated[codeKey]);
          const ggInterpolated = measuredGg == null && Boolean(surface?.gg.interpolated[codeKey]);
          const tecValue = trigNetClick ? cardTec : measuredTec ?? surface?.gopi.values[codeKey] ?? null;
          const ggValue = measuredGg ?? surface?.gg.values[codeKey] ?? null;
          const heatmapStation = heatmapStationFor(s, heatmapRef.current);
          setSelectedRef.current(s);
          onStationSelectRef.current?.(s);
          const icaoLine =
            tecValue != null
              ? `<div style="margin-top:0.25rem;color:${icaoTecColor(tecValue)};font-weight:700">${icaoTecLabel(tecValue)}</div>`
              : "";
          const distLine =
            tecValue != null && icaoTecDistanceLabel(tecValue)
              ? `<div style="color:#ffffff;font-size:0.68rem">${icaoTecDistanceLabel(tecValue)}</div>`
              : "";
          const dip = dipLatitudeDeg(s.lat, s.lon, igrf14Epoch());
          const place = dip != null ? anomalyReading(dip) : null;
          const mlatLine =
            place != null && dip != null
              ? `<div style="margin-top:0.35rem;color:#67e8f9;font-weight:700">Dip latitude ${dip.toFixed(1)}° · ${place.belt}</div><div style="color:#f59e0b;font-weight:700">${place.region}</div><div style="margin-top:0.2rem;color:#e2e8f0;font-size:0.68rem;font-weight:400">${place.detail}</div>`
              : "";
          const tecLine =
            tecValue != null
              ? `<div style="color:#38bdf8;font-weight:800">GOPI ${tecValue.toFixed(1)} TECU${tecInterpolated ? " · interpolated" : ""}</div>`
              : "";
          const ggLine =
            ggValue != null
              ? `<div style="color:#f59e0b;font-weight:800">Gg = Cesaroni ${ggValue.toFixed(1)} TECU${ggInterpolated ? " · interpolated" : ""}</div>`
              : "";
          const deltaLine =
            tecValue != null && ggValue != null
              ? `<div style="color:#ffffff;font-size:0.72rem;font-weight:700">Δ (Gg−G) ${(ggValue - tecValue).toFixed(1)} TECU</div>`
              : "";
          const tecSourceLine = trigNetClick
            ? `<div style="color:#ffffff;font-size:0.68rem">${
                s.status_source === "catalog"
                  ? "G = GOPI · Gg = Cesaroni · latest TrigNet RINEX hour"
                  : "G = GOPI · Gg = Cesaroni · live Zimbabwe NTRIP"
              }</div>`
            : heatmapStation
              ? `<div style="color:#ffffff;font-size:0.68rem">${liveVtecSourceLabel(
                  liveVtecSourceFromHeatmap(heatmapStation.source, heatmapStation.obs_count),
                )}</div>`
              : "";
          const sourcetableLine = s.sourcetable_mismatch
            ? `<div style="margin-top:0.2rem;color:#ef9f27;font-weight:700">Warning: Shares caster identity with "${s.sourcetable_identifier}"</div>`
            : "";
          const roverLine =
            typeof s.connected_rovers === "number"
              ? `<div style="margin-top:0.2rem;color:#c4b5fd;font-weight:700">${s.connected_rovers} connected rover${s.connected_rovers === 1 ? "" : "s"}</div>`
              : "";
          popupEl.innerHTML = `<b>${s.code.toUpperCase()}</b>${tecLine}${ggLine}${deltaLine}${mlatLine}${tecSourceLine}${icaoLine}${distLine}${sourcetableLine}${roverLine}<div style="margin-top:0.2rem;color:#ffffff">Click Details →</div>`;
          popup.setPosition(
            Number.isFinite(s.lon) && Number.isFinite(s.lat)
              ? fromLonLat([s.lon, s.lat])
              : evt.coordinate,
          );
          popupEl.style.display = "block";
        } else {
          setSelectedRef.current(null);
          onStationSelectRef.current?.(null);
          popupEl.style.display = "none";
          popup.setPosition(undefined);
        }
      });

      olMapRef.current = map;
      baseTileRef.current = baseTile;
      labelTileRef.current = labelTile;
      transportTileRef.current = transportTile;
      await syncHeatLayer();
      await syncScienceLayer();
      await syncNetworkLayer();
      await syncProposedSitesLayer();
      await syncGeomagneticLayer();
      if (!disposed) setMapReady(true);

      map.set("corsResizeCleanup", () => {
        resizeObserver.disconnect();
        window.removeEventListener("resize", resizeMap);
        if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      });
    })();

    return () => {
      disposed = true;
      setMapReady(false);
      if (olMapRef.current) {
        const resizeCleanup = olMapRef.current.get("corsResizeCleanup");
        if (typeof resizeCleanup === "function") resizeCleanup();
        olMapRef.current.dispose();
        olMapRef.current = null;
      }
      baseTileRef.current = null;
      labelTileRef.current = null;
      transportTileRef.current = null;
      heatLayerRef.current = null;
      scienceLayerRef.current = null;
      networkLayerRef.current = null;
      networkSourceRef.current = null;
      proposedLayerRef.current = null;
      geomagneticLayerRef.current = null;
      vectorSourceRef.current = null;
      stationLayerRef.current = null;
      olHelpersRef.current = null;
      if (popupEl) {
        popupEl.style.display = "none";
        popupEl.innerHTML = "";
        popupEl.remove();
      }
      popupElementRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncStationFeatures(stations);
    void syncNetworkLayer();
  }, [stations]);

  useEffect(() => {
    syncStationFeatures(stationsRef.current);
  }, [highlightCode]);

  useEffect(() => {
    void syncProposedSitesLayer();
  }, [proposedCorsSites, layer]);

  useEffect(() => {
    if (!baseTileRef.current || !labelTileRef.current || !transportTileRef.current) return;
    let cancelled = false;
    (async () => {
      const helpers = olHelpersRef.current ?? (await loadOpenLayers());
      const { XYZ, fromLonLat } = helpers;
      // Refs can be cleared while imports resolve (Strict Mode remount / unmount).
      const baseTile = baseTileRef.current;
      const labelTile = labelTileRef.current;
      const transportTile = transportTileRef.current;
      if (cancelled || !baseTile || !labelTile || !transportTile) return;

      baseTile.setSource(new XYZ({ url: baseTileUrl(layer), attributions: "Esri" }));
      const hybrid = usesHybridOverlays(layer);
      labelTile.setVisible(hybrid);
      transportTile.setVisible(hybrid);

      // Zimbabwe is the focus for every national layer. Global TEC may zoom out;
      // leaving it (or switching Hybrid/Satellite/TEC/…) must return to Zimbabwe.
      // Heatmap data refreshes must not yank the camera.
      const layerChanged = viewLayerRef.current !== layer;
      const map = olMapRef.current;
      if (layer !== "TrigNet") trigNetFramedRef.current = false;
      const needsTrigNetFrame = layer === "TrigNet" && Boolean(map) && !trigNetFramedRef.current;
      if ((layerChanged || needsTrigNetFrame) && map) {
        const frame = mapFrame(layer);
        if (layer === "Geomagnetic") {
          map.updateSize();
          const size = map.getSize();
          const width = size?.[0] || 1;
          const worldWidth = 20037508.342789244 * 2;
          const view = map.getView();
          view.setCenter(fromLonLat([0, 0]));
          view.setResolution(worldWidth / width);
        } else {
          map.getView().setCenter(fromLonLat(frame.center));
          map.getView().setZoom(frame.zoom);
        }
        stationLayerRef.current?.setDeclutter?.(layer === "Geomagnetic");
        stationLayerRef.current?.setRenderOrder?.(layer === "Geomagnetic" ? geomagneticRenderOrder : undefined);
        if (layer === "TrigNet") trigNetFramedRef.current = true;
        viewLayerRef.current = layer;
      }

      if (cancelled) return;
      syncStationFeatures(stationsRef.current);
      await syncHeatLayer();
      if (cancelled) return;
      await syncScienceLayer();
      if (cancelled) return;
      await syncNetworkLayer();
      if (cancelled) return;
      await syncProposedSitesLayer();
      if (cancelled) return;
      await syncGeomagneticLayer();
    })();
    return () => {
      cancelled = true;
    };
  }, [layer, heatmap, ggByStation, mapReady]);

  return (
    <div
      className="cors-map-shell"
      style={{ position: "relative", width: "100%", height, display: "flex" }}
    >
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapRef} className="map-container" style={{ width: "100%", height: "100%" }} />
        {!mapReady && (
          <div className="cors-map-skeleton" aria-busy="true" aria-live="polite">
            <div className="cors-map-skeleton-pulse" />
            <span className="cors-map-skeleton-label">Loading map…</span>
            <span className="cors-map-skeleton-meta">
              {stations.length > 0
                ? `${stations.length} CORS stations ready`
                : "Waiting for station status"}
            </span>
          </div>
        )}
        {isZimbabweScienceLayer(layer) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              pointerEvents: "none",
              overflow: "hidden",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "12px",
                left: "12px",
                zIndex: 7,
                width: "min(360px, calc(100% - 24px))",
                background: "rgba(2, 8, 18, 0.86)",
                border: "1px solid #168bd2",
                borderRadius: "8px",
                padding: "0.72rem 0.85rem",
                color: "#fff",
              }}
            >
              <div style={{ fontSize: "0.66rem", fontWeight: 900, color: "#63c7ff", textTransform: "uppercase" }}>
                {scienceMeta.title}
              </div>
              <div style={{ fontSize: "0.84rem", fontWeight: 800, marginTop: "0.2rem" }}>
                {scienceMeta.subtitle}
              </div>
              <div style={{ fontSize: "0.66rem", color: "#ffffff", marginTop: "0.35rem", lineHeight: 1.45 }}>
                {scienceMeta.note}
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                right: "12px",
                bottom: "12px",
                zIndex: 7,
                width: "min(330px, calc(100% - 24px))",
                background: "rgba(255,255,255,0.94)",
                color: "#0b1220",
                border: "1px solid rgba(15, 23, 42, 0.25)",
                borderRadius: "8px",
                padding: "0.65rem 0.75rem",
                boxShadow: "0 14px 30px rgba(0,0,0,0.28)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
                <strong style={{ fontSize: "0.75rem" }}>{scienceMeta.unit}</strong>
                <span style={{ fontSize: "0.65rem", color: "#0b1220" }}>Zimbabwe CORS product</span>
              </div>
              <div
                style={{
                  height: "14px",
                  marginTop: "0.45rem",
                  border: "1px solid rgba(15,23,42,0.35)",
                  background: `linear-gradient(90deg, ${scienceMeta.colors.join(", ")})`,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", marginTop: "0.28rem", fontWeight: 700 }}>
                {scienceMeta.ticks.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
            </div>
          </div>
        )}
        <div
          className="map-container"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            background: "#ffffff",
            display: layer === "Global TEC" ? "flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* DLR map product, proxied through /tec/global-forecast-image (no-store) so Vercel stays current. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {globalTecSrc ? (
            <img
              src={globalTecSrc}
              alt="DLR IMPC one-hour forecast total electron content global map"
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          ) : (
            <div style={{ color: "#334", fontSize: 14, textAlign: "center", padding: "1rem" }}>
              {globalTecError
                ? `Global TEC map failed to load: ${globalTecError}. Check that the API server is running on :8000.`
                : "Loading Global TEC forecast…"}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <SiteDetailsPanel station={selected} heatmap={heatmap} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
