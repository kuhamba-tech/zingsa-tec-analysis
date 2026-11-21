"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { getEquatorialElectricField, getGfzKpAnalysis, getHeliosphericMonitor, getLiveVtecByStation, type SolarArchiveDay } from "@/lib/api";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import type { GoesXrayRange } from "@/components/spaceWeather/GoesSolarXrayCard";
import { loadLineChart } from "@/lib/loadLineChart";
import type { GoesXrayTimelinePoint } from "@/lib/types";
import { seriesEpochsFromApi, utcTimeAxisProps } from "@/lib/chartTimeAxis";
import type { PlotArea, PlotAreaReporter, PlotBounds } from "@/lib/chartPlotArea";
import { startVisiblePolling } from "@/lib/visiblePolling";
import { runMeanVtecEkf } from "@/lib/meanVtecEkf";
import { readFlarePeak } from "@/lib/flareEruption";
import { SOLAR_WIND_SPEED_SCALE } from "@/lib/spaceWeatherMetrics";
import AnalysisSolarDisk from "./AnalysisSolarDisk";
import SolarActivityLevels from "./SolarActivityLevels";
import flareTable from "./FlareActivityTable.module.css";
import styles from "./StormAnalysis.module.css";
import { buildNetworkMeanVtecSeries, mergeStationVtecHistory, nearestReading, OBSERVATION_READOUT_TOLERANCE_MS, referenceTec, type AnalysisPoint } from "@/lib/stormAnalysis";
import type { EquatorialElectricFieldPoint, HeliosphericMonitorResponse, LiveStationVtecSeries, SolarActivityFull } from "@/lib/types";

const LineChart = dynamic(() => loadLineChart().then(module => module.default), { ssr: false });
const SolarFlareMonthChart = memo(dynamic(() => import("./SolarFlareMonthChart"), { ssr: false }));
const ActiveRegionInspector = memo(dynamic(() => import("./ActiveRegionInspector"), { ssr: false }));
const FlareActivityTable = memo(dynamic(() => import("./FlareActivityTable"), { ssr: false }));
const FLARE_COLUMNS = ["Solar flare", "Region of origin", "Start time (UT)", "End time (UT)", "Peak time (UT)", "Duration (min)"];

