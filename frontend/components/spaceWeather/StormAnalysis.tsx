"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { getHeliosphericMonitor, getLiveVtecByStation } from "@/lib/api";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import type { GoesXrayRange } from "@/components/spaceWeather/GoesSolarXrayCard";
import { loadLineChart } from "@/lib/loadLineChart";
import type { GoesXrayTimelinePoint } from "@/lib/types";
import { seriesEpochsFromApi, utcTimeAxisProps } from "@/lib/chartTimeAxis";
import type { PlotArea, PlotAreaReporter, PlotBounds } from "@/lib/chartPlotArea";
import { startVisiblePolling } from "@/lib/visiblePolling";
import { runMeanVtecEkf } from "@/lib/meanVtecEkf";
import { readFlarePeak } from "@/lib/flareEruption";
import { buildNetworkMeanVtecSeries, nearestReading, referenceTec, type AnalysisPoint } from "@/lib/stormAnalysis";
import type { HeliosphericMonitorResponse, LiveStationVtecSeries } from "@/lib/types";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const GoesSolarXrayCard = dynamic(
  () =>
    import("@/lib/loadGoesSolarXrayCard").then(({ loadGoesSolarXrayCard }) =>
      loadGoesSolarXrayCard().then(module => module.default),
    ),
  { ssr: false },
);
const SolarWindBzComparison = dynamic(() => import("@/components/spaceWeather/SolarWindBzComparison"), { ssr: false });
const HeliosphericKpBars = dynamic(() => import("@/components/spaceWeather/HeliosphericKpBars"), { ssr: false });
const DstKpOverview = dynamic(() => import("@/components/spaceWeather/ZimbabweIonoResponseFigures"), { ssr: false });
const ZimbabweMeanDiurnalTec = dynamic(() => import("@/components/charts/ZimbabweMeanDiurnalTec"), { ssr: false });
const PROTON_COLORS: Record<string, string> = {
  ">=10 MeV": "#38bdf8",
  ">=50 MeV": "#a78bfa",
  ">=100 MeV": "#f97316",
  ">=500 MeV": "#ef4444",
};
const PLOTS = ["xray", "wind", "windPlasma", "proton", "overview", "kp", "dst", "speed", "bz", "meanTec", "regionalTec", "delta"] as const;
type Plot = (typeof PLOTS)[number];
type PlotLayout = { areas: Partial<Record<Plot, PlotArea>>; bounds?: PlotBounds };
const points = (times: string[], values: (number | null)[]): AnalysisPoint[] => times.map((time, index) => ({ time: Date.parse(time), value: values[index] ?? null })).filter(point => Number.isFinite(point.time));

function sameBounds(a?: PlotBounds, b?: PlotBounds): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < .5 && Math.abs(a.right - b.right) < .5;
}

