"use client";
import { useEffect, useRef, useState } from "react";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import { igrf14Epoch } from "@/lib/geomagneticEquator";
import { anomalyPaths, anomalyReading, dipLatitudeDeg } from "@/lib/igrf14Dip";
import { getLiveStationStatus } from "@/lib/liveStationStatus";
import { buildCorsNetworkEdges, isReferenceCorsStation } from "@/lib/corsNetworkDistances";
import type { ProposedCorsSite } from "@/lib/corsGeneticOptimizer";
import { isValidProposedCorsSite, ZIMBABWE_POLYGON } from "@/lib/zimbabweBoundary";
import { TELONE_CENTRES, teloneCentreHasCors } from "@/lib/teloneCentres";
import { formatPopulation, PROVINCE_POPULATION_2022 } from "@/lib/zimbabweDemographics";
import { icaoTecColor, icaoTecDistanceLabel, icaoTecLabel } from "@/lib/icaoTecAdvisory";
import { liveVtecSourceFromHeatmap, liveVtecSourceLabel } from "@/lib/liveVtecLabels";
import { measuredLiveTec } from "@/lib/measuredLiveTec";
import { fetchGlobalTecForecastObjectUrl, getZimbabweRoti, type ZimbabweRotiStation } from "@/lib/api";
import { startVisiblePolling } from "@/lib/visiblePolling";
import { vtecToRgba } from "@/lib/tecHeatmapColors";
import { loadOpenLayers } from "@/lib/loadOpenLayers";
import type { MapLayer } from "./CorsMapWithLayers";
import SiteDetailsPanel from "./SiteDetailsPanel";

