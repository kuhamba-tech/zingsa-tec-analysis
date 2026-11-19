"use client";

import { useContext, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChartDateRangeContext, utcDayBounds } from "@/components/charts/ChartDateRange";
import { loadLineChart } from "@/lib/loadLineChart";
import { utcTimeAxisProps } from "@/lib/chartTimeAxis";
import type { PlotAreaReporter } from "@/lib/chartPlotArea";
import { nearestReading, OBSERVATION_READOUT_TOLERANCE_MS, type AnalysisPoint } from "@/lib/stormAnalysis";
import { windBzComparison, solarWindPressure } from "@/lib/windBzComparison";
import { DST_RING_SCALE } from "@/lib/spaceWeatherMetrics";
import type { HeliosphericMonitorResponse } from "@/lib/types";
import type { SolarBriefResponse } from "@/lib/api";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const DST_GUIDES = DST_RING_SCALE.flatMap(band => "boundary" in band ? [{
  value: band.boundary,
  label: `${band.label} (−${Math.abs(band.boundary)} nT)`,
  color: band.color,
}] : []);

export default function DstPressureComparison({
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
  onPlotAreaChange?: PlotAreaReporter;
  onPickTime?: (time: number) => void;
}) {
  const calendar = useContext(ChartDateRangeContext);
  const [hours, setHours] = useState(48);
  const end = Date.now();
  const domain = analysisDomain ?? (calendar?.day ? utcDayBounds(calendar.day) : { min: end - hours * 3600_000, max: end });
  const samples = useMemo(() => windBzComparison(
    { times: data.solar_wind.times, values: solarWindPressure(data.solar_wind.speed, data.solar_wind.density ?? []) },
    { times: data.dst?.times ?? [], values: data.dst?.dst ?? [] }, domain.min, domain.max, true),
  [data, domain.min, domain.max]);
  const selectedReadings = useMemo(() => {
    if (selectedTime == null) return null;
    const read = (values: (number | null)[], tolerance: number) => nearestReading(
      samples.times.map((time, index): AnalysisPoint => ({ time, value: values[index] ?? null })),
      selectedTime,
      tolerance,
    );
    return {
      dst: read(samples.bz, 35 * 60_000),
      pressure: read(samples.speed, OBSERVATION_READOUT_TOLERANCE_MS),
    };
  }, [samples, selectedTime]);
  const markers = (brief?.sun_events ?? []).filter(event => /^[MX]/i.test(event.flare_class))
    .map(event => ({ x: Date.parse(`${event.date.replaceAll("/", "-")}T${event.maximum}:00Z`), label: event.flare_class, color: "#f87171" }));
  const hasWind = samples.speed.some(value => value != null), hasBz = samples.bz.some(value => value != null);

  return <section className="card" aria-label="Dst and solar wind dynamic pressure comparison">
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".75rem" }}>
      <strong>Dst index and solar wind dynamic pressure</strong>
      {!analysisDomain && <div role="group" aria-label="Dst and pressure live window">
        {[24, 48, 72].map(value => <button key={value} type="button" className="btn" aria-pressed={hours === value} disabled={Boolean(calendar?.day)} onClick={() => setHours(value)}>{value} h</button>)}
      </div>}
    </div>
    <p style={{ fontSize: ".78rem" }}>NOAA SWPC Dst on the left axis · proton dynamic pressure on the right axis · UTC observation times</p>
    {selectedReadings && selectedTime != null && <p aria-live="polite" style={{ fontSize: ".8rem", margin: "0 0 .45rem" }}>
      Selected {new Date(selectedTime).toISOString().slice(0, 16).replace("T", " ")} UTC
      {" · "}Dst: {selectedReadings.dst ? `${selectedReadings.dst.value!.toFixed(1)} nT at ${new Date(selectedReadings.dst.time).toISOString().slice(11, 16)} UTC` : "N/A"}
      {" · "}Pressure: {selectedReadings.pressure ? `${selectedReadings.pressure.value!.toFixed(3)} nPa at ${new Date(selectedReadings.pressure.time).toISOString().slice(11, 16)} UTC` : "N/A"}
    </p>}
    <LineChart labels={samples.times.map(time => new Date(time).toISOString())} xValues={samples.times} epochMs={samples.times}
      datasets={[
        { label: "Dst", data: samples.bz, color: "#3b82f6", fill: false, omitMissingPoints: true, spanGaps: 65 * 60_000, tension: 0 },
        { label: "Solar wind pressure", data: samples.speed, color: "#f8fafc", yAxisId: "y2", fill: false, omitMissingPoints: true, spanGaps: 35 * 60_000, tension: 0 },
        { label: "Dst = 0 nT", data: samples.times.map(() => 0), color: "#94a3b8", dashed: true, borderWidth: 1 },
      ]} yLabel="Dst (nT)" secondaryYLabel="Psw (nPa)" height={300} pointRadius={0}
      thresholds={DST_GUIDES} ySuggestedMin={DST_RING_SCALE[4].boundary - 10}
      preserveSamples toggleableLegend verticalMarkers={analysisDomain ? undefined : markers}
      markerReadout={selectedReadings && selectedTime != null ? { x: selectedTime, lines: [
        `${new Date(selectedTime).toISOString().slice(11, 16)} UTC`,
        `Dst: ${selectedReadings.dst ? `${selectedReadings.dst.value!.toFixed(1)} nT at ${new Date(selectedReadings.dst.time).toISOString().slice(11, 16)} UTC` : "N/A"}`,
        `Pressure: ${selectedReadings.pressure ? `${selectedReadings.pressure.value!.toFixed(3)} nPa at ${new Date(selectedReadings.pressure.time).toISOString().slice(11, 16)} UTC` : "N/A"}`,
      ] } : undefined}
      onPlotAreaChange={onPlotAreaChange} onPickTime={onPickTime}
      {...utcTimeAxisProps(domain, { majorHours: 3 })} />
    {(!hasWind || !hasBz) && <p role="status">{!hasWind ? "Solar wind pressure" : ""}{!hasWind && !hasBz ? " and " : ""}{!hasBz ? "Dst" : ""} observations unavailable in this window. Missing data remains empty.</p>}
    <p style={{ fontSize: ".78rem" }}>Source fetched: {data.updated_utc ?? "unavailable"}. {!analysisDomain && markers.length > 0 && "Red lines mark M/X flare peaks from the latest NOAA flare list. "}Pressure (nPa) is calculated as 1.6726e-6 × proton density (cm⁻³) × speed² (km/s) from simultaneous NOAA samples; helium is not included. Dst stays at its measured hourly cadence; gaps longer than 65 minutes are not joined.</p>
  </section>;
}
