"use client";

import { useEffect, useRef, useState } from "react";
import { getTecGradients } from "@/lib/api";
import { loadOpenLayers } from "@/lib/loadOpenLayers";
import type { TecGradientMapsResponse } from "@/lib/types";

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TRANSPORT_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

function mix(t: number, a: [number, number, number], b: [number, number, number]): string {
  const u = Math.max(0, Math.min(1, t));
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * u);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function spatialColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(0, Math.min(1, value / limit));
  if (t < 0.5) return mix(t / 0.5, [8, 48, 140], [240, 220, 40]);
  return mix((t - 0.5) / 0.5, [240, 220, 40], [180, 24, 24]);
}

function temporalColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(-1, Math.min(1, value / limit));
  if (t < 0) return mix(-t, [20, 28, 40], [56, 140, 220]);
  return mix(t, [20, 28, 40], [210, 64, 48]);
}

function withAlpha(rgb: string, alpha: number): string {
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

function formatNumber(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function GradientHybridMap({
  title,
  unit,
  grid,
  lat0,
  lon0,
  diverging,
}: {
  title: string;
  unit: string;
  grid: Array<Array<number | null>>;
  lat0: number;
  lon0: number;
  diverging: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const values = grid.flat().filter((cell): cell is number => cell != null && Number.isFinite(cell));
  const limit = diverging
    ? Math.max(...values.map((value) => Math.abs(value)), 0)
    : Math.max(...values, 0);
  const nlat = grid.length;
  const nlon = grid[0]?.length ?? 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || nlat === 0 || nlon === 0) return;
    let disposed = false;
    let map: { setTarget: (target?: HTMLElement) => void } | null = null;

    (async () => {
      const ol = await loadOpenLayers();
      if (disposed || !hostRef.current) return;
      const { Map, View, TileLayer, XYZ, ImageLayer, ImageCanvas, fromLonLat } = ol;
      const project = (lon: number, lat: number): [number, number] => {
        const projected = fromLonLat([lon, lat]);
        return [projected[0] ?? 0, projected[1] ?? 0];
      };
      const paint = (value: number) =>
        withAlpha(diverging ? temporalColor(value, limit) : spatialColor(value, limit), 0.72);

      const overlay = new ImageLayer({
        source: new ImageCanvas({
          projection: "EPSG:3857",
          canvasFunction: (extent: number[], _resolution: number, _pixelRatio: number, size: number[]) => {
            const canvas = document.createElement("canvas");
            const width = size[0] ?? 0;
            const height = size[1] ?? 0;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx || width === 0 || height === 0) return canvas;
            const [minX, minY, maxX, maxY] = extent as [number, number, number, number];
            const spanX = maxX - minX;
            const spanY = maxY - minY;
            if (spanX === 0 || spanY === 0) return canvas;
            for (let i = 0; i < nlat; i += 1) {
              for (let j = 0; j < nlon; j += 1) {
                const value = grid[i]?.[j];
                if (value == null || !Number.isFinite(value)) continue;
                const [x0, y0] = project(lon0 + j, lat0 + i);
                const [x1, y1] = project(lon0 + j + 1, lat0 + i + 1);
                const px0 = ((x0 - minX) / spanX) * width;
                const px1 = ((x1 - minX) / spanX) * width;
                const py0 = ((maxY - y0) / spanY) * height;
                const py1 = ((maxY - y1) / spanY) * height;
                const left = Math.min(px0, px1);
                const top = Math.min(py0, py1);
                const cellW = Math.abs(px1 - px0);
                const cellH = Math.abs(py1 - py0);
                ctx.fillStyle = paint(value);
                ctx.fillRect(left, top, cellW, cellH);
                ctx.strokeStyle = "rgba(255,255,255,0.35)";
                ctx.lineWidth = 1;
                ctx.strokeRect(left, top, cellW, cellH);
              }
            }
            return canvas;
          },
        }),
      });

      const southWest = project(lon0, lat0);
      const northEast = project(lon0 + nlon, lat0 + nlat);
      const created = new Map({
        target: hostRef.current,
        layers: [
          new TileLayer({ source: new XYZ({ url: SATELLITE_URL, attributions: "Esri" }) }),
          overlay,
          new TileLayer({ source: new XYZ({ url: TRANSPORT_URL, attributions: "Esri Reference" }) }),
          new TileLayer({ source: new XYZ({ url: LABEL_URL, attributions: "Esri Reference" }) }),
        ],
        view: new View({
          center: project(lon0 + nlon / 2, lat0 + nlat / 2),
          zoom: 6,
        }),
      });
      created.getView().fit([southWest[0], southWest[1], northEast[0], northEast[1]], {
        padding: [28, 28, 28, 28],
        maxZoom: 7.2,
      });
      if (disposed) {
        created.setTarget(undefined);
        return;
      }
      map = created;
    })().catch(() => {
      /* The section text already says when the gradient itself failed. */
    });

    return () => {
      disposed = true;
      map?.setTarget(undefined);
    };
  }, [diverging, grid, lat0, limit, lon0, nlat, nlon]);

  return (
    <figure className="tec-gradient-map">
      <figcaption>
        {title} ({unit})
      </figcaption>
      <div ref={hostRef} className="tec-gradient-hybrid" role="img" aria-label={`${title} on the hybrid map, ${unit}`} />
      <div className="tec-gradient-scale" aria-hidden="true">
        <span>{(diverging ? -limit : 0).toFixed(limit < 0.01 ? 3 : 2)}</span>
        <i
          style={{
            background: diverging
              ? `linear-gradient(90deg, ${temporalColor(-limit, limit)}, ${temporalColor(0, limit)}, ${temporalColor(limit, limit)})`
              : `linear-gradient(90deg, ${spatialColor(0, limit)}, ${spatialColor(limit / 2, limit)}, ${spatialColor(limit, limit)})`,
          }}
        />
        <span>{limit.toFixed(limit < 0.01 ? 3 : 2)} {unit}</span>
      </div>
    </figure>
  );
}

