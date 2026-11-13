"use client";

import { useEffect, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import { getComparisonDrivers, type ComparisonDriversResponse } from "@/lib/api";
import { xrayFluxColor } from "@/lib/solarEventColors";

type Request = { start: string; end: string; revision: number };
type Field = { key: string; label: string; color: string; axis?: "y" | "y2" | "y3" };
const PANELS: { title: string; yLabel: string; fields: Field[]; explanation: string }[] = [
  {
    title: "GOES X-ray flux", yLabel: "X-ray flux (W/m²)",
    fields: [
      { key: "goes_xray_long", label: "0.1–0.8 nm (long)", color: "#f59e0b" },
      { key: "goes_xray_short", label: "0.05–0.4 nm (short)", color: "#a78bfa" },
    ],
    explanation: "The long-wave GOES band defines the operational solar-flare class; the short-wave band is shown for comparison. Missing samples indicate unavailable source coverage, not zero flux.",
  },
  {
    title: "Energetic proton flux", yLabel: "Proton flux (pfu)",
    fields: [
      { key: "goes_p10", label: "GOES ≥10 MeV", color: "#38bdf8" },
      { key: "goes_p50", label: "GOES ≥50 MeV", color: "#a78bfa" },
      { key: "goes_p100", label: "GOES ≥100 MeV", color: "#f97316" },
      { key: "goes_p500", label: "GOES ≥500 MeV", color: "#ef4444" },
      { key: "omni_p10", label: "OMNI >10 MeV", color: "#22d3ee" },
      { key: "omni_p30", label: "OMNI >30 MeV", color: "#eab308" },
      { key: "omni_p60", label: "OMNI >60 MeV", color: "#f472b6" },
    ],
    explanation: "Compare event onset and energy channels. GOES channels and OMNI archive channels have different energy thresholds and are labelled separately. A missing channel is not zero flux. OMNI's published proton archive ends in March 2020; newer GOES values require stored or recent NOAA observations.",
  },
  {
    title: "Interplanetary magnetic field", yLabel: "IMF (nT)",
    fields: [
      { key: "bt", label: "Bt", color: "#ffffff" },
      { key: "by", label: "GSM By", color: "#38bdf8" },
      { key: "bz", label: "GSM Bz", color: "#ef4444" },
    ],
    explanation: "Sustained southward Bz can favour solar-wind coupling to the magnetosphere. NASA OMNI hourly fields are shifted towards magnetospheric arrival; NOAA RTSW values describe the upstream field. Their time stamps and averaging differ, so they are separate lines.",
  },
  {
    title: "Solar wind", yLabel: "Speed (km/s)",
    fields: [
      { key: "speed", label: "Speed", color: "#eab308", axis: "y" },
      { key: "density", label: "Density", color: "#38bdf8", axis: "y2" },
      { key: "temperature", label: "Proton temperature", color: "#f97316", axis: "y3" },
    ],
    explanation: "Read speed, density and proton temperature together, then compare with IMF Bz and the geomagnetic indices below. Each quantity has its own labelled axis. Elevated speed alone does not establish a geomagnetic storm or a local positioning impact.",
  },
];

PANELS.push({
  title: "Dst — ring current", yLabel: "Dst (nT)",
  fields: [{ key: "dst", label: "Dst", color: "#38bdf8" }],
  explanation: "Hourly Dst describes the storm-time ring current. Compare negative excursions with IMF Bz, solar-wind changes and local TEC timing. This is Dst, not minute-resolution SYM-H; missing hours remain gaps.",
});

const FLARE_THRESHOLDS = [
  { value: 1e-8, label: "A", color: "#94a3b8" },
  { value: 1e-7, label: "B", color: "#38bdf8" },
  { value: 1e-6, label: "C", color: "#f97316" },
  { value: 1e-5, label: "M", color: "#ef4444" },
  { value: 1e-4, label: "X", color: "#a855f7" },
];

function flareClass(flux: number | undefined): string | null {
  if (flux == null || !Number.isFinite(flux) || flux <= 0) return null;
  if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
  if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
  if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
  if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
  return `A${Math.max(flux / 1e-8, 0.1).toFixed(1)}`;
}

function flareTick(value: number): string {
  const classes: Array<[number, string]> = [
    [1e-8, "A"], [1e-7, "B"], [1e-6, "C"], [1e-5, "M"], [1e-4, "X"], [1e-3, "X+"],
  ];
  for (const [threshold, label] of classes) {
    if (value / threshold > 0.85 && value / threshold < 1.15) return label;
  }
  return "";
}

export default function ComparisonDriverCharts({ request }: { request: Request | null }) {
  const [data, setData] = useState<ComparisonDriversResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!request) return;
    let active = true;
    setLoading(true);
    setData(null);
    setError(null);
    getComparisonDrivers(request.start, request.end)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError("The selected heliospheric observations could not load. Retry or choose another interval."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, retry]);

  if (!request) return null;
  const min = Date.parse(`${request.start}T00:00:00Z`);
  const max = Date.parse(`${request.end}T00:00:00Z`) + 86400000;
  const rows = (data?.rows ?? []).filter(row => {
    const stamp = Date.parse(row.time);
    return Number.isFinite(stamp) && stamp >= min && stamp < max;
  });
  // Shared UTC coordinates keep all three panels aligned, without joining
  // upstream minute samples to shifted OMNI hourly values in a single line.
  const stamps = [...new Set(rows.map(row => row.time))].sort();
  const epochs = stamps.map(stamp => Date.parse(stamp));
  const grouped = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const row of rows) {
    const group = row.source.startsWith("NASA") ? "OMNI hourly" : "NOAA / stored";
    if (!grouped.has(group)) grouped.set(group, new Map());
    const bucket = grouped.get(group)!;
    bucket.set(row.time, { ...bucket.get(row.time), ...row });
  }

  return <section aria-label="Selected-date heliospheric comparison" style={{ display: "grid", gap: "1rem", marginBottom: "1rem" }}>
    <div className="banner banner-info">
      <strong>Solar and interplanetary drivers · {request.start} to {request.end} UTC</strong>
      <div>NOAA recent/stored samples and NASA OMNI hourly observations. All three graphs use the same selected dates; unreleased or missing observations remain gaps.</div>
    </div>
    {loading && <div className="banner banner-info" role="status">Loading GOES X-ray, proton, IMF and solar-wind observations for the selected dates…</div>}
    {error && <div className="banner banner-warn" role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry driver graphs</button></div>}
    {data?.notes.map(note => <div className="banner banner-warn" key={note}>{note}</div>)}
    {PANELS.map(panel => {
      const datasets = [...grouped].flatMap(([group, samples]) => panel.fields.map(field => ({
        label: `${field.label} · ${group}`,
        data: stamps.map(stamp => {
          const value = samples.get(stamp)?.[field.key];
          return typeof value === "number" && Number.isFinite(value) ? value : null;
        }),
        color: field.key === "goes_xray_long" ? undefined : field.color,
        valueColor: field.key === "goes_xray_long" ? xrayFluxColor : undefined,
        yAxisId: field.axis ?? "y" as const,
        dashed: group === "OMNI hourly", tension: 0,
        spanGaps: (group === "OMNI hourly" ? 90 : 30) * 60000,
      })).filter(dataset => dataset.data.some(value => value !== null)));
      const xrayClasses = panel.title === "GOES X-ray flux"
        ? stamps.map(stamp => {
          const flux = [...grouped.values()]
            .map(samples => samples.get(stamp)?.goes_xray_long)
            .find((value): value is number => typeof value === "number" && Number.isFinite(value));
          return flareClass(flux);
        })
        : undefined;
      return <div className="card" key={panel.title} style={{ minWidth: 0 }}>
        <h3 style={{ margin: "0 0 0.5rem", color: "#fff" }}>{panel.title}</h3>
        {datasets.length > 0 ? <LineChart
          labels={stamps} xValues={epochs} epochMs={epochs} datasets={datasets}
          xMin={min} xMax={max} xLabel="UTC" height={240} toggleableLegend preserveSamples
          formatXTick={ms => new Date(ms).toISOString().slice(0, 16).replace("T", " ")}
          yLabel={panel.yLabel}
          yLogScale={panel.title === "GOES X-ray flux"}
          yMin={panel.title === "GOES X-ray flux" ? 1e-9 : undefined}
          yMax={panel.title === "GOES X-ray flux" ? 1e-3 : undefined}
          formatYTick={panel.title === "GOES X-ray flux" ? flareTick : undefined}
          thresholds={panel.title === "GOES X-ray flux" ? FLARE_THRESHOLDS : undefined}
          tooltipDetails={xrayClasses}
          tooltipDetailLabel="GOES class"
          threshold={panel.title === "Solar wind" ? { value: 500, label: "Fast stream (500 km/s)", color: "#f97316", fillAbove: true } : undefined}
          secondaryYLabel={panel.title === "Solar wind" ? "Density (cm⁻³)" : undefined}
          tertiaryYLabel={panel.title === "Solar wind" ? "Proton temperature (K)" : undefined}
        /> : <p role="status">{loading ? "Checking source coverage…" : "No valid observations returned for this graph in the selected date range."}</p>}
        <details style={{ color: "#fff", marginTop: "0.75rem" }}>
          <summary>What does this graph mean?</summary>
          <p>{panel.explanation}</p>
        </details>
      </div>;
    })}
    <a href="https://omniweb.gsfc.nasa.gov/html/ow_data.html" target="_blank" rel="noreferrer">Source definitions, cadence and coverage — NASA OMNI</a>
  </section>;
}