function createPlotLayout(getRect: () => DOMRect | undefined) {
  const listeners = new Set<() => void>();
  const reports = new Map<Plot, { natural: PlotBounds; redraw: () => void; readArea: () => PlotArea | null }>();
  let snapshot: PlotLayout = { areas: {} };
  let alignedBounds: PlotBounds | undefined;
  let width = 0;
  let frame: number | null = null;

  function schedule() {
    if (frame == null) frame = requestAnimationFrame(flush);
  }

  function flush() {
    frame = null;
    const rect = getRect();
    if (!rect) return;
    for (const [plot, report] of reports) {
      if (!report.readArea()) reports.delete(plot);
    }
    if (!reports.size) return;
    const samples = [...reports.values()];
    const bounds = {
      left: Math.max(...samples.map(report => report.natural.left)),
      right: Math.min(...samples.map(report => report.natural.right)),
    };
    if (bounds.right <= bounds.left) return;

    // Only a new shared horizontal range requires rerunning Chart.js.
    // Vertical movements only change the marker overlay.
    if (!sameBounds(bounds, alignedBounds)) {
      alignedBounds = bounds;
      samples.forEach(report => report.redraw());
    }

    const areas: PlotLayout["areas"] = {};
    let changed = !sameBounds(alignedBounds, snapshot.bounds);
    for (const [plot, report] of reports) {
      const screen = report.readArea();
      if (!screen) continue;
      const area = { left: screen.left - rect.left, right: screen.right - rect.left, top: screen.top - rect.top, bottom: screen.bottom - rect.top };
      const old = snapshot.areas[plot];
      areas[plot] = area;
      changed ||= !old || !sameBounds(area, old) ||
        Math.abs(area.top - old.top) >= .5 || Math.abs(area.bottom - old.bottom) >= .5;
    }
    if (!changed && Object.keys(snapshot.areas).length === reports.size) return;
    snapshot = { areas, bounds: alignedBounds };
    listeners.forEach(listener => listener());
  }

  const reporters = Object.fromEntries(PLOTS.map(plot => {
    const report: PlotAreaReporter = (natural, align, redraw, readArea) => {
      const rect = getRect();
      if (!rect) return;
      if (Math.abs(rect.width - width) >= .5) {
        width = rect.width;
        reports.clear();
        alignedBounds = undefined;
      }
      if (alignedBounds) align({ left: alignedBounds.left + rect.left, right: alignedBounds.right + rect.left });
      reports.set(plot, {
        natural: { left: natural.left - rect.left, right: natural.right - rect.left },
        redraw,
        readArea,
      });
      schedule();
    };
    return [plot, report];
  })) as Record<Plot, PlotAreaReporter>;

  return {
    getRect,
    reporters,
    schedule,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cancel() {
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

export default function StormAnalysis({
  xrayTimeline,
  flareEvents,
  fallbackXraySeries,
  fallbackXrayUpdated,
  xrayRange,
  onXrayRangeChange,
}: {
  xrayTimeline: GoesXrayTimelinePoint[];
  flareEvents?: Record<string, unknown>[];
  fallbackXraySeries?: number[] | null;
  fallbackXrayUpdated?: string | null;
  xrayRange: GoesXrayRange;
  onXrayRangeChange: (range: GoesXrayRange) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [endDay, setEndDay] = useState(today);
  const [days, setDays] = useState(3);
  const [station, setStation] = useState("gutu");
  const [referenceDay, setReferenceDay] = useState("");
  const [helio, setHelio] = useState<HeliosphericMonitorResponse | null>(peekHeliosphericMonitor);
  const [rows, setRows] = useState<LiveStationVtecSeries[]>([]);
  const [referenceRows, setReferenceRows] = useState<LiveStationVtecSeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tecError, setTecError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const stackRef = useRef<HTMLDivElement>(null);
  const [plotLayout] = useState(() => createPlotLayout(() => stackRef.current?.getBoundingClientRect()));
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const observer = new ResizeObserver(plotLayout.schedule);
    observer.observe(stack);
    return () => {
      observer.disconnect();
      plotLayout.cancel();
    };
  }, [plotLayout]);
  const domain = useMemo(() => {
    const max = Date.parse(`${endDay}T00:00:00Z`) + 86400000;
    return { min: max - days * 86400000, max };
  }, [endDay, days]);
  const selectedTime = Math.max(domain.min, Math.min(domain.max, picked ?? Date.now()));
  const flarePeaks = useMemo(() => {
    const peaks = new Map<string, { x: number; label: string }>();
    for (const event of flareEvents ?? []) {
      const peak = readFlarePeak(event, true);
      if (!peak || (peak.letter !== "M" && peak.letter !== "X")) continue;
      if (peak.peakMs < domain.min || peak.peakMs >= domain.max) continue;
      peaks.set(`${peak.peakMs}:${peak.classText}`, { x: peak.peakMs, label: peak.classText });
    }
    return [...peaks.values()].sort((a, b) => a.x - b.x);
  }, [domain, flareEvents]);
  const selectedFlare = flarePeaks.reduce<(typeof flarePeaks)[number] | null>((closest, peak) => {
    const distance = Math.abs(peak.x - selectedTime);
    if (distance > 5 * 60_000) return closest;
    return !closest || distance < Math.abs(closest.x - selectedTime) ? peak : closest;
  }, null);
  const pick = (time: number) => setPicked(Math.round(time / 60000) * 60000);

  useEffect(() => {
    let cancelled = false;
    const stop = startVisiblePolling(async () => {
      try { const data = await getHeliosphericMonitor(false, true); if (!cancelled) { setHelio(data); setError(null); } }
      catch { if (!cancelled) setError("Solar-wind or Dst update failed. Retained observations keep their original times."); }
    }, 60_000);
    return () => { cancelled = true; stop(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRows([]); setTecError(null); setLoading(true);
    const load = async () => {
      try {
        const dayList = Array.from({ length: days }, (_, index) => new Date(domain.min + index * 86400000).toISOString().slice(0, 10));
        // Sequential daily requests avoid saturating the archive connection pool.
        const result: LiveStationVtecSeries[] = [];
        for (const day of dayList) {
          const daily = await getLiveVtecByStation(24, 15, 90000, day);
          if (cancelled) return;
          if (!daily.length) throw new Error("archive unavailable");
          result.push(...daily);
        }
        if (!cancelled) { setRows(result); setTecError(null); }
      } catch { if (!cancelled) setTecError("Station TEC history could not be loaded; retry by changing the window or station."); }
      finally { if (!cancelled) setLoading(false); }
    };
    const stop = startVisiblePolling(load, 5 * 60_000);
    return () => { cancelled = true; stop(); };
  }, [domain.min, days, station]);

  useEffect(() => {
    let cancelled = false;
    setReferenceRows([]); setReferenceError(null);
    if (referenceDay) getLiveVtecByStation(24, 15, 90000, referenceDay, [station])
      .then(data => { if (!cancelled) { setReferenceRows(data); if (!data.length) setReferenceError("Reference archive unavailable."); } })
      .catch(() => { if (!cancelled) setReferenceError("Reference archive unavailable."); });
    return () => { cancelled = true; };
  }, [referenceDay, station]);

  const measurements = useMemo(() => {
    const normalize = (code: string) => code.toLowerCase().replace(/_+$/, "");
    const fromRows = (data: LiveStationVtecSeries[]) => data.filter(row => normalize(row.station) === normalize(station)).flatMap(row => row.points.map(point => ({ time: Date.parse(point.time), value: point.vtec_tecu })));
    return referenceTec(fromRows(rows), fromRows(referenceRows)).filter(point => point.time >= domain.min && point.time < domain.max);
  }, [rows, referenceRows, station, domain]);
  const networkMean = useMemo(
    () => buildNetworkMeanVtecSeries(rows, domain.min, domain.max),
    [rows, domain],
  );
  const networkEkf = useMemo(
    () => runMeanVtecEkf(networkMean.map(point => point.value)),
    [networkMean],
  );
  const networkEkfReady = networkEkf.predicted.some(value => value != null);
  const networkMeanIndex = useMemo(
    () => new Map(networkMean.map((point, index) => [point.time, index])),
    [networkMean],
  );
  const protonChart = useMemo(() => {
    if (!helio || helio.protons.labels.length === 0) return null;
    const epochs = seriesEpochsFromApi(helio.protons.labels, helio.protons.epoch_ms, helio.protons.times);
    if (!epochs) return null;
    const datasets = Object.entries(helio.protons.series).map(([energy, values]) => ({
      label: energy,
      data: values,
      color: PROTON_COLORS[energy] ?? "#94a3b8",
      fill: true,
    }));
    return { epochs, datasets };
  }, [helio]);
  const protonReadings = useMemo(() => {
    if (!helio || !protonChart) return [];
    return Object.entries(helio.protons.series).map(([energy, values]) => ({
      energy,
      reading: nearestReading(
        protonChart.epochs.map((time, index) => ({ time, value: values[index] ?? null })),
        selectedTime,
        5 * 60_000,
      ),
    }));
  }, [helio, protonChart, selectedTime]);
  const panels = [
    { plot: "dst" as const, title: "Dst", unit: "Dst (nT)", color: "#f8fafc", tolerance: 35 * 60000, cadence: 65 * 60000, data: points(helio?.dst?.times ?? [], helio?.dst?.dst ?? []) },
    { plot: "speed" as const, title: "Solar wind speed", unit: "Vsw (km/s)", color: "#3b82f6", tolerance: 10 * 60000, cadence: 10 * 60000, data: points(helio?.solar_wind.times ?? [], helio?.solar_wind.speed ?? []) },
    { plot: "bz" as const, title: "IMF Bz (GSM)", unit: "Bz (nT)", color: "#f8fafc", tolerance: 10 * 60000, cadence: 10 * 60000, data: points(helio?.imf.times ?? [], helio?.imf.bz ?? []) },
    { plot: "meanTec" as const, title: "Network mean VTEC", unit: "VTEC (TECU)", color: "#00ff88", tolerance: 8 * 60000, cadence: 20 * 60000, data: networkMean },
    { plot: "delta" as const, title: "Relative VTEC difference", unit: "ΔVTEC (%)", color: "#f8fafc", tolerance: 8 * 60000, cadence: 20 * 60000, data: measurements.map(point => ({ time: point.time, value: point.delta })) },
  ];

  return <section className="card" aria-label="Storm analysis">
    <h2>Analysis · Sun–Earth–ionosphere</h2>
    <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
      <label>End UTC day <input type="date" value={endDay} max={today} onChange={event => { if (event.target.value) setEndDay(event.target.value); }} /></label>
      <label>Window <select value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 3, 7].map(value => <option key={value} value={value}>{value} day(s)</option>)}</select></label>
      <label>Station code <input value={station} maxLength={12} onChange={event => setStation(event.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} /></label>
      <label>Reference UTC day <input type="date" value={referenceDay} max={today} onChange={event => setReferenceDay(event.target.value)} /></label>
      <button type="button" className="btn" onClick={() => setReferenceDay("")}>Clear reference</button>
    </div>
    <p>The station code and reference day apply to the ΔVTEC comparison. Network mean VTEC uses measured samples from all reporting stations; its filter line is calculated from that observed series. Dst is a global index. A selected reference day is not automatically a validated quiet-time baseline.</p>
    {(error || tecError || referenceError) && <p role="status">{[error, tecError, referenceError].filter(Boolean).join(" ")}</p>}
    {loading && <p role="status">Loading station archive…</p>}
    <p>Pink analysis marker: <strong>{new Date(selectedTime).toISOString().replace("T", " ").replace("Z", " UTC")}</strong></p>
    <details style={{ margin: "1rem 0" }}><summary>Fine time adjustment</summary>
    <label style={{ display: "block" }}>Move the analysis time
      <input aria-label="Move pink analysis marker" type="range" min={domain.min} max={domain.max - 60000} step={60000} value={Math.min(selectedTime, domain.max - 60000)} onChange={event => pick(Number(event.target.value))} style={{ width: "100%", accentColor: "#ff00d4" }} />
    </label></details>
    <p>Drag the continuous pink line or its arrow to move the marker through the shared UTC timeline. Focus the line and use the arrow keys for fine adjustment. The regional daily TEC chart plots all measured days in the window by default.</p>
    <p style={{ fontSize: ".8rem" }}>
      {flarePeaks.length ? "Red lines mark cataloged M/X flare peaks across the Analysis graphs." : "No cataloged M/X flare peaks in this window."}
      {selectedFlare && <strong style={{ color: "#fda4af" }}>
        {" "}{selectedFlare.label} flare peaked at {new Date(selectedFlare.x).toISOString().slice(11, 16)} UTC.
      </strong>}
    </p>
    <div ref={stackRef} style={{ position: "relative", paddingBottom: "3rem" }}>
    <GoesSolarXrayCard
      title="1 · GOES X-ray flux (NOAA SWPC)"
      timeline={xrayTimeline}
      fallbackSeries={fallbackXraySeries}
      fallbackUpdated={fallbackXrayUpdated}
      xrayRange={xrayRange}
      onRangeChange={onXrayRangeChange}
      analysisDomain={domain}
      selectedTime={selectedTime}
      onPlotAreaChange={plotLayout.reporters.xray}
      onPickTime={pick}
    />
    {helio && <SolarWindBzComparison data={helio} analysisDomain={domain} selectedTime={selectedTime} onPickTime={pick} onPlotAreaChange={plotLayout.reporters.wind} onPlasmaPlotAreaChange={plotLayout.reporters.windPlasma} />}
    {helio && <section className="card" aria-label="GOES proton flux">
      <strong>GOES proton flux</strong>
      <p style={{ fontSize: ".78rem" }}>Integral channels · NOAA SWPC · pfu (particles cm⁻² s⁻¹ sr⁻¹) · shared Analysis UTC window</p>
      {protonChart ? <>
        <p aria-live="polite" style={{ fontSize: ".8rem", margin: "0 0 .45rem" }}>
          Selected {new Date(selectedTime).toISOString().replace("T", " ").slice(0, 16)} UTC
          {" · "}{protonReadings.map(({ energy, reading }) => `${energy}: ${reading ? `${reading.value!.toPrecision(3)} pfu` : "N/A"}`).join(" · ")}
        </p>
        <LineChart
          labels={helio.protons.labels}
          xValues={protonChart.epochs}
          epochMs={protonChart.epochs}
          datasets={protonChart.datasets}
          yLabel="Proton flux (pfu)"
          height={260}
          toggleableLegend
          onPlotAreaChange={plotLayout.reporters.proton}
          onPickTime={pick}
          {...utcTimeAxisProps(domain, { majorHours: 3 })}
        />
      </> : <p role="status">{helio.protons.labels.length === 0
        ? "Proton flux unavailable. NOAA has not returned recent or cached observations."
        : "Proton flux timestamps could not be aligned to UTC; the chart is omitted."}</p>}
    </section>}
    <section aria-label="Dst and Kp overview" style={{ margin: "1rem 0" }}>
      <DstKpOverview analysisDomain={domain} onPlotAreaChange={plotLayout.reporters.overview} onPickTime={pick} />
    </section>
    {helio && (
      <section className="card" aria-label="GFZ and NOAA planetary Kp observed and forecast">
        <strong>GFZ / NOAA planetary Kp · observed &amp; forecast</strong>
        <p style={{ fontSize: ".78rem" }}>
          Observed Kp, estimated Kp and NOAA predicted Kp; the white line is Kyoto Dst. Shared Analysis UTC window.
        </p>
        <HeliosphericKpBars
          labels={helio.kp.labels}
          times={helio.kp.times}
          epochMs={helio.kp.epoch_ms}
          observed={helio.kp.observed}
          estimated={helio.kp.estimated}
          predicted={helio.kp.predicted}
          dst={helio.dst?.dst}
          dstLabels={helio.dst?.labels}
          dstTimes={helio.dst?.times}
          dstEpochMs={helio.dst?.epoch_ms}
          analysisDomain={domain}
          onPickTime={pick}
          onPlotAreaChange={plotLayout.reporters.kp}
        />
      </section>
    )}
    {panels.map((panel, index) => {
      const sorted = panel.data.filter(point => point.time >= domain.min && point.time < domain.max).sort((a, b) => a.time - b.time);
      const isNetworkMean = panel.title === "Network mean VTEC";
      const reading = nearestReading(sorted, selectedTime, panel.tolerance);
      const values = sorted.flatMap(point => point.value != null && Number.isFinite(point.value) ? [point.value] : []);
      const minimum = values.length ? Math.min(...values) : 0;
      const maximum = values.length ? Math.max(...values) : 0;
      const networkIndexes = sorted.map(point => networkMeanIndex.get(point.time));
      const datasets = isNetworkMean
        ? [
            { label: "Observed", data: sorted.map(point => point.value), color: "#00ff88", fill: true, borderWidth: 2.5, spanGaps: true, tension: 0 },
            ...(networkEkfReady
              ? [{
                  label: "EKF Predicted",
                  data: networkIndexes.map(index => index == null ? null : networkEkf.predicted[index]),
                  color: "#e2e8f0",
                  dashed: true,
                  fill: false,
                  borderWidth: 2,
                  spanGaps: false,
                  tension: 0,
                  meta: networkIndexes.map(index => index == null ? null : networkEkf.meta[index]),
                }]
              : []),
          ]
        : [{ label: panel.title, data: sorted.map(point => point.value), color: panel.color, spanGaps: panel.cadence, tension: 0 }];
      const suggestedMin = index === 1 ? Math.max(200, Math.floor(Math.min(minimum || 400, 400) / 20) * 20 - 20)
        : index === 2 ? -Math.max(10, Math.ceil(Math.max(Math.abs(minimum), Math.abs(maximum)) / 5) * 5)
        : index === 4 ? Math.min(-50, Math.floor(minimum / 25) * 25)
        : index === 0 ? Math.min(-10, Math.floor(minimum / 10) * 10 - 5) : 0;
      const suggestedMax = index === 1 ? Math.ceil(Math.max(maximum, 600) / 20) * 20
        : index === 2 ? -suggestedMin : index === 3 ? 50
        : index === 4 ? Math.max(50, Math.ceil(maximum / 25) * 25)
        : Math.max(10, Math.ceil(maximum / 10) * 10 + 5);
      return <div key={panel.title} style={{ marginTop: "1rem" }}>
        {panel.title === "Relative VTEC difference" && <div style={{ marginBottom: "1.25rem" }}>
          <strong>Mean daily TEC — northern, central and southern Zimbabwe</strong>
          <ZimbabweMeanDiurnalTec embedded analysisDomain={domain} analysisDay={endDay} onPlotAreaChange={plotLayout.reporters.regionalTec} />
        </div>}
        <strong>{panel.title}</strong> · {reading ? `${reading.value!.toFixed(1)} ${panel.unit.match(/\((.*)\)/)?.[1] ?? ""} at ${new Date(reading.time).toISOString()}` : "No observation near the marker"}
        <LineChart labels={sorted.map(point => new Date(point.time).toISOString())} xValues={sorted.map(point => point.time)} epochMs={sorted.map(point => point.time)}
          datasets={datasets}
          yLabel={panel.unit} yAxisWidth={80} height={isNetworkMean ? 320 : 360}
          ySuggestedMin={suggestedMin} ySuggestedMax={suggestedMax} yMin={index === 3 ? 0 : undefined}
          preserveSamples pointRadius={index === 0 ? 2 : 0}
          thresholds={index === 4 ? [{ value: 25, label: "+25% guide", color: "#f87171" }, { value: -25, label: "−25% guide", color: "#f87171" }] : index === 0 || index === 2 ? [{ value: 0, label: "Zero", color: "#64748b" }] : undefined}
          onPlotAreaChange={plotLayout.reporters[panel.plot]}
          onPickTime={pick} {...utcTimeAxisProps(domain)} />
      </div>;
    })}
    <AnalysisMarker layout={plotLayout} domain={domain} selectedTime={selectedTime}
      flarePeaks={flarePeaks} selectedFlare={selectedFlare} pick={pick} />
    </div>
    <p>ΔVTEC = 100 × (observed − reference) / reference, matched to the same station and UTC quarter-hour. Missing or zero reference values produce gaps. ±25% lines are comparison guides, not validated storm thresholds. No reference curve or historical storm values are invented. Solar-wind, Bz and Dst are limited to loaded NOAA source coverage. NOAA source fetched: {helio?.updated_utc ?? "unavailable"}.</p>
  </section>;
}

type FlareMarker = { x: number; label: string };

function AnalysisMarker({ layout, domain, selectedTime, flarePeaks, selectedFlare, pick }: {
  layout: ReturnType<typeof createPlotLayout>;
  domain: { min: number; max: number };
  selectedTime: number;
  flarePeaks: FlareMarker[];
  selectedFlare: FlareMarker | null;
  pick: (time: number) => void;
}) {
  const dragging = useRef(false);
  const timeFraction = (time: number) => (time - domain.min) / (domain.max - domain.min);
  const plotX = ({ left, right }: PlotBounds, time: number) => left + (right - left) * timeFraction(time);
  const { areas: plotAreas, bounds } = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot);
  const markerTop = plotAreas.xray?.top ?? plotAreas.wind?.top ?? plotAreas.proton?.top ?? plotAreas.overview?.top ?? plotAreas.dst?.top;
  const markerEnd = bounds && plotAreas.delta ? { x: plotX(bounds, selectedTime), y: plotAreas.delta.bottom } : null;
  const moveMarker = (clientX: number) => {
    const rect = layout.getRect();
    if (!rect || !bounds || bounds.right <= bounds.left) return;
    const { left, right } = bounds;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left - left) / (right - left)));
    pick(domain.min + fraction * (domain.max - domain.min));
  };

  if (markerTop == null || !markerEnd) return null;
  return <>
    <svg role="slider" tabIndex={0} aria-label="Drag pink analysis line" aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={selectedTime} aria-valuetext={new Date(selectedTime).toISOString()}
      onPointerDown={event => {
        dragging.current = true;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => { if (dragging.current) moveMarker(event.clientX); }}
      onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { dragging.current = false; }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); pick(Math.max(domain.min, Math.min(domain.max, selectedTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1) * 60000))); }
      }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none", cursor: "ew-resize", touchAction: "none" }}>
      {PLOTS.map(plot => {
        const area = plotAreas[plot];
        if (!area || !flarePeaks.length) return null;
        return <g key={plot} aria-hidden="true" data-flare-plot={plot}>
          {flarePeaks.map((peak, index) => {
            const x = plotX(area, peak.x);
            const highlighted = peak === selectedFlare;
            const labelOnLeft = area.right - x < peak.label.length * 8 + 8;
            return <g key={`${peak.x}:${peak.label}`}>
              <line x1={x} x2={x} y1={area.top} y2={area.bottom} stroke="#f87171" strokeWidth={highlighted ? 2 : 1} />
              <text x={x + (labelOnLeft ? -5 : 5)} y={area.top + 14 + (index % 3) * 14}
                textAnchor={labelOnLeft ? "end" : "start"}
                fill={highlighted ? "#fff" : "#f87171"} fontSize={highlighted ? 12 : 11}
                fontWeight={highlighted ? 700 : 400}
                stroke={highlighted ? "#be123c" : "#0c121c"} strokeWidth={highlighted ? 5 : 2}
                strokeLinejoin="round" paintOrder="stroke">
                {peak.label}
              </text>
            </g>;
          })}
        </g>;
      })}
      <line aria-hidden="true" x1={markerEnd.x} x2={markerEnd.x} y1={markerTop} y2={markerEnd.y + 12}
        stroke="#ff00d4" strokeWidth={3} />
      <line aria-hidden="true" x1={markerEnd.x} x2={markerEnd.x} y1={markerTop} y2={markerEnd.y + 18}
        stroke="transparent" strokeWidth={28} style={{ pointerEvents: "stroke", touchAction: "none" }} />
      <polygon aria-hidden="true" points={`${markerEnd.x - 8},${markerEnd.y + 5} ${markerEnd.x + 8},${markerEnd.y + 5} ${markerEnd.x},${markerEnd.y + 19}`} fill="#ff00d4" />
    </svg>
      <span aria-hidden="true" style={{ position: "absolute", top: markerEnd.y + 18, left: markerEnd.x, transform: "translateX(-50%)", zIndex: 5, pointerEvents: "none", color: "#ff00d4", fontWeight: 800, whiteSpace: "nowrap", fontSize: ".85rem", background: "var(--surface)" }}>
        Pick {new Date(selectedTime).toISOString().slice(5, 16).replace("T", " ")} UTC
      </span>
  </>;
}
