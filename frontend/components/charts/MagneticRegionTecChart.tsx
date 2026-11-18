"use client";

import { useMemo } from "react";
import LineChart from "./LineChart";
import type { Station, LiveStationVtecSeries } from "@/lib/types";
import { dipLatitudeDeg } from "@/lib/igrf14Dip";
import { igrf14Epoch } from "@/lib/geomagneticEquator";
import { magneticRegionTecSeries } from "@/lib/magneticRegionTec";

export default function MagneticRegionTecChart({ stations, series, day, hours, pending, error, onDayChange, onRetry }: {
  stations: Station[]; series: LiveStationVtecSeries[]; day: string | null; hours: number;
  pending: boolean; error: string | null; onDayChange: (day: string) => void; onRetry: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const epoch = igrf14Epoch(day ? new Date(`${day}T12:00:00Z`) : new Date());
  const grouped = useMemo(() => {
    const end = day ? Date.parse(`${day}T00:00:00Z`) + 86400000 : Date.now();
    const start = day ? end - 86400000 : end - hours * 3600000;
    const members = stations.map(station => ({ code: station.code, name: station.name,
      dipLatitude: dipLatitudeDeg(station.lat, station.lon, epoch) }));
    return magneticRegionTecSeries(series, members, start, end, 60);
  }, [stations, series, day, hours, epoch]);
  const hasData = grouped.regions.some(region => region.reporting.length > 0);
  const upperBound = Math.max(5, ...grouped.regions.flatMap(region =>
    region.values.map((value, index) => value == null ? 0 : value + (region.std[index] ?? 0))));

  return <section className="card" aria-label="VTEC by magnetic region" style={{ padding: "1rem" }}>
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem" }}>
      <div>
        <strong>VTEC by magnetic region</strong>
        <p style={{ margin: "0.35rem 0", fontSize: "0.78rem" }}>Mapped stations only · hourly GOPI means ±1 standard deviation · equal weight per station · time in UTC</p>
      </div>
      <label style={{ fontSize: "0.78rem" }}>UTC day {" "}<input type="date" aria-label="Magnetic-region graph UTC day" value={day ?? today} max={today}
        onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && event.target.value <= today) onDayChange(event.target.value); }} /></label>
    </div>
    {pending && <p role="status">{hasData ? "Refreshing regional TEC…" : "Loading regional TEC history…"}</p>}
    {error && <p role="status">{error} <button type="button" className="btn" onClick={onRetry}>Retry</button></p>}
    <LineChart labels={grouped.labels} datasets={grouped.regions.map(region => ({ label: region.label,
      data: region.values, color: region.color, fill: false, spanGaps: false, tension: 0.25,
      meta: region.std.map(error => ({ error })) }))}
      yLabel="VTEC (TECU)" height={340} preserveSamples toggleableLegend errorBars pointRadius={3} yMin={0} ySuggestedMax={Math.ceil(upperBound * 1.05)}
      xValues={grouped.xValues} xMin={0} xMax={day ? 23 : hours} xStepSize={1}
      xLabel="UT" formatXTick={value => String(Math.floor(value))} />
    {!hasData && !pending && <p>No usable measured GOPI history for the selected mapped stations and UTC day.</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.65rem", marginTop: "0.75rem" }}>
      {grouped.regions.map(region => <div key={region.id} style={{ borderLeft: `3px solid ${region.color}`, paddingLeft: "0.6rem", fontSize: "0.78rem" }}>
        <strong style={{ color: region.color }}>{region.label}</strong><br />
        {region.members.length ? `${region.reporting.length} of ${region.members.length} stations reporting` : "No mapped stations"}<br />
        {region.bounds}
      </div>)}
    </div>
    <details style={{ marginTop: "0.9rem", fontSize: "0.78rem" }}>
      <summary>Region definitions and station membership</summary>
      <p>Markers show hourly means. Error bars show ±1 population standard deviation between receiver hourly means; a single receiver has no spread bar. Smooth lines guide the eye between available hourly means.</p>
      <p>μ is IGRF dip latitude, using the same model as the map. These are exclusive comparison bins: each station enters one curve. “Low latitude” here means the remaining 3–10° bands; equator and crest bands are shown separately. Crest bands are reference locations, not detections of a moving ionospheric peak.</p>
      <p>Only measured GOPI history passes into the means, with elevation ≥30° and 0 &lt; TEC ≤50 TECU. Gg, DLR forecasts and interpolated station values are excluded. Missing bins remain gaps. The membership counts cover the selected day; the number contributing to an individual bin can differ.</p>
      {grouped.regions.map(region => <p key={region.id}><strong>{region.label}:</strong> {region.members.length ? region.members.map(station => `${station.code.toUpperCase()} (${station.dipLatitude?.toFixed(1)}°)`).join(", ") : "No mapped stations in this band."}</p>)}
      {grouped.unknown.length > 0 && <p>Excluded because magnetic latitude is unavailable: {grouped.unknown.map(station => station.code).join(", ")}</p>}
    </details>
  </section>;
}
