"use client";

import { useEffect, useRef, useState } from "react";
import { getGlobalGim, type GlobalGimGrid } from "@/lib/api";
import { loadOpenLayers } from "@/lib/loadOpenLayers";

const ARCHIVE = "https://sideshow.jpl.nasa.gov/pub/iono_daily/gim_for_research/jpld/";
const COLORS = [[19, 18, 100], [24, 87, 211], [0, 190, 226], [252, 230, 60], [190, 26, 20]];
const MAX_TEC = 100;

function rasterUrl(grid: GlobalGimGrid) {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  const image = context.createImageData(grid.width, grid.height);
  grid.values.forEach((value, index) => {
    if (value === null) return;
    const position = Math.min(1, Math.max(0, value / MAX_TEC)) * (COLORS.length - 1);
    const lower = Math.floor(position);
    const fraction = position - lower;
    const next = COLORS[Math.min(lower + 1, COLORS.length - 1)];
    for (let channel = 0; channel < 3; channel++) {
      const start = COLORS[lower][channel];
      image.data[index * 4 + channel] = start + fraction * (next[channel] - start);
    }
    image.data[index * 4 + 3] = 205;
  });
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export default function GlobalGimMap({ height }: { height: number }) {
  const target = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState<{ day?: string; time?: string }>({});
  const [day, setDay] = useState("");
  const [grid, setGrid] = useState<GlobalGimGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getGlobalGim(request.day, request.time)
      .then((data) => {
        if (!active) return;
        setGrid(data);
        setDay(data.observed_utc.slice(0, 10));
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error && /\b404\b/.test(reason.message)
          ? "NASA JPL has no map for the selected UTC date or time."
          : "The NASA JPL archive could not be loaded. Try again.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!grid) return;
    let active = true;
    let dispose: (() => void) | undefined;
    void loadOpenLayers().then((ol) => {
      if (!active || !target.current) return;
      const extent = [-180, -90, 180, 90];
      const map = new ol.Map({
        target: target.current,
        layers: [
          new ol.TileLayer({ source: new ol.XYZ({
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            wrapX: false,
          }) }),
          new ol.ImageLayer({ source: new ol.ImageStatic({
            url: rasterUrl(grid), imageExtent: extent, projection: "EPSG:4326",
          }) }),
        ],
        view: new ol.View({ projection: "EPSG:4326", center: [0, 0], zoom: 1 }),
      });
      map.getView().fit(extent);
      dispose = () => map.dispose();
    }).catch(() => { if (active) setError("The map display could not initialize."); });
    return () => { active = false; dispose?.(); };
  }, [grid]);

  const observationDay = grid?.observed_utc.slice(0, 10);
  return (
    <section className="card" aria-label="NASA JPL Global Ionospheric Map">
      <form onSubmit={(event) => { event.preventDefault(); setRequest({ day }); }}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem", marginBottom: ".75rem" }}>
        <strong>GIM Global · NASA JPL</strong>
        <label>UTC date <input type="date" required min="2003-01-01"
          max={new Date().toISOString().slice(0, 10)} value={day} onChange={(event) => setDay(event.target.value)} /></label>
        <button className="btn" type="submit" disabled={loading}>Load date</button>
        <button className="btn" type="button" disabled={loading} onClick={() => setRequest({})}>Latest available</button>
        {grid && <label>UTC time <select disabled={loading || day !== observationDay}
          value={grid.observed_utc.slice(11, 16)}
          onChange={(event) => setRequest({ day: observationDay, time: event.target.value })}>
          {grid.times.map((time) => <option key={time}>{time}</option>)}
        </select></label>}
      </form>
      {loading && <p role="status">Loading NASA JPL map…</p>}
      {error && <p className="banner banner-warn" role="status">{error}</p>}
      {grid && <>
        <p>Observation: {grid.observed_utc.replace("T", " ").replace("Z", " UTC")}</p>
        <div ref={target} tabIndex={0} aria-label="Global vertical TEC map"
          style={{ height, width: "100%", background: "#0b1828", borderRadius: 8, overflow: "hidden" }} />
        <div aria-label="Vertical TEC scale from 0 to 100 or more TEC units"
          style={{ maxWidth: 420, marginTop: ".75rem" }}>
          <div style={{ height: 8, background: `linear-gradient(90deg, ${COLORS.map((color) => `rgb(${color.join(",")})`).join(",")})` }} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100+ TECU</span>
          </div>
        </div>
      </>}
      <p style={{ marginBottom: 0 }}>Archive updated monthly · <a href={ARCHIVE} target="_blank" rel="noreferrer">NASA JPL JPLD archive</a></p>
    </section>
  );
}
