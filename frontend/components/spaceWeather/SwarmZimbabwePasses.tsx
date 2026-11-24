"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getSwarmZimbabwe, type SwarmZimbabweData } from "@/lib/api";
import { loadLineChart } from "@/lib/loadLineChart";
import { loadOpenLayers } from "@/lib/loadOpenLayers";
import styles from "./StormAnalysis.module.css";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const COLORS = ["#38bdf8", "#fbbf24", "#f472b6", "#4ade80", "#a78bfa", "#fb923c", "#67e8f9", "#f87171"];
const LATITUDES = Array.from({ length: 121 }, (_, index) => index - 60);

const SPACECRAFT = ["A", "C"] as const;

function timeLabel(utc: string) {
  return utc.slice(11, 19);
}

export default function SwarmZimbabwePasses({ day }: { day: string }) {
  return <SwarmDay key={day} day={day} />;
}

function SwarmDay({ day }: { day: string }) {
  const [data, setData] = useState<SwarmZimbabweData | null>(null);
  const [error, setError] = useState("");
  const [zoomToZimbabwe, setZoomToZimbabwe] = useState(true);
  const mapTarget = useRef<HTMLDivElement>(null);
  const fit = useRef<((local: boolean) => void) | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void getSwarmZimbabwe(day)
        .then(result => { if (active) setData(result); })
        .catch(() => { if (active) setError(`Could not load ESA VirES observations for ${day} UTC.`); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [day]);

  useEffect(() => {
    if (!data?.passes.length) return;
    let active = true;
    let dispose: (() => void) | undefined;
    void loadOpenLayers().then(ol => {
      if (!active || !mapTarget.current) return;
      const line = (coordinates: number[][], color: string, width: number, lineDash?: number[]) => {
        const feature = new ol.Feature(new ol.LineString(coordinates.map(point => ol.fromLonLat(point))));
        feature.setStyle(new ol.Style({ stroke: new ol.Stroke({ color, width, lineDash }) }));
        return feature;
      };
      const tracks = data.passes.flatMap((pass, index) => {
        const color = COLORS[index % COLORS.length];
        return [
          line(pass.track, color, 2, pass.spacecraft === "C" ? [6, 4] : undefined),
          ...pass.crossing.map(segment => line(segment, color, 4)),
        ];
      });
      const boundary = line(data.boundary, "#1e293b", 2.5);
      const map = new ol.Map({
        target: mapTarget.current,
        layers: [
          new ol.TileLayer({ source: new ol.XYZ({
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            maxZoom: 19,
            attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }) }),
          new ol.VectorLayer({ source: new ol.VectorSource({ features: [boundary, ...tracks] }) }),
        ],
        view: new ol.View({ center: ol.fromLonLat([29.5, -19]), zoom: 3 }),
      });
      const fullExtent = new ol.VectorSource({ features: tracks }).getExtent();
      const localExtent = boundary.getGeometry()?.getExtent();
      fit.current = local => {
        const extent = local ? localExtent : fullExtent;
        if (extent) map.getView().fit(extent, { padding: [24, 24, 24, 24], maxZoom: 8 });
      };
      fit.current(true);
      dispose = () => map.dispose();
    }).catch(() => { if (active) setError("The ground-track map could not initialize."); });
    return () => { active = false; fit.current = null; dispose?.(); };
  }, [data]);

  return (
    <section className={styles.swarmSection} aria-label="Swarm A and C over Zimbabwe">
      <h3>Swarm A and C over Zimbabwe</h3>
      <p>{day} UTC · ESA Swarm Langmuir probe. The table gives the first and last recorded positions inside Zimbabwe for each crossing.</p>
      {error && <p role="status" className="banner banner-warn">{error}</p>}
      {!data && !error && <p role="status">Loading Swarm observations…</p>}
      {data && <p role="status">{SPACECRAFT.map(spacecraft => {
        const latest = data.last_sample[spacecraft];
        return latest
          ? `Swarm ${spacecraft} latest sample ${timeLabel(latest)} UTC`
          : `Swarm ${spacecraft} has no published samples for this date`;
      }).join(" · ")}</p>}
      {data && !data.passes.length && SPACECRAFT.some(spacecraft => data.last_sample[spacecraft]) && (
        <p>No Zimbabwe crossings in the available observations for this date.</p>
      )}
      {!!data?.passes.length && <>
        <h4>Satellite ground tracks</h4>
        <div className={styles.controls}>
          <button type="button" className="btn" aria-pressed={!zoomToZimbabwe} onClick={() => { fit.current?.(false); setZoomToZimbabwe(false); }}>Full tracks</button>
          <button type="button" className="btn" aria-pressed={zoomToZimbabwe} onClick={() => { fit.current?.(true); setZoomToZimbabwe(true); }}>Zoom to Zimbabwe</button>
        </div>
        <div ref={mapTarget} tabIndex={0} aria-label="Swarm satellite ground tracks and Zimbabwe border" className={styles.swarmMap} />
        <p>Swarm A is solid. Swarm C is dashed. Thicker segments mark the recorded positions inside Zimbabwe.</p>
        <div className={styles.swarmTable}>
          <table>
            <thead><tr><th scope="col">Spacecraft</th><th scope="col">UTC date</th><th scope="col">First inside</th><th scope="col">Last inside</th></tr></thead>
            <tbody>{data.passes.map((pass, index) => (
              <tr key={`${pass.spacecraft}-${pass.entry}`}>
                <th scope="row"><span aria-hidden="true" style={{ color: COLORS[index % COLORS.length] }}>● </span>Swarm {pass.spacecraft}</th>
                <td>{pass.entry.slice(0, 10)}</td><td>{timeLabel(pass.entry)}</td>
                <td>{pass.exit.slice(0, 10) !== pass.entry.slice(0, 10) && `${pass.exit.slice(0, 10)} `}{timeLabel(pass.exit)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {SPACECRAFT.filter(spacecraft => data.passes.some(pass =>
          pass.spacecraft === spacecraft && Object.keys(pass.density).length > 0,
        )).map(spacecraft => (
          <div key={spacecraft}>
            <h4>Swarm {spacecraft} electron density</h4>
            <LineChart
              labels={LATITUDES.map(String)} xValues={LATITUDES} xMin={-60} xMax={60}
              xLabel="Geographic latitude (°)" yLabel="Electron density (cm⁻³)"
              height={280} pointRadius={0} toggleableLegend preserveSamples
              datasets={data.passes.flatMap((pass, index) => pass.spacecraft === spacecraft ? [{
                label: `${pass.entry.slice(5, 10)} · ${timeLabel(pass.entry)} UTC`,
                data: LATITUDES.map(latitude => pass.density[latitude] ?? null),
                color: COLORS[index % COLORS.length], spanGaps: false, tension: 0, fill: false,
              }] : [])}
            />
          </div>
        ))}
        <p>Profiles show median electron density in 1° latitude bins along each pass. Only nominal VirES density samples contribute.</p>
      </>}
      <p>Measurements from <a href="https://vires.services/hapi/" target="_blank" rel="noreferrer">ESA VirES for Swarm</a> · Zimbabwe boundary from <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">geoBoundaries</a>.</p>
    </section>
  );
}