interface Props {
  stations: Station[];
  height?: number;
  layer?: MapLayer;
  /** Imagery under the stations. Independent of TEC / network overlays. */
  basemap?: "Hybrid" | "Satellite" | "Street";
  heatmap?: TecHeatmapResponse | null;
  /** Station code → Gg / Cesaroni live VTEC (TECU) for dual labels on TEC Heat Map. */
  ggByStation?: Record<string, number | null>;
  proposedCorsSites?: ProposedCorsSite[];
  /** TelOne shops and data centres, chosen on the Network Distances map. */
  showTeloneCentres?: boolean;
  /** ZIMSTAT 2022 provincial population, chosen on the Network Distances map. */
  showDemographics?: boolean;
  /** Emphasize one station marker (e.g. uptime analysis selection). */
  highlightCode?: string | null;
  /** Fired when a CORS marker is clicked (or map background clears selection). */
  onStationSelect?: (station: Station | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#00ff88",
  offline: "#ff4444",
  unavailable: "#f8fafc",
  surveyor_general: "#e2e8f0",
};

/** Operational focus for the national CORS map (lon, lat). */
const ZIMBABWE_CENTER: [number, number] = [29.5, -19.0];
const ZIMBABWE_ZOOM = 6.2;
const GLOBAL_TEC_CENTER: [number, number] = [0, 0];
const GLOBAL_TEC_ZOOM = 2;
/** West and southern African partner networks in one initial frame. */
const TRIGNET_CENTER: [number, number] = [10.0, -10.0];
const TRIGNET_ZOOM = 2.7;
/** Whole-Earth dip equator, with Zimbabwe still inside the frame. */
const GEOMAGNETIC_CENTER: [number, number] = [0, 0];
const GEOMAGNETIC_ZOOM = 2;
const GEOMAGNETIC_LABEL_OFFSETS: Record<string, { x: number; y: number; align: "left" | "center" | "right" }> = {
  gutu: { x: 0, y: -16, align: "center" },
  kstd: { x: 0, y: 20, align: "center" },
  simo: { x: -18, y: -16, align: "right" },
  herg: { x: 18, y: -32, align: "left" },
  hnus: { x: 18, y: 32, align: "left" },
  byah: { x: -12, y: -24, align: "right" },
  rubo: { x: 12, y: 20, align: "left" },
  acsb: { x: -12, y: 20, align: "right" },
  agmt: { x: 12, y: -20, align: "left" },
  pccl: { x: -12, y: -28, align: "right" },
  fbaq: { x: 12, y: -8, align: "left" },
  iqqe: { x: -12, y: 8, align: "right" },
  gta1: { x: 12, y: 28, align: "left" },
  sgoc: { x: 12, y: -20, align: "left" },
  pohn: { x: 12, y: -20, align: "left" },
  pove: { x: -12, y: 16, align: "right" },
  adis: { x: 12, y: -20, align: "left" },
  naus: { x: 12, y: -20, align: "left" },
  isco: { x: -12, y: -20, align: "right" },
  cn46: { x: 12, y: 20, align: "left" },
  cn64: { x: -12, y: 20, align: "right" },
  cn47: { x: 12, y: -20, align: "left" },
};

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

function baseTileUrl(basemap: "Hybrid" | "Satellite" | "Street"): string {
  return basemap === "Street" ? STREET_URL : SATELLITE_URL;
}

function showStreetLabels(basemap: "Hybrid" | "Satellite" | "Street"): boolean {
  return basemap === "Hybrid";
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

const ROTI_MAP = {
  ticks: ["0.00", "0.25", "0.50", "0.75", "1.00+"],
  colors: ["#0b33ff", "#00c8ff", "#28f06a", "#ffe600", "#ff3b30"],
};

const ROTI_RGB = ROTI_MAP.colors.map(color =>
  [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)),
);

function buildRotiSurface(controls: { x: number; y: number; roti: number }[], bounds: number[]) {
  const raster = document.createElement("canvas");
  raster.width = raster.height = 128;
  const ctx = raster.getContext("2d");
  if (!ctx) return raster;
  const [west, south, east, north] = bounds;
  const pixels = ctx.createImageData(raster.width, raster.height);
  for (let row = 0; row < raster.height; row++) {
    const y = north - (row + 0.5) * (north - south) / raster.height;
    for (let col = 0; col < raster.width; col++) {
      const x = west + (col + 0.5) * (east - west) / raster.width;
      let total = 0;
      let weights = 0;
      for (const station of controls) {
        const weight = 1 / Math.max(1, (station.x - x) ** 2 + (station.y - y) ** 2);
        total += station.roti * weight;
        weights += weight;
      }
      const scale = Math.max(0, Math.min(1, total / weights)) * (ROTI_RGB.length - 1);
      const lower = Math.floor(scale);
      const upper = Math.min(lower + 1, ROTI_RGB.length - 1);
      const offset = (row * raster.width + col) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const start = ROTI_RGB[lower][channel];
        pixels.data[offset + channel] = start + (ROTI_RGB[upper][channel] - start) * (scale - lower);
      }
      pixels.data[offset + 3] = 150;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return raster;
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
  if (liveStatus !== "online") return null;
  const measured = measuredLiveTec(heatStation);
  if (measured != null) return measured;
  const cardTec =
    typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
      ? station.current_tec
      : null;
  return cardTec;
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

function formatDualTecLabel(code: string, gopi: number | null, gg: number | null, provisional = false): string {
  const id = code.toUpperCase();
  const g = provisional ? "G*" : "G";
  if (gopi != null && gg != null) {
    return `${id}\n${g} ${gopi.toFixed(1)}\nGg ${gg.toFixed(1)}`;
  }
  if (gopi != null) return `${id}\n${g} ${gopi.toFixed(1)}`;
  if (gg != null) return `${id}\nGg ${gg.toFixed(1)}`;
  return id;
}

function formatGeomagneticLabel(code: string, gopi: number | null, gg: number | null = null): string {
  const key = code.toLowerCase().replace(/_+$/, "");
  const id = key === "zinh" ? "HARARE" : code.toUpperCase();
  if (key === "kstd" && gg != null) return `${id} Gg ${gg.toFixed(1)}`;
  if (["simo", "herg", "hnus"].includes(key)) {
    return [id, gopi != null ? `G ${gopi.toFixed(1)}` : null, gg != null ? `Gg ${gg.toFixed(1)}` : null].filter(Boolean).join("\n");
  }
  return gopi != null ? `${id} G ${gopi.toFixed(1)}` : id;
}

/** Lower rank is drawn first and keeps its label when the world view overlaps Zimbabwe. */
function geomagneticLabelRank(station: { code?: string; status?: string; status_source?: string } | undefined): number {
  if (!station) return 9;
  const code = String(station.code ?? "").toLowerCase().replace(/_+$/, "");
  const status = getLiveStationStatus(station as Station);
  if (code === "gutu") return 0;
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
  basemap = layer === "Satellite" || layer === "Street" ? layer : "Hybrid",
  heatmap = null,
  ggByStation = {},
  proposedCorsSites = [],
  showTeloneCentres = true,
  showDemographics = true,
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
  const contextLayerRef = useRef<any>(null);
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
  const basemapRef = useRef(basemap);
  const proposedSitesRef = useRef(proposedCorsSites);
  const showTeloneRef = useRef(showTeloneCentres);
  const showDemographicsRef = useRef(showDemographics);
  const highlightCodeRef = useRef(highlightCode);
  const onStationSelectRef = useRef(onStationSelect);
  /** Tracks layer used for the last view animation — ignore heatmap-only updates. */
  const viewLayerRef = useRef<MapLayer | null>(null);
  /** TrigNet must frame the African partner networks once the map exists. */
  const trigNetFramedRef = useRef(false);
  const [selected, setSelected] = useState<Station | null>(null);
  const [globalTecSrc, setGlobalTecSrc] = useState<string | null>(null);
  const [globalTecError, setGlobalTecError] = useState<string | null>(null);
  const [roti, setRoti] = useState<ZimbabweRotiStation[] | null>(null);
  const [rotiFailed, setRotiFailed] = useState(false);
  useEffect(() => {
    if (!isZimbabweScienceLayer(layer)) return;
    let active = true;
    setRoti(null);
    setRotiFailed(false);
    const stop = startVisiblePolling(async () => {
      try {
        const payload = await getZimbabweRoti();
        if (active) {
          setRoti(payload.stations);
          setRotiFailed(false);
        }
      } catch {
        if (active) {
          setRoti(null);
          setRotiFailed(true);
        }
      }
    }, 60_000);
    return () => { active = false; stop(); };
  }, [layer]);
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;
  stationsRef.current = stations;
  heatmapRef.current = heatmap;
  ggByStationRef.current = ggByStation;
  layerRef.current = layer;
  basemapRef.current = basemap;
  proposedSitesRef.current = proposedCorsSites;
  showTeloneRef.current = showTeloneCentres;
  showDemographicsRef.current = showDemographics;
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
    return list.flatMap((s) => {
      if (!Number.isFinite(s.lon) || !Number.isFinite(s.lat)) return [];
      const f = new Feature({ geometry: new Point(fromLonLat([s.lon, s.lat])), station: s });
      const liveStatus = getLiveStationStatus(s);
      const connected = liveStatus === "online";
      const measuredTec = connected ? stationTecValue(s, heatmapRef.current) : null;
      const measuredGg = connected || geomagnetic ? stationGgValue(s, ggByStationRef.current) : null;
      const tecValue = measuredTec;
      const ggValue = measuredGg;
      const trigTec =
        trigNet && typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0
          ? s.current_tec
          : null;
      const labelG = trigNet ? trigTec : tecValue;
      const labelGg = geomagnetic ? null : trigNet ? ggValue : showTecLabels ? ggValue : null;
      const isRef = networkMode && isReferenceCorsStation(s);
      const isHighlight = Boolean(highlight) && stationKey(s.code) === highlight;
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
      const labelOffset = geomagnetic ? GEOMAGNETIC_LABEL_OFFSETS[stationKey(s.code)] : undefined;
      const alwaysVisible = labelOffset != null;
      const label = geomagnetic
        ? !alwaysVisible && (liveStatus === "offline" || liveStatus === "unavailable")
          ? ""
          : formatGeomagneticLabel(s.code, liveStatus === "online" ? tecValue : null, ggValue)
        : trigNet
        ? labelG == null && labelGg == null && connected
          ? `${s.code.toUpperCase()}\nTEC pending`
          : formatDualTecLabel(s.code, labelG, labelGg, s.tec_provisional)
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
            declutterMode: alwaysVisible ? "none" : undefined,
            radius: isHighlight ? baseRadius + 3 : baseRadius,
            fill: new Fill({ color: markerColor }),
            stroke: new Stroke({
              color: isHighlight ? "#ffd166" : "#fff",
              width: isHighlight ? 3 : 1.5,
            }),
          }),
          text: new Text({
            declutterMode: alwaysVisible ? "none" : undefined,
            text: label,
            offsetX: labelOffset?.x ?? 0,
            offsetY: labelOffset?.y ?? (geomagnetic ? -16 : dualLines ? (narrowMap ? -22 : -30) : trigTec != null || (showTecLabels && !networkMode) ? -22 : -14),
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: narrowMap ? 2 : 3 }),
            font: dualLines
              ? narrowMap
                ? "bold 9px sans-serif"
                : "bold 10px sans-serif"
              : showTecLabels && !networkMode
                ? "bold 11px sans-serif"
                : "bold 10px sans-serif",
            textAlign: labelOffset?.align ?? "center",
          }),
        }),
      );
      return [f];
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

  const syncContextLayers = async () => {
    const map = olMapRef.current;
    if (!map) return;

    if (contextLayerRef.current) {
      map.removeLayer(contextLayerRef.current);
      contextLayerRef.current = null;
    }

    const onNetwork = layerRef.current === "Network Distances";
    const showTelone = onNetwork && showTeloneRef.current;
    const showDemo = onNetwork && showDemographicsRef.current;
    if (!showTelone && !showDemo) return;

    const helpers = olHelpersRef.current;
    if (!helpers) return;
    const { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text, VectorSource, VectorLayer } =
      helpers;

    const source = new VectorSource();

    if (showDemo) {
      const maxPop = Math.max(...PROVINCE_POPULATION_2022.map((p) => p.population));
      for (const province of PROVINCE_POPULATION_2022) {
        const share = province.population / maxPop;
        const radius = (onNetwork ? 11 : 16) + share * (onNetwork ? 10 : 14);
        const feature = new Feature({
          geometry: new Point(fromLonLat([province.lon, province.lat])),
          province,
        });
        feature.setStyle(
          new Style({
            image: new Circle({
              radius,
              fill: new Fill({ color: `rgba(249, 115, 22, ${onNetwork ? 0.28 : 0.55})` }),
              stroke: new Stroke({ color: "#ffedd5", width: 1.5 }),
            }),
            text: new Text({
              text: onNetwork
                ? province.name
                : `${province.name}\n${formatPopulation(province.population)}`,
              offsetY: onNetwork ? 0 : radius + 14,
              fill: new Fill({ color: "#ffedd5" }),
              stroke: new Stroke({ color: "#000", width: 3 }),
              font: "bold 11px sans-serif",
              textAlign: "center",
            }),
          }),
        );
        source.addFeature(feature);
      }
    }

    if (showTelone) {
      const teloneDrawOrder = [
        ...TELONE_CENTRES.filter((centre) => centre.kind !== "data-centre"),
        ...TELONE_CENTRES.filter((centre) => centre.kind === "data-centre"),
      ];
      for (const centre of teloneDrawOrder) {
        const dataCentre = centre.kind === "data-centre";
        const hasCors = teloneCentreHasCors(centre);
        const feature = new Feature({
          geometry: new Point(fromLonLat([centre.lon, centre.lat])),
          telone: centre,
        });
        feature.setStyle(
          new Style({
            image: new Circle({
              radius: dataCentre ? (onNetwork ? 8 : 10) : onNetwork ? 5 : 7,
              fill: new Fill({
                color: hasCors ? "rgba(0,0,0,0)" : dataCentre ? "#e879f9" : "#22d3ee",
              }),
              stroke: new Stroke({
                color: dataCentre ? "#e879f9" : "#22d3ee",
                width: hasCors ? 2.5 : 1.5,
              }),
            }),
            text: new Text({
              text:
                onNetwork && hasCors
                  ? ""
                  : dataCentre
                    ? onNetwork
                      ? centre.name.replace(" Data Centre", " DC")
                      : `${centre.name}\n${centre.town}`
                    : onNetwork
                      ? centre.name
                      : `${centre.name}\n${hasCors ? "CORS installed" : centre.town}`,
              offsetY: dataCentre ? (onNetwork ? -20 : -24) : onNetwork ? -12 : -16,
              fill: new Fill({ color: dataCentre ? "#f5d0fe" : "#a5f3fc" }),
              stroke: new Stroke({ color: "#000", width: 3 }),
              font: "bold 10px sans-serif",
              textAlign: "center",
            }),
          }),
        );
        source.addFeature(feature);
      }
    }

    const layer = new VectorLayer({ source, zIndex: 3.5 });
    map.addLayer(layer);
    contextLayerRef.current = layer;
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

  useEffect(() => {
    const map = olMapRef.current;
    if (!mapReady || !map || !isZimbabweScienceLayer(layer) || !roti?.length) return;
    let active = true;
    void loadOpenLayers().then(({ fromLonLat, ImageLayer, ImageCanvas }) => {
      if (!active) return;
      const border = ZIMBABWE_POLYGON.map(point => fromLonLat([...point]));
      const xs = border.map(([x]) => x);
      const ys = border.map(([, y]) => y);
      const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const controls = roti.map(station => {
        const [x, y] = fromLonLat([station.lon, station.lat]);
        return { ...station, x, y };
      });
      const surface = buildRotiSurface(controls, bounds);
      const source = new ImageCanvas({
        projection: "EPSG:3857",
        canvasFunction: (extent: number[], _resolution: number, pixelRatio: number, size: number[]) => {
          const canvas = document.createElement("canvas");
          [canvas.width, canvas.height] = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return canvas;
          const [minX, minY, maxX, maxY] = extent;
          const pixelX = (x: number) => (x - minX) / (maxX - minX) * canvas.width;
          const pixelY = (y: number) => (maxY - y) / (maxY - minY) * canvas.height;
          const [west, south, east, north] = bounds;
          ctx.save();
          ctx.beginPath();
          border.forEach(([x, y], i) => {
            if (i === 0) ctx.moveTo(pixelX(x), pixelY(y));
            else ctx.lineTo(pixelX(x), pixelY(y));
          });
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(surface, pixelX(west), pixelY(north),
            pixelX(east) - pixelX(west), pixelY(south) - pixelY(north));
          ctx.restore();
          ctx.font = `bold ${12 * pixelRatio}px sans-serif`;
          ctx.textAlign = "center";
          for (const station of controls) {
            const px = pixelX(station.x);
            const py = pixelY(station.y);
            ctx.beginPath();
            ctx.arc(px, py, 8 * pixelRatio, 0, 2 * Math.PI);
            ctx.fillStyle = ROTI_MAP.colors[Math.min(4, Math.floor(station.roti * 4))];
            ctx.fill();
            ctx.lineWidth = 1.5 * pixelRatio;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
            const label = `${station.code.toUpperCase()} ${station.roti.toFixed(2)}`;
            ctx.lineWidth = 3 * pixelRatio;
            ctx.strokeStyle = "#080e18";
            ctx.strokeText(label, px, py - 12 * pixelRatio);
            ctx.fillStyle = "#fff";
            ctx.fillText(label, px, py - 12 * pixelRatio);
          }
          return canvas;
        },
      });
      const overlay = new ImageLayer({ source, zIndex: 4.5 });
      map.addLayer(overlay);
      scienceLayerRef.current = overlay;
    }).catch(() => { if (active) setRotiFailed(true); });
    return () => {
      active = false;
      if (scienceLayerRef.current) map.removeLayer(scienceLayerRef.current);
      scienceLayerRef.current = null;
    };
  }, [layer, mapReady, roti]);

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
        source: new XYZ({ url: baseTileUrl(basemapRef.current), attributions: "Esri" }),
        zIndex: 0,
      });
      const labelTile = new TileLayer({
        source: new XYZ({ url: LABEL_URL, attributions: "Esri Reference" }),
        visible: showStreetLabels(basemapRef.current),
        zIndex: 2,
        opacity: 0.95,
      });
      const transportTile = new TileLayer({
        source: new XYZ({ url: TRANSPORT_URL, attributions: "Esri Reference" }),
        visible: showStreetLabels(basemapRef.current),
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
          const telone = f.get("telone");
          const province = f.get("province");
          if (telone && !f.get("station")) {
            const corsNote = teloneCentreHasCors(telone)
              ? "A CORS station is already installed at this TelOne centre."
              : "No CORS station is installed at this TelOne centre yet.";
            popupEl.innerHTML =
              telone.kind === "data-centre"
                ? `<b>TelOne ${telone.name}</b><div style="color:#f5d0fe">${telone.town}</div><div style="margin-top:0.2rem;color:#ffffff;font-size:0.72rem">${telone.address}</div><div style="margin-top:0.2rem;color:#94a3b8;font-size:0.68rem">${corsNote} Listed for TelOne data-centre services. Pin is the published address.</div>`
                : `<b>TelOne ${telone.name}</b><div style="color:#a5f3fc">${telone.town}</div><div style="margin-top:0.2rem;color:#ffffff;font-size:0.72rem">${telone.address}</div><div style="margin-top:0.2rem;color:#94a3b8;font-size:0.68rem">${corsNote} Shop from telone.co.zw/shops. Pin is the named town or suburb.</div>`;
            popup.setPosition(f.getGeometry()?.getCoordinates?.() ?? evt.coordinate);
            popupEl.style.display = "block";
            return;
          }
          if (province && !f.get("station")) {
            popupEl.innerHTML = `<b>${province.name}</b><div style="color:#fdba74;font-weight:700">${formatPopulation(province.population)}</div><div style="color:#ffffff;font-size:0.72rem">${Number(province.households).toLocaleString("en-ZW")} households</div><div style="margin-top:0.2rem;color:#94a3b8;font-size:0.68rem">ZIMSTAT 2022 census. Bubble is a planning centre, not a district boundary.</div>`;
            popup.setPosition(f.getGeometry()?.getCoordinates?.() ?? evt.coordinate);
            popupEl.style.display = "block";
            return;
          }
          const s: Station = f.get("station");
          if (!s) return;
          const trigNetClick = layerRef.current === "TrigNet";
          const cardTec =
            typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0
              ? s.current_tec
              : null;
          const connected = getLiveStationStatus(s) === "online";
          const measuredTec = connected ? stationTecValue(s, heatmapRef.current) : null;
          const measuredGg = connected ? stationGgValue(s, ggByStationRef.current) : null;
          const tecValue = trigNetClick ? cardTec : measuredTec;
          const ggValue = measuredGg;
          const heatmapStation = heatmapStationFor(s, heatmapRef.current);
          setSelectedRef.current(s);
          onStationSelectRef.current?.(s);
          const icaoLine =
            tecValue != null && !s.tec_provisional
              ? `<div style="margin-top:0.25rem;color:${icaoTecColor(tecValue)};font-weight:700">${icaoTecLabel(tecValue)}</div>`
              : "";
          const distLine =
            tecValue != null && !s.tec_provisional && icaoTecDistanceLabel(tecValue)
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
              ? `<div style="color:#38bdf8;font-weight:800">GOPI${s.tec_provisional ? " G* (provisional raw)" : ""} ${tecValue.toFixed(1)} TECU</div>`
              : "";
          const ggLine =
            ggValue != null
              ? `<div style="color:#f59e0b;font-weight:800">Gg = Cesaroni ${ggValue.toFixed(1)} TECU</div>`
              : "";
          const deltaLine =
            tecValue != null && ggValue != null
              ? `<div style="color:#ffffff;font-size:0.72rem;font-weight:700">Δ (Gg−G) ${(ggValue - tecValue).toFixed(1)} TECU</div>`
              : "";
          const tecSourceLine = trigNetClick
            ? `<div style="color:#ffffff;font-size:0.68rem">${
                s.status_source === "catalog"
                  ? "G = GOPI · Gg = Cesaroni · latest TrigNet RINEX hour"
                  : s.site_server === "SANSA"
                    ? "G = measured SANSA code VTEC · provisional, uncalibrated"
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
      await syncNetworkLayer();
      await syncProposedSitesLayer();
      await syncContextLayers();
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
      contextLayerRef.current = null;
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
    void syncContextLayers();
  }, [proposedCorsSites, layer, showTeloneCentres, showDemographics]);

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

      baseTile.setSource(new XYZ({ url: baseTileUrl(basemap), attributions: "Esri" }));
      const roads = showStreetLabels(basemap);
      labelTile.setVisible(roads);
      transportTile.setVisible(roads);

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
      if (cancelled) return;
      await syncNetworkLayer();
      if (cancelled) return;
      await syncProposedSitesLayer();
      if (cancelled) return;
      await syncContextLayers();
      if (cancelled) return;
      await syncGeomagneticLayer();
    })();
    return () => {
      cancelled = true;
    };
  }, [layer, basemap, heatmap, ggByStation, mapReady]);

  return (
    <div
      className="cors-map-shell"
      style={{ position: "relative", width: "100%", height, display: "flex", zIndex: 0 }}
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
                Zimbabwe ROTI Map
              </div>
              <div style={{ fontSize: "0.84rem", fontWeight: 800, marginTop: "0.2rem" }}>
                Carrier-phase ROTI · 5-minute windows
              </div>
              <div style={{ fontSize: "0.66rem", color: "#ffffff", marginTop: "0.35rem", lineHeight: 1.45 }}>
                {rotiFailed ? "The ROTI feed is temporarily unavailable."
                  : roti === null ? "Loading carrier-phase observations…"
                  : roti.length === 1 ? "Uniform estimate from 1 station. The labeled marker shows the measurement."
                  : roti.length ? `Interpolated from ${roti.length} stations. Labeled markers show measurements.`
                  : "No recent station has a usable carrier-phase arc."}
                {" · "}<a href="https://doi.org/10.1029/2020RS007140" target="_blank" rel="noreferrer" style={{ pointerEvents: "auto", color: "#63c7ff" }}>Carmo et al. (2021), Method 4</a>
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
                <strong style={{ fontSize: "0.75rem" }}>TECU/min</strong>
                <span style={{ fontSize: "0.65rem", color: "#0b1220" }}>Zimbabwe CORS product</span>
              </div>
              <div
                style={{
                  height: "14px",
                  marginTop: "0.45rem",
                  border: "1px solid rgba(15,23,42,0.35)",
                  background: `linear-gradient(90deg, ${ROTI_MAP.colors.join(", ")})`,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", marginTop: "0.28rem", fontWeight: 700 }}>
                {ROTI_MAP.ticks.map((tick) => (
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
