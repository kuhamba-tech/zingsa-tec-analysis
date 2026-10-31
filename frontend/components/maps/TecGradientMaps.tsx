"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { getTecGradients } from "@/lib/api";
import { ELEVATION_MIN_DEG } from "@/lib/elevationMask";
import { loadOpenLayers } from "@/lib/loadOpenLayers";
import type { TecGradientMapsResponse } from "@/lib/types";
import { cellIntersectsZimbabwe, ZIMBABWE_LAND } from "@/lib/zimbabweBoundary";
import { gradientContourSegments, sampleGradient } from "@/lib/tecGradientContours";

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TRANSPORT_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

const EMPTY_GRID: Array<Array<number | null>> = [];
let lastCompletedMaps: TecGradientMapsResponse | null = null;
const recent = (maps: TecGradientMapsResponse) => {
  const age = Date.now() - Date.parse(maps.window_end);
  return age >= 0 && age < 5 * 60_000;
};

function mix(t: number, a: [number, number, number], b: [number, number, number]): string {
  const u = Math.max(0, Math.min(1, t));
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * u);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function spatialColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(0, Math.min(1, value / limit));
  if (t < 0.25) return mix(t * 4, [8, 20, 160], [0, 180, 255]);
  if (t < 0.5) return mix((t - 0.25) * 4, [0, 180, 255], [35, 220, 140]);
  if (t < 0.75) return mix((t - 0.5) * 4, [35, 220, 140], [255, 230, 30]);
  return mix((t - 0.75) * 4, [255, 230, 30], [200, 20, 25]);
}

function temporalColor(value: number, limit: number): string {
  const t = limit <= 0 ? 0 : Math.max(-1, Math.min(1, value / limit));
  if (t < 0) return mix(-t, [230, 240, 250], [30, 100, 210]);
  return mix(t, [230, 240, 250], [210, 45, 35]);
}

