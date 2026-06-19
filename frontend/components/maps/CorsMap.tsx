"use client";
import { useEffect, useRef, useState } from "react";
import type { Station } from "@/lib/types";
import type { MapLayer } from "./CorsMapWithLayers";
import SiteDetailsPanel from "./SiteDetailsPanel";

interface Props {
  stations: Station[];
  height?: number;
  layer?: MapLayer;
}

const STATUS_COLOR: Record<string, string> = {
  online: "#00ff88",
  degraded: "#ff8c00",
  offline: "#ff4444",
  unknown: "#666",
};

const TILE_URLS: Record<MapLayer, string> = {
  Hybrid: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Street: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "TEC Heat Map": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};

const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

export default function CorsMap({ stations, height = 420, layer = "Hybrid" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olMapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseTileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelTileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vectorSourceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const olHelpersRef = useRef<any>(null);
  const stationsRef = useRef(stations);
  const [selected, setSelected] = useState<Station | null>(null);
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;
  stationsRef.current = stations;

  const buildFeatures = (list: Station[]) => {
    const helpers = olHelpersRef.current;
    if (!helpers) return [];
    const { fromLonLat, Feature, Point, Style, Circle, Fill, Stroke, Text } = helpers;
    return list.map((s) => {
      const f = new Feature({ geometry: new Point(fromLonLat([s.lon, s.lat])), station: s });
      f.setStyle(
        new Style({
          image: new Circle({
            radius: 7,
            fill: new Fill({ color: STATUS_COLOR[s.status] ?? "#666" }),
            stroke: new Stroke({ color: "#fff", width: 1.5 }),
          }),
          text: new Text({
            text: s.code.toUpperCase(),
            offsetY: -14,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: "bold 10px sans-serif",
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
        source: new XYZ({ url: TILE_URLS[layer], attributions: "Esri / OSM" }),
        zIndex: 0,
      });
      const labelTile = new TileLayer({
        source: new XYZ({ url: LABEL_URL }),
        visible: layer === "Hybrid",
        zIndex: 1,
      });

      const vectorSource = new VectorSource();
      vectorSourceRef.current = vectorSource;
      syncStationFeatures(stationsRef.current);

      const popup = new Overlay({ element: popupEl, positioning: "bottom-center", offset: [0, -14] });

      const map = new ol.Map({
        target: container,
        layers: [baseTile, labelTile, new VectorLayer({ source: vectorSource, zIndex: 2 })],
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
          setSelectedRef.current(s);
          popupEl.innerHTML = `<b>${s.code.toUpperCase()}</b> — click Details →`;
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
    })();

    return () => {
      disposed = true;
      if (olMapRef.current) {
        olMapRef.current.dispose();
        olMapRef.current = null;
      }
      baseTileRef.current = null;
      labelTileRef.current = null;
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
    if (!baseTileRef.current || !labelTileRef.current) return;
    (async () => {
      const XYZ = (await import("ol/source/XYZ")).default;
      baseTileRef.current.setSource(new XYZ({ url: TILE_URLS[layer], attributions: "Esri / OSM" }));
      labelTileRef.current.setVisible(layer === "Hybrid");
    })();
  }, [layer]);

  return (
    <div style={{ position: "relative", width: "100%", height, display: "flex" }}>
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
        <SiteDetailsPanel station={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