function flareTime(value: unknown): number {
  if (typeof value !== "string" || !value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}

function SelectedFlareTable({ time, events, archive }: {
  time: number;
  events?: Record<string, unknown>[];
  archive?: SolarArchiveDay;
}) {
  const candidates = (archive?.flare_regions ?? []).map(report => ({
    label: report.flare_class, peak: flareTime(report.time), start: flareTime(report.start),
    end: flareTime(report.end), region: report.region,
  }));
  for (const event of events ?? []) {
    const peak = readFlarePeak(event, true);
    if (!peak || !/^[CMX]/.test(peak.classText)) continue;
    const start = flareTime(event.beginTime ?? event.begin_time);
    const end = flareTime(event.endTime ?? event.end_time);
    const region = Number(event.activeRegionNum ?? event.region) || null;
    const report = candidates.find(row => row.label === peak.classText && Math.abs(row.peak - peak.peakMs) <= 120_000);
    if (report) {
      if (!Number.isFinite(report.start)) report.start = start;
      if (!Number.isFinite(report.end)) report.end = end;
      report.region ??= region;
    } else {
      candidates.push({ label: peak.classText, peak: peak.peakMs, start, end, region });
    }
  }
  const selected = candidates
    .filter(row => (time >= row.start && time <= row.end) || Math.abs(time - row.peak) <= 300_000)
    .sort((a, b) => Math.abs(time - a.peak) - Math.abs(time - b.peak))[0];
  const clock = (ms: number) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : "–";
  const tones: Record<string, string> = { C: flareTable.flareC, M: flareTable.flareM, X: flareTable.flareX };
  return <div className={`${flareTable.eventsScroll} ${styles.flareTable}`} style={{ margin: ".75rem 0 1rem" }}>
    <table className={flareTable.eventsTable} aria-label="Flare at the pink analysis marker">
      <thead><tr>
        {FLARE_COLUMNS.map(heading => <th key={heading} scope="col">{heading}</th>)}
      </tr></thead>
      <tbody role="rowgroup">{selected ? <tr role="row">
        {[
          <span key="class" className={`${flareTable.flare} ${tones[selected.label[0]]}`}>{selected.label}</span>,
          <span key="region" className={selected.region ? flareTable.region : flareTable.regionEmpty}>{selected.region ?? "–"}</span>,
          clock(selected.start), clock(selected.end), clock(selected.peak),
          selected.end >= selected.start ? Math.round((selected.end - selected.start) / 6000) / 10 : "–",
        ].map((value, index) => (
          <td key={FLARE_COLUMNS[index]} role="cell" data-label={FLARE_COLUMNS[index]}
            className={index > 1 ? flareTable.clock : undefined}>{value}</td>
        ))}
      </tr> : <tr role="row"><td role="cell" colSpan={6}>No cataloged C-, M-, or X-class flare at the selected time.</td></tr>}</tbody>
    </table>
  </div>;
}
const GoesSolarXrayCard = dynamic(
  () =>
    import("@/lib/loadGoesSolarXrayCard").then(({ loadGoesSolarXrayCard }) =>
      loadGoesSolarXrayCard().then(module => module.default),
    ),
  { ssr: false },
);
const SolarWindBzComparison = dynamic(() => import("@/components/spaceWeather/SolarWindBzComparison"), { ssr: false });
const InterplanetaryMagneticFieldChart = dynamic(() => import("@/components/spaceWeather/InterplanetaryMagneticFieldChart"), { ssr: false });
const HeliosphericKpBars = dynamic(() => import("@/components/spaceWeather/HeliosphericKpBars"), { ssr: false });
const DstKpOverview = dynamic(() => import("@/components/spaceWeather/ZimbabweIonoResponseFigures"), { ssr: false });
const DstPressureComparison = dynamic(() => import("@/components/spaceWeather/DstPressureComparison"), { ssr: false });
const ZimbabweMeanDiurnalTec = dynamic(() => import("@/components/charts/ZimbabweMeanDiurnalTec"), { ssr: false });
const PROTON_COLORS: Record<string, string> = {
  ">=10 MeV": "#38bdf8",
  ">=50 MeV": "#a78bfa",
  ">=100 MeV": "#f97316",
  ">=500 MeV": "#ef4444",
};
const PLOTS = ["xray", "wind", "windPlasma", "imf", "proton", "pressure", "overview", "kp", "dst", "speed", "bz", "electricField", "meanTec", "regionalTec", "delta"] as const;
type Plot = (typeof PLOTS)[number];
const SOLAR_WIND_SPEED_GUIDES = SOLAR_WIND_SPEED_SCALE
  .filter(band => band.boundary > 0)
  .map(band => ({ value: band.boundary, label: `${band.label} (${band.short} km/s)`, color: band.color }));
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
  solar,
  xrayTimeline,
  flareEvents,
  fallbackXraySeries,
  fallbackXrayUpdated,
  xrayRange,
  onXrayRangeChange,
}: {
  solar: SolarActivityFull | null;
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
  const [stationRows, setStationRows] = useState<LiveStationVtecSeries[]>([]);
  const [referenceRows, setReferenceRows] = useState<LiveStationVtecSeries[]>([]);
  const [quietDays, setQuietDays] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tecError, setTecError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [flareArchive, setFlareArchive] = useState<{ day: string; data: SolarArchiveDay } | null>(null);
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
  const selectedTime = Math.max(domain.min, Math.min(domain.max - 60_000, picked ?? Date.now()));
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
  const pick = useCallback((time: number) => setPicked(Math.round(time / 60000) * 60000), []);
  const changeEndDay = (day: string) => {
    const midnight = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(midnight)) return;
    setEndDay(day);
    pick(midnight + selectedTime % 86_400_000);
  };

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
    const dayList = Array.from({ length: days }, (_, index) => new Date(domain.min + index * 86400000).toISOString().slice(0, 10)).reverse();
    const history = new Map<string, LiveStationVtecSeries[]>();
    const load = async () => {
      const pending: string[] = [];
      // Load the latest day first and publish each day as it arrives.
      for (const day of dayList) {
        const daily = await getLiveVtecByStation(24, 15, 90000, day).catch(() => []);
        if (cancelled) return;
        if (daily.some(row => row.points.length)) {
          history.set(day, mergeStationVtecHistory(history.get(day) ?? [], daily, 15));
          setRows([...history.values()].flat());
          setLoading(false);
        } else {
          pending.push(day);
        }
      }
      setLoading(false);
      setTecError(pending.length ? `Station TEC archive is missing or temporarily unavailable for ${pending.join(", ")} UTC. Retrying automatically.` : null);
    };
    const stop = startVisiblePolling(load, 60_000);
    return () => { cancelled = true; stop(); };
  }, [domain.min, days]);

  useEffect(() => {
    let active = true;
    setStationRows([]);
    const byDay = new Map<string, LiveStationVtecSeries[]>();
    const stop = startVisiblePolling(async () => {
      for (let index = days - 1; index >= 0 && active; index--) {
        const day = new Date(domain.min + index * 86400000).toISOString().slice(0, 10);
        const daily = await getLiveVtecByStation(24, 15, 90000, day, [station]).catch(() => []);
        if (!active || !daily.some(row => row.points.length)) continue;
        byDay.set(day, mergeStationVtecHistory(byDay.get(day) ?? [], daily, 15));
        setStationRows([...byDay.values()].flat());
      }
    }, 5 * 60_000);
    return () => { active = false; stop(); };
  }, [domain.min, days, station]);

  useEffect(() => {
    let cancelled = false;
    setReferenceRows([]); setQuietDays([]); setReferenceError(null);
    async function loadReference() {
      try {
        if (referenceDay) {
          const data = await getLiveVtecByStation(24, 15, 90000, referenceDay, [station]);
          if (!cancelled) {
            setReferenceRows(data);
            if (!data.some(row => row.points.length)) setReferenceError("Reference archive unavailable.");
          }
          return;
        }
        const monthStart = `${endDay.slice(0, 7)}-01`;
        const [year, month] = monthStart.split("-").map(Number);
        const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
        const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
        const end = monthEnd < yesterday ? monthEnd : yesterday;
        const quietReference = await getGfzKpAnalysis(monthStart, end, station);
        const ranked = quietReference.series
          .filter(row => row.date >= monthStart && row.date <= end && row.ap_daily != null)
          .sort((a, b) => a.ap_daily! - b.ap_daily! || a.date.localeCompare(b.date));
        const chosen: string[] = [];
        const history: LiveStationVtecSeries[] = [];
        for (const candidate of ranked) {
          if (cancelled || chosen.length === 5) break;
          const daily = await getLiveVtecByStation(24, 15, 90000, candidate.date, [station]);
          if (!daily.some(row => row.points.some(point => point.vtec_tecu > 0 && point.vtec_tecu <= 50))) continue;
          chosen.push(candidate.date);
          history.push(...daily);
        }
        if (cancelled) return;
        setQuietDays(chosen);
        setReferenceRows(history);
        if (chosen.length < 5) setReferenceError(`Only ${chosen.length} of 5 quiet reference days have usable station VTEC.`);
      } catch {
        if (!cancelled) setReferenceError("The quiet reference could not be loaded.");
      }
    }
    void loadReference();
    return () => { cancelled = true; };
  }, [referenceDay, station, endDay, today]);

  const measurements = useMemo(() => {
    const normalize = (code: string) => code.toLowerCase().replace(/_+$/, "");
    const fromRows = (data: LiveStationVtecSeries[]) => data.filter(row => normalize(row.station) === normalize(station)).flatMap(row => row.points.map(point => ({ time: Date.parse(point.time), value: point.vtec_tecu })));
    return referenceTec(fromRows(stationRows), fromRows(referenceRows), referenceDay ? 1 : 5)
      .filter(point => point.time >= domain.min && point.time < domain.max);
  }, [stationRows, referenceRows, referenceDay, station, domain]);
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
        OBSERVATION_READOUT_TOLERANCE_MS,
      ),
    }));
  }, [helio, protonChart, selectedTime]);
  const panels = [
    { plot: "dst" as const, title: "Dst", unit: "Dst (nT)", color: "#f8fafc", tolerance: 35 * 60000, cadence: 65 * 60000, data: points(helio?.dst?.times ?? [], helio?.dst?.dst ?? []) },
    { plot: "speed" as const, title: "Solar wind speed", unit: "Vsw (km/s)", color: "#3b82f6", tolerance: OBSERVATION_READOUT_TOLERANCE_MS, cadence: 20 * 60000, data: points(helio?.solar_wind.times ?? [], helio?.solar_wind.speed ?? []) },
    { plot: "bz" as const, title: "IMF Bz (GSM)", unit: "Bz (nT)", color: "#f8fafc", tolerance: OBSERVATION_READOUT_TOLERANCE_MS, cadence: 20 * 60000, data: points(helio?.imf.times ?? [], helio?.imf.bz ?? []) },
    { plot: "meanTec" as const, title: "Network mean VTEC", unit: "VTEC (TECU)", color: "#00ff88", tolerance: OBSERVATION_READOUT_TOLERANCE_MS, cadence: 20 * 60000, data: networkMean },
    { plot: "delta" as const, title: "Relative VTEC difference", unit: "ΔVTEC (%)", color: "#f8fafc", tolerance: OBSERVATION_READOUT_TOLERANCE_MS, cadence: 20 * 60000, data: measurements.map(point => ({ time: point.time, value: point.delta })) },
  ];

  return <section className="card" aria-label="Storm analysis">
    <h2>Analysis · Sun–Earth–ionosphere</h2>
    <div className={styles.controls}>
      <label>End UTC day <input type="date" value={endDay} max={today} onChange={event => changeEndDay(event.target.value)} /></label>
      <label>Window <select value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 3, 7].map(value => <option key={value} value={value}>{value} day(s)</option>)}<option value={30}>1 month</option></select></label>
      <label>Station code <input value={station} maxLength={12} onChange={event => setStation(event.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} /></label>
      <label>Reference UTC day override <input type="date" value={referenceDay} max={today} onChange={event => setReferenceDay(event.target.value)} /></label>
      <button type="button" className="btn" onClick={() => setReferenceDay("")}>Use five quiet days</button>
    </div>
    <p>The station code and reference apply to ΔVTEC. Network mean VTEC uses measured samples from all reporting stations. Dst is a global index.</p>
    {(error || tecError || referenceError) && <p role="status">{[error, tecError, referenceError].filter(Boolean).join(" ")}</p>}
    {loading && <p role="status">Loading station archive…</p>}
    <p>Pink analysis marker: <strong>{new Date(selectedTime).toISOString().replace("T", " ").replace("Z", " UTC")}</strong></p>
    <details className={styles.fineTime}><summary>Fine time adjustment</summary>
    <label style={{ display: "block" }}>Move the analysis time
      <input aria-label="Move pink analysis marker" type="range" min={domain.min} max={domain.max - 60000} step={60000} value={Math.min(selectedTime, domain.max - 60000)} onChange={event => pick(Number(event.target.value))} />
    </label></details>
    <p>Drag the continuous pink line or its arrow to move the marker through the shared UTC timeline. Focus the line and use the arrow keys for fine adjustment. The regional daily TEC chart plots all measured days in the window by default.</p>
    <div style={{ marginBottom: "1rem" }}>
      <SolarFlareMonthChart showDailyStorms />
    </div>
    <p style={{ fontSize: ".8rem" }}>
      {flarePeaks.length ? "Red lines mark cataloged M/X flare peaks across the Analysis graphs." : "No cataloged M/X flare peaks in this window."}
      {selectedFlare && <strong style={{ color: "#fda4af" }}>
        {" "}{selectedFlare.label} flare peaked at {new Date(selectedFlare.x).toISOString().slice(11, 16)} UTC.
      </strong>}
    </p>
    <AnalysisSolarDisk time={selectedTime} peaks={flarePeaks} selectedFlare={selectedFlare} onPick={pick} onArchive={setFlareArchive} />
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "1rem", margin: "1rem 0" }}>
      <ActiveRegionInspector />
      <FlareActivityTable solar={solar} summaryOnly />
    </div>
    <div style={{ marginBottom: "1rem" }}><SolarActivityLevels /></div>
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
    <SelectedFlareTable time={selectedTime} events={flareEvents}
      archive={flareArchive?.day === new Date(selectedTime).toISOString().slice(0, 10) ? flareArchive.data : undefined} />
    {helio && <SolarWindBzComparison data={helio} analysisDomain={domain} selectedTime={selectedTime} onPickTime={pick} onPlotAreaChange={plotLayout.reporters.wind} onPlasmaPlotAreaChange={plotLayout.reporters.windPlasma} />}
    {helio && helio.imf.labels.length > 0 && <section className="card" aria-label="Interplanetary magnetic field near Sun-Earth L1">
      <strong>Interplanetary magnetic field near Sun–Earth L1</strong>
      <p style={{ fontSize: ".78rem" }}>RTSW magnetometer · Bt magnitude · GSM By / Bz · nT · shared Analysis UTC window</p>
      <InterplanetaryMagneticFieldChart
        data={helio.imf}
        analysisDomain={domain}
        selectedTime={selectedTime}
        verticalMarkers={flarePeaks}
        onPlotAreaChange={plotLayout.reporters.imf}
        onPickTime={pick}
        height={300}
      />
    </section>}
    {helio && <section className="card" aria-label="GOES proton flux">
      <strong>GOES proton flux</strong>
      <p style={{ fontSize: ".78rem" }}>Integral channels · NOAA SWPC · pfu (particles cm⁻² s⁻¹ sr⁻¹) · shared Analysis UTC window</p>
      {protonChart ? <>
        <p aria-live="polite" style={{ fontSize: ".8rem", margin: "0 0 .45rem" }}>
          Selected {new Date(selectedTime).toISOString().replace("T", " ").slice(0, 16)} UTC
          {" · "}{protonReadings.map(({ energy, reading }) => `${energy}: ${reading ? `${reading.value!.toPrecision(3)} pfu at ${new Date(reading.time).toISOString().slice(11, 16)} UTC` : "N/A"}`).join(" · ")}
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
    {helio && <DstPressureComparison
      data={helio} analysisDomain={domain} selectedTime={selectedTime} onPlotAreaChange={plotLayout.reporters.pressure} onPickTime={pick}
    />}
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
          selectedTime={selectedTime}
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
            { label: "Observed", data: sorted.map(point => point.value), color: "#00ff88", fill: true, borderWidth: 2.5, spanGaps: 15 * 60_000, tension: 0 },
            ...(networkEkfReady
              ? [{
                  label: "EKF Predicted",
                  data: networkIndexes.map(index => index == null ? null : networkEkf.predicted[index]),
                  color: "#e2e8f0",
                  dashed: true,
                  fill: false,
                  borderWidth: 2,
                  spanGaps: 15 * 60_000,
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
      const suggestedMax = index === 1 ? Math.ceil(Math.max(maximum, SOLAR_WIND_SPEED_SCALE[3].boundary + 50) / 20) * 20
        : index === 2 ? -suggestedMin : index === 3 ? 50
        : index === 4 ? Math.max(50, Math.ceil(maximum / 25) * 25)
        : Math.max(10, Math.ceil(maximum / 10) * 10 + 5);
      return <div key={panel.title} style={{ marginTop: "1rem" }}>
        {isNetworkMean && <EquatorialElectricFieldChart domain={domain} selectedTime={selectedTime} pick={pick} reportArea={plotLayout.reporters.electricField} />}
        {panel.title === "Relative VTEC difference" && <div style={{ marginBottom: "1.25rem" }}>
          <strong>Mean daily TEC — northern, central and southern Zimbabwe</strong>
          <ZimbabweMeanDiurnalTec embedded analysisDomain={domain} analysisDay={endDay} analysisRows={days === 30 ? (loading ? null : rows) : undefined} onPlotAreaChange={plotLayout.reporters.regionalTec} />
        </div>}
        <strong>{panel.title}</strong> · {reading ? `${reading.value!.toFixed(1)} ${panel.unit.match(/\((.*)\)/)?.[1] ?? ""} at ${new Date(reading.time).toISOString()}` : "No observation near the marker"}
        {isNetworkMean && sorted.length > 0 && <p style={{ fontSize: ".8rem" }}>
          Latest observed UTC bin {new Date(sorted[sorted.length - 1].time).toISOString().slice(0, 16).replace("T", " ")}. Incoming readings are added automatically.
        </p>}
        {panel.plot === "delta" && <p style={{ fontSize: ".8rem" }}>
          {referenceDay ? `Single-day override · ${referenceDay} UTC`
            : quietDays.length ? `Quiet reference dates (UTC) · ${quietDays.join(", ")}`
              : "Five-day quiet reference pending."}
        </p>}
        <LineChart labels={sorted.map(point => new Date(point.time).toISOString())} xValues={sorted.map(point => point.time)} epochMs={sorted.map(point => point.time)}
          datasets={datasets}
          yLabel={panel.unit} yAxisWidth={80} height={isNetworkMean ? 320 : 360}
          ySuggestedMin={suggestedMin} ySuggestedMax={suggestedMax} yMin={index === 3 ? 0 : undefined}
          preserveSamples pointRadius={index === 0 ? 2 : 0}
          thresholds={panel.plot === "speed" ? SOLAR_WIND_SPEED_GUIDES
            : index === 4 ? [{ value: 25, label: "+25% guide", color: "#f87171" }, { value: -25, label: "−25% guide", color: "#f87171" }]
            : index === 0 || index === 2 ? [{ value: 0, label: "Zero", color: "#64748b" }] : undefined}
          onPlotAreaChange={plotLayout.reporters[panel.plot]}
          onPickTime={pick} {...utcTimeAxisProps(domain)} />
      </div>;
    })}
    <AnalysisMarker layout={plotLayout} domain={domain} selectedTime={selectedTime}
      flarePeaks={flarePeaks} selectedFlare={selectedFlare} pick={pick} />
    </div>
    <p>ΔVTEC = 100 × (observed − quiet reference) / quiet reference. The default uses the analysis end month and ranks completed days with station data by GFZ daily Ap. Each UTC quarter-hour requires measurements from all five reference days, weighted equally. The ±25% guides follow <a href="https://doi.org/10.5140/JASS.2026.43.2.93" target="_blank" rel="noreferrer">Guibula et al. (2026)</a>.</p>
  </section>;
}

const FIELD_COMPONENTS = [
  { label: "Quiet", key: "quiet", color: "#60a5fa" },
  { label: "Prompt penetration", key: "penetration", color: "#f87171" },
  { label: "Quiet + penetration", key: "total", color: "#22c55e" },
] as const;
const FIELD_SOURCE = "https://geomag.colorado.edu/online-calculators/real-time-model-ionospheric-electric-fields";

function EquatorialElectricFieldChart({ domain, selectedTime, pick, reportArea }: {
  domain: { min: number; max: number };
  selectedTime: number;
  pick: (time: number) => void;
  reportArea: PlotAreaReporter;
}) {
  const { min, max } = domain;
  const [points, setPoints] = useState<EquatorialElectricFieldPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "complete" | "partial">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setPoints([]);
    setStatus("loading");
    const dayMs = 86_400_000;
    const load = async () => {
      const merged = new Map<string, EquatorialElectricFieldPoint>();
      let incomplete = false;
      for (let end = max; active && end > min;) {
        const start = Math.max(min, end - 5 * dayMs);
        const date = new Date(start).toISOString().slice(0, 10);
        const result = await getEquatorialElectricField(date, (end - start) / dayMs).catch(() => null);
        if (!active) return;
        const rows = (result?.points ?? []).filter(point => {
          const time = Date.parse(point.time);
          return time >= start && time < end && (point.climatological_mvm != null || point.prompt_penetration_mvm != null);
        });
        incomplete ||= !rows.length || result?.note != null;
        for (const row of rows) merged.set(row.time, row);
        if (rows.length) setPoints([...merged.values()].sort((a, b) => a.time.localeCompare(b.time)));
        end = start;
      }
      if (active) setStatus(incomplete ? "partial" : "complete");
    };
    void load();
    return () => { active = false; };
  }, [min, max, retry]);

  const rows = useMemo(() => points.map(point => {
    const quiet = point.climatological_mvm;
    const penetration = point.prompt_penetration_mvm;
    return { time: Date.parse(point.time), quiet, penetration, total: quiet != null && penetration != null ? quiet + penetration : null };
  }).filter(row => row.time >= min && row.time < max), [points, min, max]);
  const times = useMemo(() => rows.map(row => row.time), [rows]);
  const labels = useMemo(() => rows.map(row => new Date(row.time).toISOString()), [rows]);
  const datasets = useMemo(() => FIELD_COMPONENTS.map(component => ({
    label: component.label, color: component.color, data: rows.map(row => row[component.key]), spanGaps: 5 * 60_000, tension: 0,
  })), [rows]);
  const selected = FIELD_COMPONENTS.flatMap(component => {
    const reading = nearestReading(rows.map(row => ({ time: row.time, value: row[component.key] })), selectedTime, 5 * 60_000);
    return reading?.value != null ? [`${component.label} ${reading.value.toFixed(3)} mV/m`] : [];
  });

  return <section aria-label="Equatorial eastward electric field" style={{ marginBottom: "1.25rem" }}>
    <h3>Equatorial eastward electric field</h3>
    <p style={{ fontSize: ".8rem" }}>PPEFM model estimates at 28°E on the magnetic equator. {selected.length ? `Near the marker · ${selected.join(" · ")}` : "No model value near the marker."}</p>
    {status === "loading" && <p role="status">Loading Colorado electric-field model output…</p>}
    {status === "partial" && <p role="status">{rows.length ? "Some model output is unavailable for this window." : "The provider returned no usable model output for this window."} <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {rows.length > 0 && <LineChart labels={labels} xValues={times} epochMs={times} datasets={datasets}
      yLabel="Electric field (mV/m)" yAxisWidth={80} height={320} ySuggestedMin={-1.5} ySuggestedMax={1.5}
      preserveSamples pointRadius={0} onPickTime={pick} onPlotAreaChange={reportArea} {...utcTimeAxisProps(domain)} />}
    <p style={{ fontSize: ".8rem" }}><a href={FIELD_SOURCE} target="_blank" rel="noreferrer">University of Colorado equatorial electric-field model</a></p>
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
