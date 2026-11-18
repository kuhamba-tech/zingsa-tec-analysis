"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getHeliosphericMonitor, getLiveVtecByStation } from "@/lib/api";
import { peekHeliosphericMonitor } from "@/lib/heliosphericStore";
import type { GoesXrayRange } from "@/components/spaceWeather/GoesSolarXrayCard";
import { loadLineChart } from "@/lib/loadLineChart";
import type { GoesXrayTimelinePoint } from "@/lib/types";
import { seriesEpochsFromApi, utcTimeAxisProps } from "@/lib/chartTimeAxis";
import { startVisiblePolling } from "@/lib/visiblePolling";
import { runMeanVtecEkf } from "@/lib/meanVtecEkf";
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
const ZimbabweMeanDiurnalTec = dynamic(() => import("@/components/charts/ZimbabweMeanDiurnalTec"), { ssr: false });
const PROTON_COLORS: Record<string, string> = {
  ">=10 MeV": "#38bdf8",
  ">=50 MeV": "#a78bfa",
  ">=100 MeV": "#f97316",
  ">=500 MeV": "#ef4444",
};
const points = (times: string[], values: (number | null)[]): AnalysisPoint[] => times.map((time, index) => ({ time: Date.parse(time), value: values[index] ?? null })).filter(point => Number.isFinite(point.time));