export default function TecGradientMaps() {
  const [maps, setMaps] = useState<TecGradientMapsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTecGradients()
        .then((payload) => {
          if (!cancelled) {
            setMaps(payload);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="tec-gradient-maps" aria-label="TEC spatial and temporal gradients">
      <h2>TEC spatial and temporal gradients</h2>
      <p>
        ICAO requires both. Each colour cell is drawn on the hybrid satellite map, with roads and
        place names on top, so the gradient sits on the part of Zimbabwe it describes. The spatial
        map is the Scharr gradient of the 1° median-filtered code-TEC grid, in TECU per degree. The temporal map splits that same 15-minute window
        in half: the second map minus the first, divided by 7.5 minutes, in TECU per minute.
        Cells with no pierce point within one degree stay clear, so the satellite image shows through. The temporal colour is drawn only
        where both halves of the window measured that same cell, so a change of satellites
        is not drawn as a TEC change. Live code TEC still carries receiver bias, so a steep
        colour can be a station offset as well as the ionosphere.
      </p>
      {failed && <p>Gradient maps could not be loaded.</p>}
      {!failed && maps == null && <p>Placing pierce points for the Scharr and temporal maps.</p>}
      {maps && !maps.available && <p>{maps.message}</p>}
      {maps?.available && maps.spatial && maps.lat0 != null && maps.lon0 != null && (
        <>
          <div className="tec-gradient-map-row">
            <GradientHybridMap
              title={`Spatial gradient · ${maps.window_start.slice(11, 16)}–${maps.window_end.slice(11, 16)} UTC`}
              unit="TECU/deg"
              grid={maps.spatial}
              lat0={maps.lat0}
              lon0={maps.lon0}
              diverging={false}
            />
            {maps.temporal_available && maps.temporal ? (
              <GradientHybridMap
                title="Temporal gradient · second half minus first half"
                unit="TECU/min"
                grid={maps.temporal}
                lat0={maps.lat0}
                lon0={maps.lon0}
                diverging
              />
            ) : (
              <p>{maps.temporal_message || "Temporal gradient is omitted for this window."}</p>
            )}
          </div>
          <div className="tec-map-diagnostic-grid">
            <div>
              <span>Spatial max</span>
              <strong>{formatNumber(maps.spatial_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>Spatial mean</span>
              <strong>{formatNumber(maps.spatial_mean_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>East-west max</span>
              <strong>{formatNumber(maps.spatial_east_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>North-south max</span>
              <strong>{formatNumber(maps.spatial_north_max_tecu_per_deg)} TECU/deg</strong>
            </div>
            <div>
              <span>Temporal range</span>
              <strong>
                {maps.temporal_available
                  ? `${formatNumber(maps.temporal_min_tecu_per_min)} to ${formatNumber(maps.temporal_max_tecu_per_min)} TECU/min`
                  : "Awaiting both halves"}
              </strong>
            </div>
            <div>
              <span>Pierce points</span>
              <strong>{maps.ipp_count}</strong>
              <small>
                {maps.ipp_count_first_half} then {maps.ipp_count_second_half}
              </small>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
