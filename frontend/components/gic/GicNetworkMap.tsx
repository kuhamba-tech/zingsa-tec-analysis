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

const PLANT_COLORS: Record<string, string> = {
  hydro: "#06b6d4",
  coal_operational: "#f59e0b",
  coal_idle: "#94a3b8",
};

function plantMarkerColor(fuel: string, status: string): string {
  if (fuel === "hydro") return PLANT_COLORS.hydro;
  return status === "operational" ? PLANT_COLORS.coal_operational : PLANT_COLORS.coal_idle;
}

function plantStatusLabel(status: string): string {
  if (status === "operational") return "Operational";
  if (status === "care_and_maintenance") return "Care & maintenance";
  if (status === "decommissioning") return "Decommissioning";
  return status;
}

interface Props {
  network: GicNetwork | null;
  stationStatus: GicStationStatus[];
  height?: number;
  onStationSelect?: (stationId: string) => void;
}

export default function GicNetworkMap({ network, stationStatus, height = 460, onStationSelect }: Props) {
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
  const [mapReady, setMapReady] = useState(false);
  const networkRef = useRef(network);
  const statusRef = useRef(stationStatus);
  const dataRef = useRef<{ onSelect?: (id: string) => void }>({ onSelect: onStationSelect });
  networkRef.current = network;
  statusRef.current = stationStatus;
  dataRef.current = { onSelect: onStationSelect };

  const buildFeatures = (net: GicNetwork | null, status: GicStationStatus[]) => {
    const helpers = olHelpersRef.current;
    if (!helpers || !net?.substations?.length) return [];
    const { fromLonLat, Feature, Point, LineString, Style, RegularShape, Circle, Fill, Stroke, Text } = helpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features: any[] = [];

    for (const line of net.lines ?? []) {
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

    for (const link of net.generation_links ?? []) {
      const geom = new LineString(link.coords.map(([lat, lon]: [number, number]) => fromLonLat([lon, lat])));
      const f = new Feature({ geometry: geom, kind: "generation_link", info: link });
      f.setStyle(
        new Style({
          stroke: new Stroke({
            color: "rgba(245, 158, 11, 0.75)",
            width: 2,
            lineDash: [8, 6],
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

    for (const plant of net.power_plants ?? []) {
      const color = plantMarkerColor(plant.fuel, plant.status);
      const f = new Feature({
        geometry: new Point(fromLonLat([plant.lon, plant.lat])),
        kind: "power_plant",
        info: plant,
      });
      f.setStyle(
        new Style({
          image: new RegularShape({
            points: 4,
            radius: 9,
            angle: Math.PI / 4,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: "#fff", width: 1.5 }),
          }),
          text: new Text({
            text: plant.name.replace(/\s*\(ZPC\)/, ""),
            offsetY: -18,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#000", width: 3 }),
            font: "bold 11px sans-serif",
          }),
        }),
      );
      features.push(f);
    }
    return features;
  };

  const syncFeatures = (net: GicNetwork | null, status: GicStationStatus[]) => {
    const source = vectorSourceRef.current;
    if (!source) return;
    source.clear();
    source.addFeatures(buildFeatures(net, status));
    const map = olMapRef.current;
    if (map) {
      map.updateSize();
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

      const popup = new Overlay({ element: popupEl, positioning: "bottom-center", offset: [0, -14] });

      const map = new ol.Map({
        target: container,
        layers: [baseTile, labelTile, new VectorLayer({ source: vectorSource, zIndex: 2 })],
        view: new View({ center: fromLonLat([29.3, -19.0]), zoom: 6.3 }),
        overlays: [popup],
        controls: [],
      });

      olMapRef.current = map;
      baseTileRef.current = baseTile;
      labelTileRef.current = labelTile;
      syncFeatures(networkRef.current, statusRef.current);
      setMapReady(true);

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
            if (mon?.station_id) {
              dataRef.current.onSelect?.(mon.station_id);
            }
            popupEl.innerHTML =
              `<b>${info.name}</b><br/>ZETDC substation` +
              (mon
                ? `<br/>🧲 GIC monitoring: <b>${mon.station_id}</b>` +
                  (mon.has_data && mon.latest_gic_a != null
                    ? `<br/>Latest GIC: <b>${mon.latest_gic_a.toFixed(2)} A</b> (${mon.latest_level ?? "—"})`
                    : "<br/>No field data ingested yet")
                : "");
          } else if (kind === "power_plant") {
            const fuelLabel = info.fuel === "hydro" ? "Hydropower" : "Coal thermal";
            const cap =
              info.capacity_mw != null ? `<br/>Installed capacity: <b>${info.capacity_mw} MW</b>` : "";
            popupEl.innerHTML =
              `<b>${info.name}</b><br/>ZPC ${fuelLabel}<br/>Status: <b>${plantStatusLabel(info.status)}</b>${cap}` +
              (info.linked_substation
                ? `<br/>Grid tie: ${info.linked_substation} substation`
                : "");
          } else if (kind === "generation_link") {
            popupEl.innerHTML = `<b>${info.from} → ${info.to}</b><br/>Generation tie-line (ZPC → ZETDC)`;
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

    })();

    return () => {
      disposed = true;
      setMapReady(false);
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
    if (!mapReady) return;
    syncFeatures(network, stationStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, network, stationStatus]);

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
          <span><span style={{ color: "#06b6d4" }}>◆</span> ZPC hydro</span>
          <span><span style={{ color: "#f59e0b" }}>◆</span> ZPC coal (operational)</span>
          <span><span style={{ color: "#94a3b8" }}>◆</span> ZPC coal (care &amp; maintenance)</span>
          <span><span style={{ color: "#ff5a5a" }}>━</span> 330 kV</span>
          <span><span style={{ color: "#d946ef" }}>━</span> 400 kV</span>
          <span><span style={{ color: "#f59e0b", opacity: 0.85 }}>┄</span> Generation tie</span>
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
