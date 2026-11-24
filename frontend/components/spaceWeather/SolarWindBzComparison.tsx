"use client";

import type { PlotAreaReporter } from "@/lib/chartPlotArea";
import { useContext, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChartDateRangeContext, utcDayBounds } from "@/components/charts/ChartDateRange";
import { loadLineChart } from "@/lib/loadLineChart";
import { utcTimeAxisProps } from "@/lib/chartTimeAxis";
import { nearestReading, OBSERVATION_READOUT_TOLERANCE_MS, type AnalysisPoint } from "@/lib/stormAnalysis";
import { windBzComparison } from "@/lib/windBzComparison";
import type { HeliosphericMonitorResponse } from "@/lib/types";
import type { SolarBriefResponse } from "@/lib/api";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const observationStyle = { fill: false, tension: 0, omitMissingPoints: true, spanGaps: 35 * 60_000 };

export default function SolarWindBzComparison({
  data,
  brief = null,
  analysisDomain,
  selectedTime,
  onPlotAreaChange,
  onPlasmaPlotAreaChange,
  onPickTime,
}: {
  data: HeliosphericMonitorResponse;
  brief?: SolarBriefResponse | null;
  analysisDomain?: { min: number; max: number };
  selectedTime?: number;
  onPlotAreaChange?: PlotAreaReporter;
  onPlasmaPlotAreaChange?: PlotAreaReporter;
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
        OBSERVATION_READOUT_TOLERANCE_MS,
      );
      return {
        speed: read(samples.speed),
        bz: read(samples.bz),
        density: read(samples.density),
        temperature: read(samples.temperature),
      };
    }, [samples, selectedTime]);
  const markers = useMemo(() => {
    const times = data.xray?.times ?? [];
    const fluxes = data.xray?.flux ?? [];
    return times
      .map((time, index) => ({ time: Date.parse(time), flux: fluxes[index] }))
      .filter((point): point is { time: number; flux: number } => (
        Number.isFinite(point.time)
        && point.flux != null
        && point.flux >= 1e-5
        && point.time >= domain.min
        && point.time < domain.max
      ))
      .reduce<{ time: number; flux: number }[]>((peaks, point) => {
        const previous = peaks[peaks.length - 1];
        if (previous && point.time - previous.time < 6 * 60 * 60 * 1000) {
          if (point.flux > previous.flux) peaks[peaks.length - 1] = point;
        } else {
          peaks.push(point);
        }
        return peaks;
      }, [])
      .map((peak) => ({
        x: peak.time,
        label: peak.flux >= 1e-4
          ? `X${(peak.flux / 1e-4).toFixed(1)}`
          : `M${(peak.flux / 1e-5).toFixed(1)}`,
        color: "#ef4444",
      }));
  }, [data.xray, domain.min, domain.max]);
  const hasSpeed = samples.speed.some(value => value != null);
  const hasDensity = samples.density.some(value => value != null);
  const hasTemperature = samples.temperature.some(value => value != null);
  const hasBz = samples.bz.some(value => value != null);
  const speedScale = useMemo(() => {
    const values = samples.speed.filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length) return { min: 250, max: 700 };
    const low = Math.min(...values);
    const high = Math.max(...values);
    const pad = Math.max(25, (high - low) * 0.12);
    return {
      min: Math.floor((low - pad) / 25) * 25,
      max: Math.ceil((high + pad) / 25) * 25,
    };
  }, [samples.speed]);
  const unavailable = [
    !hasSpeed ? "Solar wind speed" : null,
    !hasBz ? "IMF Bz" : null,
  ].filter((value): value is string => value != null);
  const plasmaUnavailable = [
    !hasDensity ? "Solar wind density" : null,
    !hasTemperature ? "Proton temperature" : null,
  ].filter((value): value is string => value != null);

  return <section className="card" aria-label="Solar wind velocity and IMF Bz comparison">
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".75rem" }}>
      <strong>Solar wind velocity and IMF Bz</strong>
      {!analysisDomain && <div role="group" aria-label="Solar wind and Bz live window">
        {[24, 48, 72, 168, 720].map(value => <button key={value} type="button" className="btn" aria-pressed={hours === value} disabled={Boolean(calendar?.day)} onClick={() => setHours(value)}>{value === 720 ? "30D" : value === 168 ? "7D" : `${value} h`}</button>)}
      </div>}
    </div>
    <p style={{ fontSize: ".78rem" }}>NOAA SWPC RTSW · speed on the left axis · GSM Bz on the right axis · UTC observation times</p>
    {selectedReadings && selectedTime != null && <p aria-live="polite" style={{ fontSize: ".8rem", margin: "0 0 .45rem" }}>
      Selected {new Date(selectedTime).toISOString().replace("T", " ").slice(0, 16)} UTC
      {" · "}Speed: {selectedReadings.speed ? `${selectedReadings.speed.value!.toFixed(1)} km/s at ${new Date(selectedReadings.speed.time).toISOString().slice(11, 16)} UTC` : "N/A"}
      {" · "}Bz: {selectedReadings.bz ? `${selectedReadings.bz.value!.toFixed(2)} nT at ${new Date(selectedReadings.bz.time).toISOString().slice(11, 16)} UTC` : "N/A"}
      {" · "}Density: {selectedReadings.density ? `${selectedReadings.density.value!.toFixed(2)} cm⁻³ at ${new Date(selectedReadings.density.time).toISOString().slice(11, 16)} UTC` : "N/A"}
      {" · "}Proton temperature: {selectedReadings.temperature ? `${selectedReadings.temperature.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })} K at ${new Date(selectedReadings.temperature.time).toISOString().slice(11, 16)} UTC` : "N/A"}
    </p>}
    <LineChart labels={samples.times.map(time => new Date(time).toISOString())} xValues={samples.times} epochMs={samples.times}
      datasets={[
        { label: "Solar wind speed", data: samples.speed, color: "#eab308", ...observationStyle },
        { label: "IMF Bz (GSM)", data: samples.bz, color: "#ef4444", yAxisId: "y2", ...observationStyle },
        { label: "Bz = 0 nT", data: samples.times.map(() => 0), color: "#94a3b8", yAxisId: "y2", dashed: true, borderWidth: 1 },
      ]} yLabel="Speed (km/s)" secondaryYLabel="IMF Bz (nT)" height={340} pointRadius={1}
      yMin={speedScale.min} yMax={speedScale.max}
      preserveSamples toggleableLegend verticalMarkers={markers} onPlotAreaChange={onPlotAreaChange} onPickTime={onPickTime}
      markerReadout={selectedTime != null && selectedReadings ? { x: selectedTime, lines: [
        `${new Date(selectedTime).toISOString().slice(11, 16)} UTC`,
        `Speed: ${selectedReadings.speed ? `${selectedReadings.speed.value!.toFixed(1)} km/s at ${new Date(selectedReadings.speed.time).toISOString().slice(11, 16)} UTC` : "N/A"} · Bz: ${selectedReadings.bz ? `${selectedReadings.bz.value!.toFixed(2)} nT at ${new Date(selectedReadings.bz.time).toISOString().slice(11, 16)} UTC` : "N/A"}`,
        `Density: ${selectedReadings.density ? `${selectedReadings.density.value!.toFixed(2)} cm⁻³ at ${new Date(selectedReadings.density.time).toISOString().slice(11, 16)} UTC` : "N/A"} · Temp: ${selectedReadings.temperature ? `${selectedReadings.temperature.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })} K at ${new Date(selectedReadings.temperature.time).toISOString().slice(11, 16)} UTC` : "N/A"}`,
      ] } : undefined}
      {...utcTimeAxisProps(domain, { majorHours: 3 })} />
    {unavailable.length > 0 && <p role="status">{unavailable.join(", ")} observations unavailable in this window. Missing data remains empty.</p>}
    <p style={{ fontSize: ".78rem" }}>Source fetched: {data.updated_utc ?? "unavailable"}. Speed, density, and temperature come from NOAA RTSW plasma samples. Bz comes from the NOAA GSM magnetic field series. Older readings use archived 15-minute averages. Gaps appear when readings are more than 35 minutes apart. {markers.length > 0 && "Red lines mark available M/X flare peak times from the latest NOAA flare list (past 24 hours). Flare radiation reaches Earth in about eight minutes; these markers do not identify solar-wind arrival times or establish causation. "}Southward Bz (below zero) can favour magnetospheric coupling.</p>
    <div style={{ borderTop: "1px solid rgba(148,163,184,.25)", marginTop: "1rem", paddingTop: "1rem" }}>
      <strong>Solar wind density and proton temperature</strong>
      <p style={{ fontSize: ".78rem", margin: ".35rem 0" }}>
        NOAA SWPC RTSW and NOAA NCEI SOLAR-1 archive · density on the left axis · proton temperature on the right axis · UTC observation times
      </p>
      <p style={{ fontSize: ".78rem" }}>Where Level 3 is unavailable, the archive uses Level 2 proton measurements, which can include uncorrected values.</p>
      {plasmaUnavailable.length > 0 && <p role="status">{plasmaUnavailable.join(", ")} observations unavailable in this window. Missing data remains empty.</p>}
      <LineChart labels={samples.times.map(time => new Date(time).toISOString())} xValues={samples.times} epochMs={samples.times}
        datasets={[
          { label: "Solar wind density", data: samples.density, color: "#38bdf8", ...observationStyle },
          { label: "Proton temperature", data: samples.temperature, color: "#f97316", yAxisId: "y2", ...observationStyle },
        ]} yLabel="Density (cm³)" secondaryYLabel="Proton temp. (K)" height={300} pointRadius={1}
        preserveSamples toggleableLegend verticalMarkers={markers}
        onPlotAreaChange={onPlasmaPlotAreaChange} onPickTime={onPickTime}
        markerReadout={selectedTime != null && selectedReadings ? { x: selectedTime, lines: [
          `${new Date(selectedTime).toISOString().slice(11, 16)} UTC`,
          `Density: ${selectedReadings.density ? selectedReadings.density.value!.toFixed(2) + " cm⁻³" : "N/A"} · Temp: ${selectedReadings.temperature ? selectedReadings.temperature.value!.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " K" : "N/A"}`,
        ] } : undefined}
        {...utcTimeAxisProps(domain, { majorHours: 3 })} />
    </div>
  </section>;
}
