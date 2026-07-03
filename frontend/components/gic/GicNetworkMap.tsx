"use client";
import { useEffect, useRef, useState } from "react";
import type { GicNetwork, GicStationStatus } from "@/lib/types";

type MapLayer = "Hybrid" | "Satellite" | "Street";

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street"];

const TILE_URLS: Record<MapLayer, string> = {
  Hybrid: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Street: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const LINE_COLORS: Record<number, string> = {
  330: "#ff5a5a",
  400: "#d946ef",
};

interface Props {
  network: GicNetwork | null;
  stationStatus: GicStationStatus[];
  height?: number;
}

export default function GicNetworkMap({ network, stationStatus, height = 460 }: Props) {
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
  const [layer, setLayer] = useState<MapLayer>("Hybrid");
  const dataRef = useRef<{ network: GicNetwork | null; status: GicStationStatus[] }>({
    network,
    status: stationStatus,
  });
  dataRef.current = { network, status: stationStatus };

  const buildFeatures = () => {
    const helpers = olHelpersRef.current;
    const { network: net, status } = dataRef.current;
    if (!helpers || !net) return [];
    const { fromLonLat, Feature, Point, LineString, Style, RegularShape, Circle, Fill, Stroke, Text } = helpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = [];

    for (const line of net.lines) {
      const geom = new LineString(line.coords.map(([lat, lon]: [number, number]) => fromLonLat([lon, lat])));
      const f = new Feature({ geometry: geom, kind: "line", info: line });
      f.setStyle(
        new Style({
          stroke: new Stroke({
            color: LINE_COLORS[line.kv] ?? "#ff5a5a",
            width: line.kv === 400 ? 3.5 : 2.5,
          }),
        }),
      );
      features.push(f);
    }

    const monitored = new Map<string, GicStationStatus>();
    for (const s of status) {
      if (s.substation) monitored.set(s.substation, s);
    }

    for (const sub of net.substations) {
      const mon = monitored.get(sub.code);
      const f = new Feature({
        geometry: new Point(fromLonLat([sub.lon, sub.lat])),
        kind: "substation",
        info: { ...sub, monitoring: mon ?? null },
      });
      const styles = [
        new Style({
          image: new RegularShape({
            points: 3,
            radius: 8,
            fill: new Fill({ color: "#c81e1e" }),
            stroke: new Stroke({ color: "#fff", width: 1.5 }),
          }),
          text: new Text({
            text: sub.name.replace(/\s*\(.*\)/, ""),
            offsetY: -16,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: "bold 11px sans-serif",
          }),
        }),
      ];
      if (mon) {
        styles.push(
          new Style({
            image: new Circle({
              radius: 13,
              fill: new Fill({ color: "rgba(22,139,210,0.001)" }),
              stroke: new Stroke({ color: mon.has_data ? "#00ff88" : "#168bd2", width: 2.5 }),
            }),
          }),
        );
      }
      f.setStyle(styles);
      features.push(f);
    }
    return features;
  };

  const syncFeatures = () => {
    const source = vectorSourceRef.current;
    if (!source) return;
    source.clear();
    source.addFeatures(buildFeatures());
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
      const LineString = (await import("ol/geom/LineString")).default;
      const { Style, RegularShape, Circle, Fill, Stroke, Text } = await import("ol/style");
      const Overlay = (await import("ol/Overlay")).default;
      const View = (await import("ol/View")).default;

      if (disposed || olMapRef.current) return;

      olHelpersRef.current = {
        fromLonLat, Feature, Point, LineString, Style, RegularShape, Circle, Fill, Stroke, Text,
      };

      const baseTile = new TileLayer({
        source: new XYZ({ url: TILE_URLS.Hybrid, attributions: "Esri / OSM" }),
        zIndex: 0,
      });
      const labelTile = new TileLayer({
        source: new XYZ({ url: LABEL_URL }),
        visible: true,
        zIndex: 1,
      });

      const vectorSource = new VectorSource();
      vectorSourceRef.current = vectorSource;
      syncFeatures();

      const popup = new Overlay({ element: popupEl, positioning: "bottom-center", offset: [0, -14] });

      const map = new ol.Map({
        target: container,
        layers: [baseTile, labelTile, new VectorLayer({ source: vectorSource, zIndex: 2 })],
        view: new View({ center: fromLonLat([29.3, -19.0]), zoom: 6.3 }),
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
          const kind = f.get("kind");
          const info = f.get("info");
          if (kind === "substation") {
            const mon = info.monitoring as GicStationStatus | null;
            popupEl.innerHTML =
              `<b>${info.name}</b><br/>ZETDC substation` +
              (mon
                ? `<br/>🧲 GIC monitoring: <b>${mon.station_id}</b>` +
                  (mon.has_data && mon.latest_gic_a != null
                    ? `<br/>Latest GIC: <b>${mon.latest_gic_a.toFixed(2)} A</b> (${mon.latest_level ?? "—"})`
                    : "<br/>No field data ingested yet")
                : "");
          } else {
            popupEl.innerHTML = `<b>${info.from} — ${info.to}</b><br/>${info.kv} kV transmission line`;
          }
          popup.setPosition(evt.coordinate);
          popupEl.style.display = "block";
        } else {
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
    syncFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, stationStatus]);

  useEffect(() => {
    if (!baseTileRef.current || !labelTileRef.current) return;
    (async () => {
      const XYZ = (await import("ol/source/XYZ")).default;
      baseTileRef.current.setSource(new XYZ({ url: TILE_URLS[layer], attributions: "Esri / OSM" }));
      labelTileRef.current.setVisible(layer === "Hybrid");
    })();
  }, [layer]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
          Map Layer
        </span>
        {LAYERS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayer(l)}
            className={`home-map-layer-btn${layer === l ? " is-active" : ""}`}
          >
            {l}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.9rem", fontSize: "0.72rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span><span style={{ color: "#c81e1e" }}>▲</span> Substation</span>
          <span><span style={{ color: "#ff5a5a" }}>━</span> 330 kV</span>
          <span><span style={{ color: "#d946ef" }}>━</span> 400 kV</span>
          <span><span style={{ color: "#00ff88" }}>◯</span> GIC sensor (data)</span>
          <span><span style={{ color: "#168bd2" }}>◯</span> GIC sensor (no data)</span>
        </span>
      </div>

      <div style={{ position: "relative", width: "100%", height }}>
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
    </div>
  );
}
