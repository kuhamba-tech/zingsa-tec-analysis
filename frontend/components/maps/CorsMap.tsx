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
const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TRANSPORT_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

function baseTileUrl(layer: MapLayer): string {
  return layer === "Street" ? STREET_URL : SATELLITE_URL;
}

function usesHybridOverlays(layer: MapLayer): boolean {
  return layer === "Hybrid" || layer === "TEC Heat Map";
}

function heatOverlayOpacity(layer: MapLayer): number {
  return layer === "TEC Heat Map" ? 0.78 : 0.65;
}

function shouldShowHeatOverlay(layer: MapLayer, heatmap: TecHeatmapResponse | null | undefined): boolean {
  if (layer !== "TEC Heat Map") return false;
  if (!heatmap?.available) return false;
  if (heatmap.grid) return true;
  return (heatmap.heat_points?.length ?? 0) >= 1;
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

function stationTecValue(station: Station, heatmap: TecHeatmapResponse | null | undefined): number | null {
  const liveStatus = getLiveStationStatus(station);
  if (liveStatus === "offline" || liveStatus === "unavailable") return 0;
  const code = station.code.toLowerCase().replace(/_+$/, "");
  const fromHeatmap = heatmap?.stations.find((s) => s.code.toLowerCase().replace(/_+$/, "") === code)?.vtec;
  if (typeof fromHeatmap === "number" && Number.isFinite(fromHeatmap) && fromHeatmap >= 0) return fromHeatmap;
  return typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
    ? station.current_tec
    : null;
}

export default function CorsMap({ stations, height = 420, layer = "Hybrid", heatmap = null }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
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
  const vectorSourceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olHelpersRef = useRef<any>(null);
  const stationsRef = useRef(stations);
  const heatmapRef = useRef(heatmap);
  const layerRef = useRef(layer);
  const [selected, setSelected] = useState<Station | null>(null);
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
    const popupEl = popupRef.current;
    if (!container || !popupEl) return;

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
          popupEl.innerHTML = `<b>${s.code.toUpperCase()}</b>${tecLine}${icaoLine}${distLine}<div style="margin-top:0.2rem;color:#94a3b8">Click Details →</div>`;
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
      vectorSourceRef.current = null;
      olHelpersRef.current = null;
      if (popupEl) {
        popupEl.style.display = "none";
        popupEl.innerHTML = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncStationFeatures(stations);
  }, [stations]);

  useEffect(() => {
    if (!baseTileRef.current || !labelTileRef.current || !transportTileRef.current) return;
    (async () => {
      const XYZ = (await import("ol/source/XYZ")).default;
      baseTileRef.current.setSource(new XYZ({ url: baseTileUrl(layer), attributions: "Esri" }));
      const hybrid = usesHybridOverlays(layer);
      labelTileRef.current.setVisible(hybrid);
      transportTileRef.current.setVisible(hybrid);
      syncStationFeatures(stationsRef.current);
      await syncHeatLayer();
    })();
  }, [layer, heatmap]);

  return (
    <div
      className="cors-map-shell"
      style={{ position: "relative", width: "100%", height, display: "flex" }}
    >
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapRef} className="map-container" style={{ width: "100%", height: "100%" }} />
        <div
          ref={popupRef}
          style={{
            display: "none",
            position: "absolute",
            background: "#0a0f1a",
            border: "1px solid #244d73",
            borderRadius: "8px",
            padding: "0.45rem 0.7rem",
            fontSize: "0.75rem",
            color: "#fff",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      </div>
      {selected && (
        <SiteDetailsPanel station={selected} heatmap={heatmap} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