function formatNumber(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function windowPhrase(maps: TecGradientMapsResponse): string {
  const startDay = maps.window_start.slice(0, 10);
  const endDay = maps.window_end.slice(0, 10);
  const start = maps.window_start.slice(11, 16);
  const end = maps.window_end.slice(11, 16);
  if (startDay === endDay) return `${startDay} ${start}–${end} UTC`;
  return `${startDay} ${start} UTC to ${endDay} ${end} UTC`;
}

/** Northern is north of −18.2°, central is north of −20.2°, matching the regional TEC bands. */
function zimbabweSide(lat: number, lon: number): string {
  const northSouth = lat > -18.2 ? "north" : lat > -20.2 ? "central" : "south";
  const eastWest = lon < 28.5 ? "west" : lon > 30.5 ? "east" : "";
  if (!eastWest) return northSouth === "central" ? "the middle of Zimbabwe" : `${northSouth}ern Zimbabwe`;
  if (northSouth === "central") return `the ${eastWest} of central Zimbabwe`;
  return `the ${northSouth}${eastWest} of Zimbabwe`;
}

type PaintedCell = { value: number; lat: number; lon: number };

function paintedCells(
  grid: Array<Array<number | null>> | null | undefined,
  lat0: number,
  lon0: number,
): PaintedCell[] {
  if (!grid) return [];
  const cells: PaintedCell[] = [];
  grid.forEach((row, i) => {
    row.forEach((cell, j) => {
      const lat = lat0 + i;
      const lon = lon0 + j;
      if (cell == null || !Number.isFinite(cell) || !cellIntersectsZimbabwe(lat, lon)) return;
      cells.push({ value: cell, lat: lat + 0.5, lon: lon + 0.5 });
    });
  });
  return cells;
}

function meanOf(cells: PaintedCell[]): number | null {
  if (!cells.length) return null;
  return cells.reduce((sum, cell) => sum + cell.value, 0) / cells.length;
}

function GradientHybridMap({
  title,
  unit,
  grid,
  lat0,
  lon0,
  diverging,
  emptyMessage,
}: {
  title: string;
  unit: string;
  grid: Array<Array<number | null>>;
  lat0: number;
  lon0: number;
  diverging: boolean;
  emptyMessage?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const masked = useMemo(() => grid.map((row, i) =>
    row.map((cell, j) =>
      cell != null && Number.isFinite(cell) && cellIntersectsZimbabwe(lat0 + i, lon0 + j) ? cell : null,
    ),
  ), [grid, lat0, lon0]);
  const values = masked.flat().filter((cell): cell is number => cell != null && Number.isFinite(cell));
  const limit = diverging
    ? Math.max(...values.map((value) => Math.abs(value)), 0)
    : Math.max(...values, 0);
  const nlat = masked.length;
  const nlon = masked[0]?.length ?? 0;
  const contourLevels = limit > 0
    ? Array.from({ length: diverging ? 7 : 5 }, (_, i) =>
        diverging ? -limit + (i + 1) * limit / 4 : (i + 1) * limit / 6)
    : [];
  const scaleColors = diverging
    ? [temporalColor(limit, limit), temporalColor(0, limit), temporalColor(-limit, limit)]
    : [1, 0.75, 0.5, 0.25, 0].map((fraction) => spatialColor(limit * fraction, limit));

  const contours = useMemo(() => contourLevels.map(level => ({ level, segments: gradientContourSegments(masked, level) })), [masked, limit, diverging]);
  const renderState = useRef({ masked, limit, lat0, lon0, nlat, nlon, contours });
  renderState.current = { masked, limit, lat0, lon0, nlat, nlon, contours };
  const sourceRef = useRef<{ changed: () => void } | null>(null);
  useEffect(() => { sourceRef.current?.changed(); }, [masked, limit, lat0, lon0]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let map: { setTarget: (target?: HTMLElement) => void; dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      const ol = await loadOpenLayers();
      if (disposed || !hostRef.current) return;
      const { Map, View, TileLayer, XYZ, ImageLayer, ImageCanvas, fromLonLat } = ol;
      const project = (lon: number, lat: number): [number, number] => {
        const projected = fromLonLat([lon, lat]);
        return [projected[0] ?? 0, projected[1] ?? 0];
      };
      const imageSource = new ImageCanvas({
          ratio: 1,
          projection: "EPSG:3857",
          canvasFunction: (extent: number[], _resolution: number, _pixelRatio: number, size: number[]) => {
            const { masked, limit, lat0, lon0, nlat, nlon, contours } = renderState.current;
            const paint = (value: number) => diverging ? temporalColor(value, limit) : spatialColor(value, limit);
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
            const pixel = (lon: number, lat: number): [number, number] => {
              const [x, y] = project(lon, lat);
              return [((x - minX) / spanX) * width, ((maxY - y) / spanY) * height];
            };
            ctx.save();
            ctx.beginPath();
            ZIMBABWE_LAND.forEach(([lon, lat], index) => {
              const [x, y] = project(lon, lat);
              const px = ((x - minX) / spanX) * width;
              const py = ((maxY - y) / spanY) * height;
              if (index === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.clip();
            ctx.beginPath();
            masked.forEach((row, i) => row.forEach((value, j) => {
              if (value == null) return;
              const [ax, ay] = pixel(lon0 + j, lat0 + i);
              const [bx, by] = pixel(lon0 + j + 1, lat0 + i + 1);
              ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
            }));
            ctx.clip();
            for (let i = 0; i < nlat; i += 1) {
              for (let j = 0; j < nlon; j += 1) {
                const value = masked[i]?.[j];
                if (value == null || !Number.isFinite(value)) continue;
                const [x0, y0] = project(lon0 + j, lat0 + i);
                const [x1, y1] = project(lon0 + j + 1, lat0 + i + 1);
                const px0 = ((x0 - minX) / spanX) * width;
                const px1 = ((x1 - minX) / spanX) * width;
                const py0 = ((maxY - y0) / spanY) * height;
                const py1 = ((maxY - y1) / spanY) * height;
                const cellW = Math.abs(px1 - px0);
                const cellH = Math.abs(py1 - py0);
                // Interpolate the display inside supported cells only. The API
                // grid and all reported statistics retain their 1-degree resolution.
                const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(cellW, cellH) / 8)));
                for (let sy = 0; sy < steps; sy++) {
                  for (let sx = 0; sx < steps; sx++) {
                    const sample = sampleGradient(masked, j + (sx + 0.5) / steps - 0.5, i + (sy + 0.5) / steps - 0.5);
                    if (sample == null) continue;
                    const [ax, ay] = pixel(lon0 + j + sx / steps, lat0 + i + sy / steps);
                    const [bx, by] = pixel(lon0 + j + (sx + 1) / steps, lat0 + i + (sy + 1) / steps);
                    ctx.fillStyle = paint(sample);
                    ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + 0.5, Math.abs(by - ay) + 0.5);
                  }
                }
              }
            }
            // Labelled isolines, as in Matamba & Danskin Figure 3. Missing
            // corners never participate, so contours cannot bridge data gaps.
            for (const { level, segments } of contours) {
              let label: { x: number; y: number; length: number } | null = null;
              ctx.beginPath();
              for (const [a, b] of segments) {
                const [ax, ay] = pixel(lon0 + a[0] + 0.5, lat0 + a[1] + 0.5);
                const [bx, by] = pixel(lon0 + b[0] + 0.5, lat0 + b[1] + 0.5);
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                const length = Math.hypot(bx - ax, by - ay);
                if (!label || length > label.length) label = { x: (ax + bx) / 2, y: (ay + by) / 2, length };
              }
              ctx.strokeStyle = "rgba(255,255,255,0.65)";
              ctx.lineWidth = 1;
              ctx.stroke();
              if (label && label.length > 18) {
                const text = level.toFixed(limit < 0.1 ? 3 : 2);
                ctx.font = "bold 11px system-ui";
                ctx.textAlign = "center";
                ctx.lineWidth = 3;
                ctx.strokeStyle = "rgba(0,0,0,0.85)";
                ctx.strokeText(text, label.x, label.y);
                ctx.fillStyle = "#fff";
                ctx.fillText(text, label.x, label.y);
              }
            }
            ctx.restore();
            ctx.beginPath();
            ZIMBABWE_LAND.forEach(([lon, lat], index) => {
              const [x, y] = pixel(lon, lat);
              if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.strokeStyle = "#ff6464";
            ctx.lineWidth = 2;
            ctx.stroke();
            return canvas;
          },
        });
      sourceRef.current = imageSource;
      const overlay = new ImageLayer({ opacity: 0.9, source: imageSource });

      const landLons = ZIMBABWE_LAND.map(([lon]) => lon);
      const landLats = ZIMBABWE_LAND.map(([, lat]) => lat);
      const southWest = project(Math.min(...landLons), Math.min(...landLats));
      const northEast = project(Math.max(...landLons), Math.max(...landLats));
      const created = new Map({
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        target: hostRef.current,
        layers: [
          new TileLayer({ source: new XYZ({ url: SATELLITE_URL, attributions: "Esri" }) }),
          overlay,
          new TileLayer({ source: new XYZ({ url: TRANSPORT_URL, attributions: "Esri Reference" }) }),
          new TileLayer({ source: new XYZ({ url: LABEL_URL, attributions: "Esri Reference" }) }),
        ],
        view: new View({
          center: project(
            (Math.min(...landLons) + Math.max(...landLons)) / 2,
            (Math.min(...landLats) + Math.max(...landLats)) / 2,
          ),
          zoom: 6,
        }),
      });
      const fitToZimbabwe = () => {
        created.updateSize();
        created.getView().fit([southWest[0], southWest[1], northEast[0], northEast[1]], {
          padding: [24, 88, 24, 24],
          maxZoom: 7.2,
        });
      };
      fitToZimbabwe();
      if (disposed) {
        created.setTarget(undefined);
        created.dispose();
        return;
      }
      map = created;
      resizeObserver = new ResizeObserver(fitToZimbabwe);
      resizeObserver.observe(host);
    })().catch(() => {
      /* The section text already says when the gradient itself failed. */
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      map?.setTarget(undefined);
      map?.dispose();
      sourceRef.current = null;
    };
  }, [diverging]);

  return (
    <figure className="tec-gradient-map">
      <figcaption>
        {title} ({unit})
      </figcaption>
      <div className="tec-gradient-frame">
        <div ref={hostRef} className="tec-gradient-hybrid" aria-label={`${title} on the hybrid map, ${unit}`} />
        {values.length > 0 && <div className="tec-gradient-inset-scale" aria-label={`Colour scale in ${unit}`}>
          <strong>{unit}</strong>
          <span>{limit.toFixed(limit < 0.01 ? 3 : 2)}</span>
          <i style={{ background: `linear-gradient(180deg, ${scaleColors.join(", ")})` }} />
          {diverging && <span className="tec-gradient-inset-zero">0</span>}
          <span>{(diverging ? -limit : 0).toFixed(limit < 0.01 ? 3 : 2)}</span>
        </div>}
        {values.length === 0 && <div className="tec-gradient-map-empty" role="status">
          {emptyMessage || "No supported gradient cells in this window."}
        </div>}
        <div className="tec-gradient-map-key">Red outline: Zimbabwe · Clear: outside Zimbabwe</div>
      </div>
    </figure>
  );
}

export default function TecGradientMaps() {
  const [maps, setMaps] = useState<TecGradientMapsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pendingMessage, setPendingMessage] = useState("");
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Fetch measurements and the map code in parallel, rather than serially.
    void loadOpenLayers().catch(() => {});
    if (lastCompletedMaps && recent(lastCompletedMaps)) setMaps(lastCompletedMaps);
    const load = async () => {
      let delay = 10_000;
      try {
        const payload = await getTecGradients();
        if (cancelled) return;
        if (payload.available) {
          setPendingMessage("");
          lastCompletedMaps = payload;
          setMaps(previous => previous?.available && previous.generated_at === payload.generated_at ? previous : payload);
        } else {
          setPendingMessage(payload.message || "The next measured window is being prepared.");
          setMaps(previous => previous?.available && recent(previous) ? previous : payload);
        }
        setFailed(false);
        delay = payload.available ? 30_000 : /background|ephemeris|Retrying/i.test(payload.message || "") ? 2_000 : 10_000;
      } catch { if (!cancelled) setFailed(true); }
      if (!cancelled) timer = setTimeout(load, delay);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [retry]);

  const analysis = useMemo(() => {
    if (!maps?.available || maps.lat0 == null || maps.lon0 == null) {
      return { lead: "", bullets: [] as string[] };
    }
    const when = windowPhrase(maps);
    const spatialCells = paintedCells(maps.spatial, maps.lat0, maps.lon0);
    const steepest = spatialCells.reduce<PaintedCell | null>(
      (best, cell) => (!best || cell.value > best.value ? cell : best),
      null,
    );
    const west = meanOf(spatialCells.filter((cell) => cell.lon < 29));
    const east = meanOf(spatialCells.filter((cell) => cell.lon > 31));
    const eastWest = maps.spatial_east_max_tecu_per_deg;
    const northSouth = maps.spatial_north_max_tecu_per_deg;
    const stronger = eastWest != null && northSouth != null
      ? (eastWest >= northSouth ? "east–west" : "north–south")
      : null;
    const lead = `The left map is how fast TEC changes from place to place across Zimbabwe in the ${maps.window_minutes}-minute window ${when}. Blue is a smooth ionosphere and red is a steep change, in TECU per degree. The right map is the change from the first ${maps.half_minutes} minutes of that window to the second, in TECU per minute: red is TEC rising, blue is TEC falling, and pale is little change. Colour stops at the red Zimbabwe outline.`;
    const bullets: string[] = [];
    bullets.push(
      `This window has ${maps.ipp_count} pierce points, ${maps.ipp_count_first_half} in the first half and ${maps.ipp_count_second_half} in the second. Each point is kept only at elevation ${ELEVATION_MIN_DEG}° or higher. The spatial colour is the Scharr magnitude on the 1° grid after every cell inside the outline takes the nearest measured bin and a ${maps.median_filter_size}-cell median. That is the gradient used by Matamba and Danskin (2022).`,
    );
    if (steepest && maps.spatial_max_tecu_per_deg != null && maps.spatial_mean_tecu_per_deg != null) {
      const direction = stronger
        ? ` The larger component is ${stronger}: the east–west peak is ${formatNumber(eastWest)} TECU/deg and the north–south peak is ${formatNumber(northSouth)} TECU/deg.`
        : "";
      const sides = west != null && east != null
        ? ` Cells west of 29°E average ${west.toFixed(3)} TECU/deg, and cells east of 31°E average ${east.toFixed(3)} TECU/deg.`
        : "";
      bullets.push(
        `The steepest cell is ${formatNumber(maps.spatial_max_tecu_per_deg)} TECU/deg in ${zimbabweSide(steepest.lat, steepest.lon)} (about ${Math.abs(steepest.lat).toFixed(1)}°S, ${steepest.lon.toFixed(1)}°E). The mean of the coloured cells is ${formatNumber(maps.spatial_mean_tecu_per_deg)} TECU/deg.${direction}${sides} A steep cell means nearby receivers see different ionospheric delay.`,
      );
    }
    if (maps.temporal_available && maps.temporal_min_tecu_per_min != null && maps.temporal_max_tecu_per_min != null) {
      const temporalCells = paintedCells(maps.temporal, maps.lat0, maps.lon0);
      const rising = temporalCells.filter((cell) => cell.value > 0).length;
      const falling = temporalCells.filter((cell) => cell.value < 0).length;
      const extreme = temporalCells.reduce<PaintedCell | null>(
        (best, cell) => (!best || Math.abs(cell.value) > Math.abs(best.value) ? cell : best),
        null,
      );
      const meanBit = maps.temporal_mean_tecu_per_min != null
        ? `, and the coloured cells average ${formatNumber(maps.temporal_mean_tecu_per_min)} TECU/min`
        : "";
      const extremeBit = extreme
        ? ` The largest time change is ${extreme.value >= 0 ? "a rise" : "a fall"} of ${Math.abs(extreme.value).toFixed(3)} TECU/min in ${zimbabweSide(extreme.lat, extreme.lon)}.`
        : "";
      bullets.push(
        `The time-change map runs from ${formatNumber(maps.temporal_min_tecu_per_min)} to ${formatNumber(maps.temporal_max_tecu_per_min)} TECU/min${meanBit}. ${rising} coloured cells are rising and ${falling} are falling.${extremeBit} A smooth morning rise is the quiet solar-EUV curve. The same hours count as a disturbance when southward IMF Bz holds and Kp reaches 5 or more.`,
      );
    } else {
      bullets.push(
        maps.temporal_message
          ? `The time-change map is omitted for this window. ${maps.temporal_message}`
          : "The time-change map is omitted for this window because one half does not have enough pierce points.",
      );
    }
    bullets.push(
      "Live code TEC can still carry a receiver bias. A station that stays high or low against its neighbours steepens the spatial map while the ionosphere itself is smooth. The median filter reduces a single-bin spike. A bias that lasts through the window remains in the colour.",
    );
    return { lead, bullets };
  }, [maps]);

  return (
    <section className="tec-gradient-maps" aria-label="TEC spatial and temporal gradients">
      <h2>TEC spatial and temporal gradients</h2>
      <p>
        Following <a href="https://doi.org/10.1029/2021SW003013" target="_blank" rel="noreferrer">Matamba and Danskin (2022), Figures 3–4</a>,
        spatial gradients use the Scharr magnitude (TECU/deg); temporal gradients are the
        second half minus the first half of the same 15-minute window, divided by 7.5 minutes (TECU/min).
        Filled colours and labelled contours sit inside the red Zimbabwe boundary.
        The source grid remains 1°. A cell inside the outline with no pierce point
        of its own takes the nearest measured bin before the median filter and the
        Scharr gradient. Cells outside the outline stay clear. The temporal map
        uses that same fill when both halves of the window have pierce points.
        Live code TEC can retain receiver bias, so gradients may include station offsets.
      </p>
      {failed && <p role="status">Gradient maps could not be loaded. The TEC database may be temporarily unavailable.
        {" "}<button className="btn" onClick={() => setRetry((value) => value + 1)}>Retry gradient maps</button>
      </p>}
      {!failed && maps == null && <p>Placing pierce points for the Scharr and temporal maps.</p>}
      {maps && !maps.available && <p>{maps.message}</p>}
      {maps?.available && pendingMessage && <p role="status">Showing the previous labelled window while the next is prepared. {pendingMessage}</p>}
      {(
        <>
          <div className="tec-gradient-map-row">
            <GradientHybridMap
              title={maps?.available ? `Spatial gradient · ${maps.window_start.slice(0, 10)} · ${maps.window_start.slice(11, 16)}–${maps.window_end.slice(0, 10) !== maps.window_start.slice(0, 10) ? `${maps.window_end.slice(0, 10)} ` : ""}${maps.window_end.slice(11, 16)} UTC` : "Spatial gradient · loading measurements"}
              unit="TECU/deg"
              grid={maps?.spatial ?? EMPTY_GRID}
              lat0={maps?.lat0 ?? -23}
              lon0={maps?.lon0 ?? 25}
              diverging={false}
              emptyMessage={maps?.message || "Loading the latest measured spatial gradient…"}
            />
              <GradientHybridMap
                title={maps?.available ? `Temporal gradient · ${maps.window_start.slice(0, 10)} · ${maps.window_start.slice(11, 16)}–${maps.window_end.slice(0, 10) !== maps.window_start.slice(0, 10) ? `${maps.window_end.slice(0, 10)} ` : ""}${maps.window_end.slice(11, 16)} UTC` : "Temporal gradient · loading measurements"}
                unit="TECU/min"
                grid={maps?.temporal_available ? maps.temporal ?? EMPTY_GRID : EMPTY_GRID}
                lat0={maps?.lat0 ?? -23}
                lon0={maps?.lon0 ?? 25}
                diverging
                emptyMessage={maps?.temporal_message || "Awaiting measured coverage in both halves of the window."}
              />
          </div>
          {maps?.available && <div className="tec-map-diagnostic-grid">
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
          </div>}
          {maps?.available && (
            <>
              <button
                type="button"
                onClick={() => setExplainOpen((open) => !open)}
                aria-expanded={explainOpen}
                style={{
                  marginTop: "0.55rem",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "var(--accent)",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {explainOpen ? "Hide what this graph means" : "What this graph means"}
              </button>
              {explainOpen && (
                <ChartAnalysisBox
                  block={analysis}
                  title="What this graph means"
                  afterLeadTitle="Scientific explanation"
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