export default function StormAnalysis({
  xrayTimeline,
  fallbackXraySeries,
  fallbackXrayUpdated,
  xrayRange,
  onXrayRangeChange,
}: {
  xrayTimeline: GoesXrayTimelinePoint[];
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
  const dragging = useRef(false);
  const [plotAreas, setPlotAreas] = useState<Record<number, { left: number; right: number; top: number; bottom: number }>>({});
  const reportArea = useCallback((index: number, area: { left: number; right: number; top: number; bottom: number }) => {
    const rect = stackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = { left: area.left - rect.left, right: area.right - rect.left, top: area.top - rect.top, bottom: area.bottom - rect.top };
    setPlotAreas(current => {
      const previous = current[index];
      return previous && Object.keys(next).every(key => Math.abs(next[key as keyof typeof next] - previous[key as keyof typeof next]) < .5) ? current : { ...current, [index]: next };
    });
  }, []);
  const reportFirst = useCallback((area: { left: number; right: number; top: number; bottom: number }) => reportArea(0, area), [reportArea]);
  const reportXray = useCallback((area: { left: number; right: number; top: number; bottom: number }) => reportArea(-1, area), [reportArea]);
  const reportLast = useCallback((area: { left: number; right: number; top: number; bottom: number }) => reportArea(4, area), [reportArea]);
  const domain = useMemo(() => {
    const max = Date.parse(`${endDay}T00:00:00Z`) + 86400000;
    return { min: max - days * 86400000, max };
  }, [endDay, days]);
  const selectedTime = Math.max(domain.min, Math.min(domain.max, picked ?? Date.now()));
  const pick = (time: number) => setPicked(Math.round(time / 60000) * 60000);
  const moveMarker = (clientX: number) => {
    const rect = stackRef.current?.getBoundingClientRect(), area = plotAreas[0];
    if (!rect || !area || area.right <= area.left) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left - area.left) / (area.right - area.left)));
    pick(domain.min + fraction * (domain.max - domain.min));
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
    { title: "Dst", unit: "Dst (nT)", color: "#f8fafc", tolerance: 35 * 60000, cadence: 65 * 60000, data: points(helio?.dst?.times ?? [], helio?.dst?.dst ?? []) },
    { title: "Solar wind speed", unit: "Vsw (km/s)", color: "#3b82f6", tolerance: 10 * 60000, cadence: 10 * 60000, data: points(helio?.solar_wind.times ?? [], helio?.solar_wind.speed ?? []) },
    { title: "IMF Bz (GSM)", unit: "Bz (nT)", color: "#f8fafc", tolerance: 10 * 60000, cadence: 10 * 60000, data: points(helio?.imf.times ?? [], helio?.imf.bz ?? []) },
    { title: "Network mean VTEC", unit: "VTEC (TECU)", color: "#00ff88", tolerance: 8 * 60000, cadence: 20 * 60000, data: networkMean },
    { title: "Relative VTEC difference", unit: "ΔVTEC (%)", color: "#f8fafc", tolerance: 8 * 60000, cadence: 20 * 60000, data: measurements.map(point => ({ time: point.time, value: point.delta })) },
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
    <p>Drag the continuous pink line or its arrow to move the marker through all nine shared-timeline plots. Click a plot to select a time, or focus the line and use the arrow keys. The regional daily TEC chart uses the same Analysis UTC axis for its selected day. The marker is an analysis time, not a detected sudden storm commencement.</p>
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
      onPlotAreaChange={reportXray}
      onPickTime={pick}
    />
    {helio && <SolarWindBzComparison data={helio} analysisDomain={domain} selectedTime={selectedTime} onPickTime={pick} />}
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
          onPickTime={pick}
          {...utcTimeAxisProps(domain, { majorHours: 3 })}
        />
      </> : <p role="status">{helio.protons.labels.length === 0
        ? "Proton flux unavailable. NOAA has not returned recent or cached observations."
        : "Proton flux timestamps could not be aligned to UTC; the chart is omitted."}</p>}
    </section>}
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
          <ZimbabweMeanDiurnalTec embedded analysisDomain={domain} analysisDay={endDay} />
        </div>}
        <strong>{panel.title}</strong> · {reading ? `${reading.value!.toFixed(1)} ${panel.unit.match(/\((.*)\)/)?.[1] ?? ""} at ${new Date(reading.time).toISOString()}` : "No observation near the marker"}
        <LineChart labels={sorted.map(point => new Date(point.time).toISOString())} xValues={sorted.map(point => point.time)} epochMs={sorted.map(point => point.time)}
          datasets={datasets}
          yLabel={panel.unit} yAxisWidth={80} height={isNetworkMean ? 320 : 360}
          ySuggestedMin={suggestedMin} ySuggestedMax={suggestedMax} yMin={index === 3 ? 0 : undefined}
          preserveSamples pointRadius={index === 0 ? 2 : 0}
          thresholds={index === 4 ? [{ value: 25, label: "+25% guide", color: "#f87171" }, { value: -25, label: "−25% guide", color: "#f87171" }] : index === 0 || index === 2 ? [{ value: 0, label: "Zero", color: "#64748b" }] : undefined}
          onPlotAreaChange={index === 0 ? reportFirst : index === 4 ? reportLast : undefined}
          onPickTime={pick} {...utcTimeAxisProps(domain)} />
      </div>;
    })}
    {plotAreas[0] && plotAreas[4] && <div role="slider" tabIndex={0} aria-label="Drag pink analysis line" aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={selectedTime} aria-valuetext={new Date(selectedTime).toISOString()}
      onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => { if (dragging.current) moveMarker(event.clientX); }}
      onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { dragging.current = false; }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); pick(Math.max(domain.min, Math.min(domain.max, selectedTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1) * 60000))); }
      }}
      style={{ position: "absolute", left: plotAreas[0].left + (selectedTime - domain.min) / (domain.max - domain.min) * (plotAreas[0].right - plotAreas[0].left),
        top: plotAreas[-1]?.top ?? plotAreas[0].top, height: plotAreas[4].bottom - (plotAreas[-1]?.top ?? plotAreas[0].top) + 18, width: 28, transform: "translateX(-50%)", zIndex: 5, cursor: "ew-resize", touchAction: "none", color: "#ff00d4" }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: 13, width: 3, background: "#ff00d4" }} />
      <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: 6, width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "14px solid #ff00d4" }} />
      <span style={{ position: "absolute", top: "100%", left: 14, transform: "translateX(-50%)", fontWeight: 800, whiteSpace: "nowrap", fontSize: ".85rem", background: "var(--surface)" }}>
        Pick {new Date(selectedTime).toISOString().slice(5, 16).replace("T", " ")} UTC
      </span>
    </div>}
    </div>
    <p>ΔVTEC = 100 × (observed − reference) / reference, matched to the same station and UTC quarter-hour. Missing or zero reference values produce gaps. ±25% lines are comparison guides, not validated storm thresholds. No reference curve or historical storm values are invented. Solar-wind, Bz and Dst are limited to loaded NOAA source coverage. NOAA source fetched: {helio?.updated_utc ?? "unavailable"}.</p>
  </section>;
}
