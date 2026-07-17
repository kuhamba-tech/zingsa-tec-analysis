"use client";
import { useEffect, useRef, useState } from "react";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import { getLiveStationStatus } from "@/lib/liveStationStatus";
import { icaoTecColor, icaoTecDistanceLabel, icaoTecLabel } from "@/lib/icaoTecAdvisory";
import { vtecToRgba } from "@/lib/tecHeatmapColors";
import type { MapLayer } from "./CorsMapWithLayers";
import SiteDetailsPanel from "./SiteDetailsPanel";

interface Props {
  stations: Station[];
  height?: number;
  layer?: MapLayer;
  heatmap?: TecHeatmapResponse | null;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#00ff88",
  degraded: "#ff8c00",
  offline: "#ff4444",
  unavailable: "#666",
};

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREET_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TRANSPORT_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";
const GLOBAL_TEC_IMAGE_URL =
  "https://data.impc.dlr.de/tec-forecast/DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL/latest/DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL_latest_I.png";
const NOAA_API_URL = "https://www.ncei.noaa.gov/cloud-access/space-weather-portal/api/v1";
const NOAA_API_TIMEOUT_MS = 7000;

type NoaaProduct = {
  product: string;
  title: string;
  satellite: string;
  instrument: string;
  level: string;
  quality: string;
};

const NOAA_SWPC_MODEL_PRODUCTS: NoaaProduct[] = [
  {
    product: "glotec",
    title: "Global Total Electron Content model",
    satellite: "SWPC-Models",
    instrument: "GLOTEC",
    level: "L4",
    quality: "ops",
  },
  {
    product: "ustec",
    title: "U.S. Total Electron Content model",
    satellite: "SWPC-Models",
    instrument: "USTEC",
    level: "L4",
    quality: "ops",
  },
  {
    product: "SWX_DRAP20",
    title: "D-Region Absorption Predictions model",
    satellite: "SWPC-Models",
    instrument: "DRAP",
    level: "L4",
    quality: "ops",
  },
  {
    product: "swpc_wsaenlil_bkg",
    title: "WSA-Enlil Solar Wind Prediction model: Background",
    satellite: "SWPC-Models",
    instrument: "ENLIL",
    level: "L4",
    quality: "ops",
  },
  {
    product: "swpc_wsaenlil_cme",
    title: "WSA-Enlil Solar Wind Prediction model: CME",
    satellite: "SWPC-Models",
    instrument: "ENLIL",
    level: "L4",
    quality: "ops",
  },
];

function baseTileUrl(layer: MapLayer): string {
  if (layer === "NOAA API") return OSM_URL;
  return layer === "Street" ? STREET_URL : SATELLITE_URL;
}

function usesHybridOverlays(layer: MapLayer): boolean {
  return (
    layer === "Hybrid" ||
    layer === "TEC Heat Map" ||
    layer === "Zimbabwe TEC Map" ||
    layer === "Zimbabwe ROTI Map" ||
    layer === "Scintillation Map" ||
    layer === "PWV Map"
  );
}

function heatOverlayOpacity(layer: MapLayer): number {
  return layer === "TEC Heat Map" ? 0.78 : 0.65;
}

function shouldShowHeatOverlay(layer: MapLayer, heatmap: TecHeatmapResponse | null | undefined): boolean {
  if (layer !== "TEC Heat Map" && layer !== "Zimbabwe TEC Map") return false;
  if (!heatmap?.available) return false;
  if (heatmap.grid) return true;
  return (heatmap.heat_points?.length ?? 0) >= 1;
}

function isZimbabweScienceLayer(layer: MapLayer): boolean {
  return layer === "Zimbabwe TEC Map" || layer === "Zimbabwe ROTI Map" || layer === "Scintillation Map" || layer === "PWV Map";
}

