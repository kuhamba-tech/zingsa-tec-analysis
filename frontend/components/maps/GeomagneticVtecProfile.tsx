"use client";

import { useMemo } from "react";
import LineChart from "@/components/charts/LineChart";
import { igrf14Epoch } from "@/lib/geomagneticEquator";
import { dipLatitudeDeg } from "@/lib/igrf14Dip";
import { stationTecValue } from "@/lib/mapStationTec";
import type { Station, TecHeatmapResponse } from "@/lib/types";
import styles from "./GeomagneticVtecProfile.module.css";

export default function GeomagneticVtecProfile({ stations, heatmap }: {
  stations: Station[];
  heatmap?: TecHeatmapResponse | null;
}) {
  const points = useMemo(() => {
    const epoch = igrf14Epoch();
    return stations.flatMap(station => {
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return [];
      const value = stationTecValue(station, heatmap);
      if (value == null) return [];
      const dip = dipLatitudeDeg(station.lat, station.lon, epoch);
      return dip == null ? [] : [{ station: station.code.toUpperCase(), dip, value }];
    }).sort((a, b) => a.dip - b.dip);
  }, [stations, heatmap]);

  return <section className={`card ${styles.profile}`} aria-label="Mapped VTEC versus magnetic latitude">
    <h3>Mapped VTEC versus magnetic latitude</h3>
    <p>Current GOPI values from the Geomagnetic map markers · IGRF dip latitude</p>
    {points.length ? <>
      <LineChart
        labels={points.map(point => point.station)}
        xValues={points.map(point => point.dip)}
        datasets={[{ label: "GOPI VTEC", data: points.map(point => point.value), color: "#38bdf8", tension: 0 }]}
        yLabel="VTEC (TECU)"
        xLabel="Magnetic latitude (°)"
        xMin={-90}
        xMax={90}
        height={300}
        pointRadius={4}
        preserveSamples
        toggleableLegend
      />
      <ul className={styles.readings} role="list">
        {points.map(point => <li key={point.station}>
          <strong>{point.station}</strong>
          <span>{point.value.toFixed(1)} TECU · {point.dip.toFixed(1)}°</span>
        </li>)}
      </ul>
    </> : <p role="status">No mapped stations currently display a GOPI value.</p>}
  </section>;
}
