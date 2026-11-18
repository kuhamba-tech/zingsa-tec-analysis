"use client";

import { useContext, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChartDateRangeContext, utcDayBounds } from "@/components/charts/ChartDateRange";
import { loadLineChart } from "@/lib/loadLineChart";
import { utcTimeAxisProps } from "@/lib/chartTimeAxis";
import { nearestReading, type AnalysisPoint } from "@/lib/stormAnalysis";
import { windBzComparison } from "@/lib/windBzComparison";
import type { HeliosphericMonitorResponse } from "@/lib/types";
import type { SolarBriefResponse } from "@/lib/api";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });

export default function SolarWindBzComparison({
  data,
  brief = null,
  analysisDomain,
  selectedTime,
  onPlotAreaChange,
  onPickTime,
}: {
  data: HeliosphericMonitorResponse;
  brief?: SolarBriefResponse | null;
  analysisDomain?: { min: number; max: number };
  selectedTime?: number;
  onPlotAreaChange?: (area: { left: number; right: number; top: number; bottom: number }) => void;
  onPickTime?: (ms: number) => void;
}) {
  const calendar = useContext(ChartDateRangeContext);
  const [hours, setHours] = useState(48);
  const end = Date.now();
  const domain = analysisDomain ?? (calendar?.day ? utcDayBounds(calendar.day) : { min: end - hours * 3600_000, max: end });
  const samples = useMemo(() => windBzComparison(
    {
      times: data.solar_wind.times,
      values: data.solar_wind.speed,
      density: data.solar_wind.density,
      temperature: data.solar_wind.temperature,
    },
    { times: data.imf.times, values: data.imf.bz }, domain.min, domain.max),
  [data, domain.min, domain.max]);
    const selectedReadings = useMemo(() => {
      if (selectedTime == null) return null;
      const read = (values: (number | null)[]) => nearestReading(
        samples.times.map((time, index): AnalysisPoint => ({ time, value: values[index] ?? null })),
        selectedTime,
        5 * 60_000,
      );
      return {
        speed: read(samples.speed),
        bz: read(samples.bz),
        density: read(samples.density),
        temperature: read(samples.temperature),
      };
    }, [samples, selectedTime]);
  const markers = (brief?.sun_events ?? []).filter(event => /^[MX]/i.test(event.flare_class))
    .map(event => ({ x: Date.parse(`${event.date.replaceAll("/", "-")}T${event.maximum}:00Z`), label: event.flare_class, color: "#f87171" }));
  const hasSpeed = samples.speed.some(value => value != null);
  const hasDensity = samples.density.some(value => value != null);
  const hasTemperature = samples.temperature.some(value => value != null);
  const hasBz = samples.bz.some(value => value != null);
  const unavailable = [
    !hasSpeed ? "Solar wind speed" : null,
    !hasDensity ? "Solar wind density" : null,
    !hasTemperature ? "Proton temperature" : null,
    !hasBz ? "IMF Bz" : null,
  ].filter((value): value is string => value != null);

  return <section className="card" aria-label="Solar wind velocity and IMF Bz comparison">
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".75rem" }}>
      <strong>Solar wind velocity and IMF Bz</strong>
      {!analysisDomain && <div role="group" aria-label="Solar wind and Bz live window">
        {[24, 48, 72].map(value => <button key={value} type="button" className="btn" aria-pressed={hours === value} disabled={Boolean(calendar?.day)} onClick={() => setHours(value)}>{value} h</button>)}
      </div>}
    </div>
    <p style={{ fontSize: ".78rem" }}>NOAA SWPC RTSW · speed on the left axis · GSM Bz, density, and proton temperature on separate right axes · UTC observation times</p>
    {selectedReadings && selectedTime != null && <p aria-live="polite" style={{ fontSize: ".8rem", margin: "0 0 .45rem" }}>
      Selected {new Date(selectedTime).toISOString().replace("T", " ").slice(0, 16)} UTC
      {" · "}Speed: {selectedReadings.speed ? `${selectedReadings.speed.value!.toFixed(1)} km/s` : "N/A"}
      {" · "}Bz: {selectedReadings.bz ? `${selectedReadings.bz.value!.toFixed(2)} nT` : "N/A"}
      {" · "}Density: {selectedReadings.density ? `${selectedReadings.density.value!.toFixed(2)} cm⁻³` : "N/A"}
      {" · "}Proton temperature: {selectedReadings.temperature ? `${selectedReadings.temperature.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })} K` : "N/A"}
    </p>}
    <LineChart labels={samples.times.map(time => new Date(time).toISOString())} xValues={samples.times} epochMs={samples.times}
      datasets={[
        { label: "Solar wind speed", data: samples.speed, color: "#eab308", fill: false, tension: 0 },
        { label: "IMF Bz (GSM)", data: samples.bz, color: "#ef4444", yAxisId: "y2", fill: false, tension: 0 },
        { label: "Solar wind density", data: samples.density, color: "#38bdf8", yAxisId: "y3", fill: false, tension: 0 },
        { label: "Proton temperature", data: samples.temperature, color: "#f97316", yAxisId: "y4", fill: false, tension: 0 },
        { label: "Bz = 0 nT", data: samples.times.map(() => 0), color: "#94a3b8", yAxisId: "y2", dashed: true, borderWidth: 1 },
      ]} yLabel="Speed (km/s)" secondaryYLabel="IMF Bz (nT)" tertiaryYLabel="Density (cm³)" quaternaryYLabel="Proton temp. (K)" height={340} pointRadius={0}
      preserveSamples toggleableLegend verticalMarkers={markers} onPlotAreaChange={onPlotAreaChange} onPickTime={onPickTime}
      {...utcTimeAxisProps(domain, { majorHours: 3 })} />
    {unavailable.length > 0 && <p role="status">{unavailable.join(", ")} observations unavailable in this window. Missing data remains empty.</p>}
    <p style={{ fontSize: ".78rem" }}>Source fetched: {data.updated_utc ?? "unavailable"}. Speed, density, and temperature come from measured NOAA RTSW plasma samples; Bz is the measured GSM IMF series. Values share a UTC minute grid; gaps remain null and no observation values are synthesized. The display connects successive measured samples, like the source panels. {markers.length > 0 && "Red lines mark available M/X flare peak times from the latest NOAA flare list (past 24 hours). Flare radiation reaches Earth in about eight minutes; these markers do not identify solar-wind arrival times or establish causation. "}Southward Bz (below zero) can favour magnetospheric coupling.</p>
  </section>;
}