function scienceLayerMeta(layer: MapLayer) {
  if (layer === "Zimbabwe ROTI Map") {
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
  if (layer === "Scintillation Map") {
    return {
      title: "Zimbabwe Scintillation Map",
      subtitle: "S4 amplitude scintillation · GNSS signal fading risk",
      unit: "S4",
      note: "S4 above 0.5 is severe and can cause loss of lock on precision GNSS.",
      ticks: ["0.0", "0.2", "0.4", "0.6", "0.8+"],
      colors: ["#1236ff", "#00b8ff", "#2df06f", "#ffcf33", "#ff355e"],
      contours: ["0.2", "0.4", "0.6"],
    };
  }
  if (layer === "PWV Map") {
    return {
      title: "Zimbabwe PWV Map",
      subtitle: "Precipitable Water Vapour · GNSS meteorology product",
      unit: "mm",
      note: "PWV uses GNSS zenith delay to estimate atmospheric water vapour.",
      ticks: ["0", "15", "30", "45", "60+"],
      colors: ["#2532ff", "#00a9ff", "#22e080", "#ffe45c", "#ff8a00"],
      contours: ["15", "30", "45"],
    };
  }
  return {
    title: "Zimbabwe TEC Map",
    subtitle: "Vertical Total Electron Content · Zimbabwe CORS network",
    unit: "TECU",
    note: "TEC indicates ionospheric electron density. Higher TEC increases GNSS range delay.",
    ticks: ["0", "20", "40", "60", "80+"],
    colors: ["#1734ff", "#00c4ff", "#22ef72", "#fff000", "#ff3b30"],
    contours: ["20", "40", "60"],
  };
}

function scienceLayerLabelPositions(layer: MapLayer): Array<{ label: string; lon: number; lat: number }> {
  const meta = scienceLayerMeta(layer);
  if (layer === "Scintillation Map") {
    return [
      { label: meta.contours[0], lon: -58, lat: 12 },
      { label: meta.contours[1], lon: 8, lat: -2 },
      { label: meta.contours[2], lon: 58, lat: -18 },
    ];
  }
  if (layer === "PWV Map") {
    return [
      { label: meta.contours[0], lon: -55, lat: -8 },
      { label: meta.contours[1], lon: 18, lat: -15 },
      { label: meta.contours[2], lon: 66, lat: -23 },
    ];
  }
  if (layer === "Zimbabwe ROTI Map") {
    return [
      { label: meta.contours[0], lon: -62, lat: 4 },
      { label: meta.contours[1], lon: 2, lat: -6 },
      { label: meta.contours[2], lon: 55, lat: -20 },
    ];
  }
  return [
    { label: meta.contours[0], lon: -62, lat: -4 },
    { label: meta.contours[1], lon: 4, lat: -10 },
    { label: meta.contours[2], lon: 58, lat: -18 },
  ];
}

function noaaProductLevel(product: NoaaProduct): "tec" | "model" | "satellite" {
  if (/tec|glotec|ustec/i.test(`${product.product} ${product.title} ${product.instrument}`)) return "tec";
  if (/model|enlil|drap/i.test(`${product.product} ${product.title} ${product.instrument}`)) return "model";
  return "satellite";
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

function isInterpolatedSource(source: string | null | undefined): boolean {
  return /estimate|interpolated|surface/i.test(source ?? "");
}

function stationTecValue(station: Station, heatmap: TecHeatmapResponse | null | undefined): number | null {
  const fromHeatmap = heatmapStationFor(station, heatmap)?.vtec;
  if (typeof fromHeatmap === "number" && Number.isFinite(fromHeatmap) && fromHeatmap >= 0) {
    return fromHeatmap;
  }
  const liveStatus = getLiveStationStatus(station);
  if (liveStatus === "offline" || liveStatus === "unavailable") return null;
  return typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
    ? station.current_tec
    : null;
}

export default function CorsMap({ stations, height = 420, layer = "Hybrid", heatmap = null }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupElementRef = useRef<HTMLDivElement | null>(null);
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
  const vectorSourceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olHelpersRef = useRef<any>(null);
  const stationsRef = useRef(stations);
  const heatmapRef = useRef(heatmap);
  const layerRef = useRef(layer);
  const [selected, setSelected] = useState<Station | null>(null);
  const [noaaProducts, setNoaaProducts] = useState<NoaaProduct[]>([]);
  const [noaaStatus, setNoaaStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const scienceMeta = scienceLayerMeta(layer);
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;
  stationsRef.current = stations;
  heatmapRef.current = heatmap;
  layerRef.current = layer;

  const buildFeatures = (list: Station[]) => {
    const helpers = olHelpersRef.current;
    if (!helpers) return [];
    const { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text } = helpers;
    const showTecLabels = layerRef.current === "TEC Heat Map";
    return list.map((s) => {
      const f = new Feature({ geometry: new Point(fromLonLat([s.lon, s.lat])), station: s });
      const tecValue = stationTecValue(s, heatmapRef.current);
      const label = showTecLabels && tecValue != null
        ? `${s.code.toUpperCase()}\n${tecValue.toFixed(1)}`
        : s.code.toUpperCase();
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 7,
            fill: new Fill({ color: STATUS_COLOR[getLiveStationStatus(s)] }),
            stroke: new Stroke({ color: "#fff", width: 1.5 }),
          }),
          text: new Text({
            text: label,
            offsetY: showTecLabels ? -22 : -14,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: showTecLabels ? "bold 11px sans-serif" : "bold 10px sans-serif",
            textAlign: "center",
          }),
        }),
      );
      return f;
    });
  };

  const syncStationFeatures = (list: Station[]) => {
    const source = vectorSourceRef.current;
    if (!source) return;
    source.clear();
    source.addFeatures(buildFeatures(list));
  };

  const buildHeatLayer = async () => {
    const data = heatmapRef.current;
    const currentLayer = layerRef.current;
    if (!shouldShowHeatOverlay(currentLayer, data) || !data) return null;

    const { fromLonLat } = await import("ol/proj");
    const ImageLayer = (await import("ol/layer/Image")).default;
    const ImageCanvas = (await import("ol/source/ImageCanvas")).default;
    const overlayOpacity = heatOverlayOpacity(currentLayer);
    const grid = data.grid;
    const heatPoints = data.heat_points;
    const projectCoord = (coord: [number, number]): [number, number] => {
      const projected = fromLonLat(coord);
      return [projected[0] ?? 0, projected[1] ?? 0];
    };

    const source = new ImageCanvas({
      projection: "EPSG:3857",
      canvasFunction: (extent, _resolution, _pixelRatio, size) => {
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

    const { fromLonLat } = await import("ol/proj");
    const ImageLayer = (await import("ol/layer/Image")).default;
    const ImageCanvas = (await import("ol/source/ImageCanvas")).default;
    const meta = scienceLayerMeta(currentLayer);
    const labels = scienceLayerLabelPositions(currentLayer);

    const source = new ImageCanvas({
      projection: "EPSG:3857",
      canvasFunction: (extent, _resolution, _pixelRatio, size) => {
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
      padding: "0.45rem 0.7rem",
      fontSize: "0.75rem",
      color: "#fff",
      pointerEvents: "none",
      zIndex: "10",
    });
    popupElementRef.current = popupEl;

    let disposed = false;

    (async () => {
      const ol = await import("ol");
      const { fromLonLat } = await import("ol/proj");
      const TileLayer = (await import("ol/layer/Tile")).default;
      const VectorLayer = (await import("ol/layer/Vector")).default;
      const VectorSource = (await import("ol/source/Vector")).default;
      const XYZ = (await import("ol/source/XYZ")).default;
      const Feature = (await import("ol/Feature")).default;
      const Point = (await import("ol/geom/Point")).default;
      const { Style, Circle, Fill, Stroke, Text } = await import("ol/style");
      const Overlay = (await import("ol/Overlay")).default;
      const View = (await import("ol/View")).default;

      if (disposed || olMapRef.current) return;

      olHelpersRef.current = { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text };

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

      const vectorSource = new VectorSource();
      vectorSourceRef.current = vectorSource;
      syncStationFeatures(stationsRef.current);

      const popup = new Overlay({ element: popupEl, positioning: "bottom-center", offset: [0, -14] });

      const layers = [baseTile, labelTile, transportTile, new VectorLayer({ source: vectorSource, zIndex: 4 })];
      const map = new ol.Map({
        target: container,
        layers,
        view: new View({ center: fromLonLat([29.5, -19.0]), zoom: 6 }),
        overlays: [popup],
        controls: [],
      });

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
          const tecValue = stationTecValue(s, heatmapRef.current);
          const heatmapStation = heatmapStationFor(s, heatmapRef.current);
          setSelectedRef.current(s);
          const icaoLine =
            tecValue != null
              ? `<div style="margin-top:0.25rem;color:${icaoTecColor(tecValue)};font-weight:700">${icaoTecLabel(tecValue)}</div>`
              : "";
          const distLine =
            tecValue != null && icaoTecDistanceLabel(tecValue)
              ? `<div style="color:#94a3b8;font-size:0.68rem">${icaoTecDistanceLabel(tecValue)}</div>`
              : "";
          const tecLine =
            tecValue != null
              ? `<div style="color:#57ff65;font-weight:800">${tecValue.toFixed(1)} TECU</div>`
              : "";
          const tecSourceLine =
            heatmapStation && isInterpolatedSource(heatmapStation.source)
              ? `<div style="color:#94a3b8;font-size:0.68rem">Interpolated TEC estimate</div>`
              : "";
          const sourcetableLine = s.sourcetable_mismatch
            ? `<div style="margin-top:0.2rem;color:#ef9f27;font-weight:700">Warning: Shares caster identity with "${s.sourcetable_identifier}"</div>`
            : "";
          popupEl.innerHTML = `<b>${s.code.toUpperCase()}</b>${tecLine}${tecSourceLine}${icaoLine}${distLine}${sourcetableLine}<div style="margin-top:0.2rem;color:#94a3b8">Click Details →</div>`;
          popup.setPosition(evt.coordinate);
          popupEl.style.display = "block";
        } else {
          setSelectedRef.current(null);
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
    })();

    return () => {
      disposed = true;
      if (olMapRef.current) {
        olMapRef.current.dispose();
        olMapRef.current = null;
      }
      baseTileRef.current = null;
      labelTileRef.current = null;
      transportTileRef.current = null;
      heatLayerRef.current = null;
      scienceLayerRef.current = null;
      vectorSourceRef.current = null;
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
  }, [stations]);

  useEffect(() => {
    if (layer !== "NOAA API" || noaaStatus === "ready" || noaaStatus === "loading") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), NOAA_API_TIMEOUT_MS);
    setNoaaStatus("loading");
    setNoaaProducts(NOAA_SWPC_MODEL_PRODUCTS);
    fetch(`${NOAA_API_URL}/products?sat=SWPC-Models`, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`NOAA API returned ${res.status}`);
        return res.json();
      })
      .then((payload: { data?: NoaaProduct[] }) => {
        if (cancelled) return;
        const products = (payload.data ?? []).filter((item) => item?.product && item?.title);
        setNoaaProducts(products);
        setNoaaStatus(products.length > 0 ? "ready" : "fallback");
      })
      .catch(() => {
        if (cancelled) return;
        setNoaaProducts(NOAA_SWPC_MODEL_PRODUCTS);
        setNoaaStatus("fallback");
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [layer, noaaStatus]);

  useEffect(() => {
    if (!baseTileRef.current || !labelTileRef.current || !transportTileRef.current) return;
    (async () => {
      const XYZ = (await import("ol/source/XYZ")).default;
      const { fromLonLat } = await import("ol/proj");
      baseTileRef.current.setSource(new XYZ({ url: baseTileUrl(layer), attributions: "Esri" }));
      const hybrid = usesHybridOverlays(layer);
      labelTileRef.current.setVisible(hybrid);
      transportTileRef.current.setVisible(hybrid);
      if ((layer === "Global TEC" || layer === "NOAA API") && olMapRef.current) {
        olMapRef.current.getView().animate({ center: fromLonLat([0, 0]), zoom: 2, duration: 250 });
      }
      syncStationFeatures(stationsRef.current);
      await syncHeatLayer();
      await syncScienceLayer();
    })();
  }, [layer, heatmap]);

  return (
    <div
      className="cors-map-shell"
      style={{ position: "relative", width: "100%", height, display: "flex" }}
    >
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapRef} className="map-container" style={{ width: "100%", height: "100%" }} />
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
              <div style={{ fontSize: "0.66rem", color: "#cbd5e1", marginTop: "0.35rem", lineHeight: 1.45 }}>
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
                <span style={{ fontSize: "0.65rem", color: "#334155" }}>Zimbabwe CORS product</span>
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
          {/* DLR publishes this as a composed map product, so render it intact instead of georectifying a crop. */}
          <img
            src={GLOBAL_TEC_IMAGE_URL}
            alt="DLR IMPC one-hour forecast total electron content global map"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
        {layer === "NOAA API" && (
          <>
            <div
              style={{
                position: "absolute",
                top: "12px",
                left: "12px",
                zIndex: 6,
                width: "min(430px, calc(100% - 24px))",
                background: "rgba(2, 8, 18, 0.88)",
                border: "1px solid #168bd2",
                borderRadius: "8px",
                padding: "0.75rem 0.9rem",
                color: "#ffffff",
                boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: "0.68rem", fontWeight: 900, textTransform: "uppercase", color: "#63c7ff" }}>
                    NOAA NCEI Space Weather Portal
                  </div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 900, marginTop: "0.15rem" }}>
                    SWPC model products on OpenStreetMap
                  </div>
                </div>
                <a
                  href={NOAA_API_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: "#000",
                    background: "#63c7ff",
                    borderRadius: "6px",
                    padding: "0.35rem 0.55rem",
                    fontSize: "0.68rem",
                    fontWeight: 900,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  API
                </a>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "0.45rem",
                  marginTop: "0.65rem",
                }}
              >
                {(noaaProducts.length > 0 ? noaaProducts : []).slice(0, 6).map((product) => {
                  const level = noaaProductLevel(product);
                  const color = level === "tec" ? "#00ff88" : level === "model" ? "#ffb347" : "#63c7ff";
                  return (
                    <div
                      key={product.product}
                      style={{
                        minWidth: 0,
                        border: `1px solid ${color}`,
                        borderRadius: "7px",
                        padding: "0.45rem",
                        background: "rgba(8, 20, 35, 0.86)",
                      }}
                    >
                      <div style={{ color, fontSize: "0.68rem", fontWeight: 900, overflowWrap: "anywhere" }}>
                        {product.product}
                      </div>
                      <div style={{ fontSize: "0.62rem", color: "#dbeafe", marginTop: "0.2rem", lineHeight: 1.35 }}>
                        {product.title}
                      </div>
                      <div style={{ fontSize: "0.58rem", color: "#94a3b8", marginTop: "0.25rem" }}>
                        {product.instrument} · {product.level} · {product.quality}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: "0.62rem", color: "#cbd5e1", marginTop: "0.55rem", lineHeight: 1.45 }}>
                {noaaStatus === "loading"
                  ? "Loading NOAA products from the Space Weather Portal API..."
                  : noaaStatus === "fallback"
                    ? "Browser fetch unavailable; showing core NOAA SWPC model products from the same API catalog."
                    : "Products loaded from the NOAA NCEI Space Weather Portal API."}
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                bottom: "12px",
                left: "12px",
                zIndex: 6,
                background: "rgba(2, 8, 18, 0.88)",
                border: "1px solid #168bd2",
                borderRadius: "8px",
                padding: "0.65rem 0.8rem",
                color: "#ffffff",
                fontSize: "0.72rem",
                fontWeight: 800,
              }}
            >
              <div style={{ color: "#94a3b8", fontSize: "0.64rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                NOAA Layer Legend
              </div>
              {[
                { color: "#00ff88", label: "TEC models: GLOTEC / USTEC" },
                { color: "#ffb347", label: "Space-weather models: DRAP / ENLIL" },
                { color: "#63c7ff", label: "Satellite data products" },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.25rem" }}>
                  <span className="dot" style={{ background: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
              <div style={{ color: "#94a3b8", fontSize: "0.6rem", fontWeight: 500, marginTop: "0.45rem", maxWidth: "260px" }}>
                Base map: OpenStreetMap · Data source: NOAA NCEI Space Weather Portal API v1
              </div>
            </div>
          </>
        )}
      </div>
      {selected && (
        <SiteDetailsPanel station={selected} heatmap={heatmap} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
