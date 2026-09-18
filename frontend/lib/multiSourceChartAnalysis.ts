import type { KpDiffRow, SourceBundle } from "./multiSourceIndicesMerge";
import { fmt, kpComparison, unionDates } from "./multiSourceIndicesMerge";
import type { IntermagnetAnalysisResponse } from "./types";

export interface ChartAnalysisBlock {
  /** One-line plain-language summary under the chart title area */
  lead: string;
  bullets: string[];
}

type ChartLine = { id?: string; label: string; data: (number | null)[] };

function peakOnDates(dates: string[], data: (number | null)[]): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null;
  dates.forEach((date, i) => {
    const v = data[i];
    if (v === null || v === undefined) return;
    if (!best || v > best.value) best = { date, value: v };
  });
  return best;
}

function minOnDates(dates: string[], data: (number | null)[]): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null;
  dates.forEach((date, i) => {
    const v = data[i];
    if (v === null || v === undefined) return;
    if (!best || v < best.value) best = { date, value: v };
  });
  return best;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function kpStormClass(kp: number): string {
  if (kp >= 9) return "G5 extreme storm";
  if (kp >= 8) return "G4 severe storm";
  if (kp >= 7) return "G3 strong storm";
  if (kp >= 6) return "G2 moderate storm";
  if (kp >= 5) return "G1 minor storm";
  if (kp >= 4) return "active (below storm threshold)";
  return "quiet";
}

function cpStormClass(cp: number): string {
  if (cp >= 2.0) return "extreme geomagnetic disturbance";
  if (cp >= 1.5) return "strong storm conditions";
  if (cp >= 1.0) return "moderate storm conditions";
  if (cp >= 0.7) return "minor storm / highly disturbed";
  if (cp >= 0.4) return "active but not a storm day";
  return "quiet to unsettled";
}

function apStormNote(ap: number): string {
  if (ap >= 100) return "intense storm-level Ap";
  if (ap >= 50) return "storm-level Ap (≥ 50)";
  if (ap >= 30) return "disturbed but below classic storm threshold";
  return "sub-storm or quiet daily Ap";
}

function dstStormNote(dst: number): string {
  if (dst <= -200) return "intense ring-current storm";
  if (dst <= -100) return "moderate storm main phase";
  if (dst <= -50) return "weak storm / disturbed ring current";
  return "below typical storm threshold (−50 nT)";
}

function pairedDiff(dates: string[], a: (number | null)[], b: (number | null)[]): number[] {
  const out: number[] = [];
  dates.forEach((_, i) => {
    if (a[i] != null && b[i] != null) out.push(Math.abs(a[i]! - b[i]!));
  });
  return out;
}

const PRE_STORM_DAYS = 3;

function addCalendarDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function preStormRunUp(stormDate: string, daysBefore = PRE_STORM_DAYS): { date: string; dayLabel: string }[] {
  return Array.from({ length: daysBefore + 1 }, (_, i) => {
    const offset = daysBefore - i;
    const dayLabel =
      offset === 0 ? "storm day" : offset === 1 ? "1 day before" : offset === 2 ? "2 days before" : "3 days before";
    return { date: addCalendarDays(stormDate, -offset), dayLabel };
  });
}

function bundleDaySnapshot(bundle: SourceBundle, date: string) {
  const omni = bundle.omni?.series.find((r) => r.date === date);
  const celestrak = bundle.celestrak?.series.find((r) => r.date === date);
  const gfz = bundle.gfz?.series.find((r) => r.date === date);
  const kyoto = bundle.kyoto?.series.find((r) => r.date === date);
  const kps = [omni?.kp, celestrak?.kp, gfz?.kp, kyoto?.kp].filter((v): v is number => v != null);
  const dsts = [omni?.dst, kyoto?.dst].filter((v): v is number => v != null);
  return {
    kp: kps.length ? Math.max(...kps) : null,
    dst: dsts.length ? Math.min(...dsts) : null,
    ssn: omni?.ssn ?? celestrak?.ssn ?? null,
    f107: omni?.f107 ?? celestrak?.f107 ?? null,
    cp: gfz?.cp ?? null,
    ap: gfz?.ap_daily ?? gfz?.ap ?? celestrak?.ap ?? kyoto?.ap_daily ?? kyoto?.ap ?? null,
    mean_vtec: omni?.mean_vtec ?? null,
  };
}

function preStormSolarBullet(
  bundle: SourceBundle,
  kpPeak: { date: string; value: number },
  metric: "ssn" | "f107",
  metricLabel: string,
  formatVal: (v: number) => string,
  peakDate: string | null,
): string {
  const window = preStormRunUp(kpPeak.date);
  const nums = window.map(({ date }) => {
    const snap = bundleDaySnapshot(bundle, date);
    return metric === "ssn" ? snap.ssn : snap.f107;
  }).filter((v): v is number => v != null);
  const preStorm = nums.slice(0, -1);
  const preMean = mean(preStorm);
  const stormDayVal = nums[nums.length - 1];
  let note = "Elevated solar activity before the storm increases CME/flare risk; the storm itself is confirmed only when Kp ≥ 5 and Dst drops on the storm day.";
  if (preMean != null && stormDayVal != null) {
    if (preMean > stormDayVal + (metric === "ssn" ? 20 : 10)) {
      note = `Solar ${metricLabel} was higher in the 3 days before (${formatVal(preMean)} avg) than on the storm day (${formatVal(stormDayVal)}) — storms can arrive after the daily solar peak passes.${peakDate && peakDate !== kpPeak.date ? ` Overall ${metricLabel} peak was ${peakDate}.` : ""}`;
    } else if (preMean >= (metric === "ssn" ? 100 : 150)) {
      note = `${metricLabel} stayed high (${formatVal(preMean)} average over 3 days before) as Kp climbed — active Sun conditions preceded the geomagnetic hit at Earth.`;
    }
  }
  const chain = window.map(({ date, dayLabel }) => {
    const snap = bundleDaySnapshot(bundle, date);
    const v = metric === "ssn" ? snap.ssn : snap.f107;
    return `${date} ${v != null ? formatVal(v) : "n/a"}`;
  }).join(", ");
  return `3 days before storm (Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${chain}. ${note}`;
}

function preStormGeomagneticBullet(
  bundle: SourceBundle,
  kpPeak: { date: string; value: number },
  metric: "kp" | "dst" | "cp" | "ap",
): string | null {
  const window = preStormRunUp(kpPeak.date);
  const chain = window.map(({ date, dayLabel }) => {
    const snap = bundleDaySnapshot(bundle, date);
    const v =
      metric === "kp" ? snap.kp : metric === "dst" ? snap.dst : metric === "cp" ? snap.cp : snap.ap;
    if (v == null) return `${date} n/a`;
    if (metric === "kp") return `${date} Kp ${fmt(v)}`;
    if (metric === "dst") return `${date} Dst ${fmt(v, 0)} nT`;
    if (metric === "cp") return `${date} Cp ${fmt(v, 2)}`;
    return `${date} Ap ${fmt(v, 0)}`;
  }).join(", ");

  const kps = window.map(({ date }) => bundleDaySnapshot(bundle, date).kp).filter((v): v is number => v != null);
  if (metric === "kp" && kps.length >= 2) {
    const first = kps[0];
    const last = kps[kps.length - 1];
    const rise = last - first;
    return `3 days before storm (Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${chain}. Kp rose ${fmt(first)} → ${fmt(last)} (${rise >= 0 ? "+" : ""}${fmt(rise)} over 4 days) — ${last >= 5 ? "storm threshold crossed before or on the peak day." : "disturbance building toward storm level."}`;
  }
  if (metric === "dst") {
    const dsts = window.map(({ date }) => bundleDaySnapshot(bundle, date).dst).filter((v): v is number => v != null);
    if (dsts.length >= 2) {
      const minDst = Math.min(...dsts);
      return `3 days before storm (Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${chain}. Dst becomes more negative as the ring current strengthens — deepest in this window: ${fmt(minDst, 0)} nT.`;
    }
  }
  if (metric === "cp") {
    return `3 days before storm (Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${chain}. Cp > 1.0 on any of these dates confirms geomagnetic storm conditions at Earth.`;
  }
  if (metric === "ap") {
    return `3 days before storm (Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${chain}. Ap ≥ 50 on the storm day matches Kp ≥ 5 storm classification.`;
  }
  return null;
}

function preStormVtecBullet(
  bundle: SourceBundle,
  kpPeak: { date: string; value: number },
  vtecLabels: string[],
  networkVtec: (date: string) => number | null,
  quietMean: number | null,
): string | null {
  const window = preStormRunUp(kpPeak.date);
  const parts = window.map(({ date }) => {
    const vtec = networkVtec(date);
    const { kp, dst } = bundleDaySnapshot(bundle, date);
    const kpTxt = kp != null ? `Kp ${fmt(kp)}` : "Kp n/a";
    const dstTxt = dst != null ? `Dst ${fmt(dst, 0)} nT` : "Dst n/a";
    const vtecTxt = vtec != null ? `VTEC ${fmt(vtec, 2)} TECU` : "VTEC n/a";
    const vsQuiet =
      vtec != null && quietMean != null
        ? vtec - quietMean > 0.5
          ? ` (+${fmt(vtec - quietMean, 2)} vs quiet)`
          : ""
        : "";
    return `${date}: ${kpTxt}, ${dstTxt}, ${vtecTxt}${vsQuiet}`;
  });
  const vtecs = window.map(({ date }) => networkVtec(date)).filter((v): v is number => v != null);
  if (!vtecs.length) return null;
  const trend =
    vtecs.length >= 2 && vtecs[vtecs.length - 1] > vtecs[0] + 0.5
      ? "VTEC climbed in the 3 days before the peak Kp day — local ionosphere was already responding as the storm built."
      : vtecs[vtecs.length - 1] >= (quietMean ?? 0) + 0.5
        ? "VTEC stayed above quiet levels through the run-up and storm day."
        : "VTEC response may peak on a different day than maximum Kp — compare each date below.";
  return `3 days before storm (peak Kp ${fmt(kpPeak.value)} on ${kpPeak.date}): ${parts.join("; ")}. ${trend}`;
}

/** Highest daily Kp across all loaded sources — used to cross-link solar charts. */
export function globalKpPeak(bundle: SourceBundle, dates: string[]): { date: string; value: number } | null {
  const lines = kpComparison(bundle, dates);
  let best: { date: string; value: number } | null = null;
  for (const line of lines) {
    const p = peakOnDates(dates, line.data);
    if (p && (!best || p.value > best.value)) best = p;
  }
  return best;
}

function solarVsStormNote(
  bundle: SourceBundle,
  kpPeak: { date: string; value: number } | null,
  metric: "ssn" | "f107",
  metricLabel: string,
  formatVal: (v: number) => string,
  peakDate: string | null,
): string {
  if (!kpPeak || kpPeak.value < 5) {
    return "Compare timing with the Kp chart — Kp ≥ 5 (shaded columns) is where geomagnetic storms are confirmed at Earth.";
  }
  return preStormSolarBullet(bundle, kpPeak, metric, metricLabel, formatVal, peakDate);
}

export function analyzeKpChart(
  dates: string[],
  lines: ChartLine[],
  kpDiff: KpDiffRow[],
  stormDates: string[],
  bundle: SourceBundle,
  kpPeak: { date: string; value: number } | null,
): ChartAnalysisBlock {
  if (!dates.length || !lines.length) {
    return { lead: "", bullets: [] };
  }

  const bullets: string[] = [
    "Kp is the primary geomagnetic storm index. Daily maximum Kp ≥ 5 means a geomagnetic storm occurred (G1–G5). Red shaded columns mark storm days flagged by the data providers.",
  ];

  const peaks = lines
    .map((line) => ({ label: line.label, peak: peakOnDates(dates, line.data) }))
    .filter((p): p is { label: string; peak: { date: string; value: number } } => p.peak !== null);

  if (peaks.length) {
    const top = [...peaks].sort((a, b) => b.peak.value - a.peak.value)[0];
    bullets.push(
      `Strongest storm signal: Kp ${fmt(top.peak.value)} on ${top.peak.date} (${top.label}) — ${kpStormClass(top.peak.value)}. This is direct evidence of geomagnetic disturbance at Earth.`,
    );
  }

  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormGeomagneticBullet(bundle, kpPeak, "kp");
    if (runUp) bullets.push(runUp);
  }

  const stormInRange = stormDates.filter((d) => dates.includes(d));
  if (stormInRange.length) {
    bullets.push(
      `${stormInRange.length} storm day(s) in this range. Multiple sources (NASA, CelesTrak, GFZ Germany, WDC Kyoto Japan) let you verify the same event was recorded internationally.`,
    );
  } else {
    bullets.push("No day reached Kp ≥ 5 in this window — geomagnetic conditions stayed below official storm level.");
  }

  const spreads = kpDiff.map((r) => r.maxSpread).filter((v): v is number => v !== null);
  const spreadMean = mean(spreads);
  if (spreadMean !== null && spreadMean < 0.3) {
    bullets.push(`Sources agree closely (mean Kp spread ${fmt(spreadMean)}). GFZ and WDC Kyoto Kp should match on definitive archive dates.`);
  } else if (spreadMean !== null) {
    bullets.push(
      `Some same-day disagreement between sources (mean spread ${fmt(spreadMean)}). NASA/CelesTrak can differ from GFZ/Kyoto because of daily-max vs 3-hourly Kp aggregation.`,
    );
  }

  const lead = peaks.length
    ? `This chart shows geomagnetic storms directly. The highest Kp (${fmt(peaks.sort((a, b) => b.peak.value - a.peak.value)[0].peak.value)}) tells you how severe disturbances were at Earth.`
    : "Kp measures geomagnetic storm strength at Earth — look for values ≥ 5 and red shading.";

  return { lead, bullets };
}

export function analyzeF107Chart(
  dates: string[],
  lines: ChartLine[],
  kpPeak: { date: string; value: number } | null,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  if (!dates.length || !lines.length) {
    return { lead: "", bullets: [] };
  }

  const omni = lines.find((l) => l.label.includes("NASA")) ?? lines[0];
  const peak = peakOnDates(dates, omni.data);
  const vals = omni.data.filter((v): v is number => v !== null);

  const bullets: string[] = [
    "F10.7 measures solar radio flux — how active the Sun is. It does NOT by itself prove a geomagnetic storm. Storms are confirmed on the Kp, Dst, Ap, and Cp charts.",
    "High F10.7 raises long-term ionospheric background TEC over Zimbabwe. It can also mean sunspots and CMEs are more likely, which may lead to storms days later.",
  ];

  if (peak && vals.length) {
    bullets.push(
      `In your data: F10.7 peaked at ${fmt(peak.value, 1)} sfu on ${peak.date} (range ${fmt(Math.min(...vals), 1)}–${fmt(Math.max(...vals), 1)} sfu). Values above ~150 sfu indicate an active Sun.`,
    );
  }

  if (lines.length >= 2) {
    const m = mean(pairedDiff(dates, lines[0].data, lines[1].data));
    if (m !== null) {
      bullets.push(`NASA and CelesTrak agree within ${fmt(m, 1)} sfu on average — both track the same solar driver.`);
    }
  }

  bullets.push(solarVsStormNote(bundle, kpPeak, "f107", "F10.7", (v) => `${fmt(v, 1)} sfu`, peak?.date ?? null));

  const lead =
    "Solar flux chart — shows Sun activity, not Earth storms. Use it with Kp/Dst to connect solar drivers to geomagnetic events.";

  return { lead, bullets };
}

export function analyzeSsnChart(
  dates: string[],
  lines: ChartLine[],
  kpPeak: { date: string; value: number } | null,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  if (!dates.length || !lines.length) {
    return { lead: "", bullets: [] };
  }

  const vals = lines[0].data.filter((v): v is number => v !== null);
  const peak = peakOnDates(dates, lines[0].data);

  const bullets: string[] = [
    "Sunspot number (SSN) counts active regions on the Sun. Like F10.7, it is a solar-cycle index — it describes how active the Sun is over weeks and months, not whether a storm hit Earth today.",
    "More sunspots mean a higher chance of flares and coronal mass ejections (CMEs), which can cause geomagnetic storms when they reach Earth.",
  ];

  if (peak && vals.length) {
    bullets.push(
      `In your data: SSN peaked at ${fmt(peak.value, 0)} on ${peak.date}; average ${fmt(mean(vals), 0)} over the range. Elevated SSN supports higher baseline TEC in your CORS archive.`,
    );
  }

  if (lines.length >= 2) {
    const m = mean(pairedDiff(dates, lines[0].data, lines[1].data));
    if (m !== null && m < 1) {
      bullets.push("NASA and CelesTrak sunspot numbers match — both providers report the same international sunspot count.");
    }
  }

  bullets.push(solarVsStormNote(bundle, kpPeak, "ssn", "SSN", (v) => fmt(v, 0), peak?.date ?? null));

  return {
    lead: "Sunspot chart — solar activity proxy. Storm proof is on Kp (≥ 5) and Dst/Cp panels, not here.",
    bullets,
  };
}

export function analyzeApChart(
  dates: string[],
  lines: ChartLine[],
  kpPeak: { date: string; value: number } | null,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  if (!dates.length || !lines.length) {
    return { lead: "", bullets: [] };
  }

  const bullets: string[] = [
    "Ap is a daily geomagnetic activity index derived from Kp. Ap ≥ 50 indicates storm-level disturbance (similar information to Kp ≥ 5).",
    "This chart compares how CelesTrak, GFZ (Germany), and WDC Kyoto (Japan) report planetary Ap.",
  ];

  for (const line of lines) {
    const peak = peakOnDates(dates, line.data);
    if (peak) {
      bullets.push(
        `${line.label}: highest Ap ${fmt(peak.value, 0)} on ${peak.date} — ${apStormNote(peak.value)}.`,
      );
    }
  }

  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormGeomagneticBullet(bundle, kpPeak, "ap");
    if (runUp) bullets.push(runUp);
  } else if (kpPeak) {
    bullets.push(
      `Cross-check: main Kp storm was ${fmt(kpPeak.value)} on ${kpPeak.date}. Ap peaks on or near that date confirm the same geomagnetic event.`,
    );
  }

  return {
    lead: "Ap chart — geomagnetic storm indicator (daily). High Ap spikes mean Earth’s magnetic field was strongly disturbed.",
    bullets,
  };
}

export function analyzeDstChart(
  dates: string[],
  lines: ChartLine[],
  kpPeak: { date: string; value: number } | null,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  if (!dates.length || !lines.length) {
    return { lead: "", bullets: [] };
  }

  const bullets: string[] = [
    "Dst measures the ring current around Earth (in nanoTesla, nT). More negative Dst = stronger geomagnetic storm main phase. Dst ≤ −50 nT is a common storm threshold.",
    "WDC Kyoto (Japan) is the authoritative Dst source; NASA OMNIWeb redistributes Dst for comparison.",
  ];

  for (const line of lines) {
    const trough = minOnDates(dates, line.data);
    if (trough) {
      bullets.push(
        `${line.label}: deepest Dst ${fmt(trough.value, 0)} nT on ${trough.date} — ${dstStormNote(trough.value)}.`,
      );
    }
  }

  if (lines.length >= 2) {
    const m = mean(pairedDiff(dates, lines[0].data, lines[1].data));
    if (m !== null) {
      bullets.push(`NASA vs Kyoto mean |difference| ${fmt(m, 0)} nT — small gaps are normal resampling differences; large gaps may mean provisional vs final Dst.`);
    }
  }

  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormGeomagneticBullet(bundle, kpPeak, "dst");
    if (runUp) bullets.push(runUp);
  } else if (kpPeak) {
    bullets.push(
      `When Kp reached ${fmt(kpPeak.value)} on ${kpPeak.date}, Dst should show a strong negative excursion on the same or adjacent days — together they confirm a major storm.`,
    );
  }

  return {
    lead: "Dst chart — direct storm intensity at Earth. Look for sharp negative dips during storm days.",
    bullets,
  };
}

export function analyzeCpChart(
  dates: string[],
  data: (number | null)[],
  kpPeak: { date: string; value: number } | null,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  const peak = peakOnDates(dates, data);
  const vals = data.filter((v): v is number => v !== null);
  if (!peak || !vals.length) {
    return { lead: "", bullets: [] };
  }

  const bullets: string[] = [
    "Cp is GFZ’s daily planetary geomagnetic character index (0 = quiet, up to ~2.5 = extremely disturbed). Unlike F10.7 or sunspots, Cp directly summarises geomagnetic storm activity.",
    "Cp > 1.0 usually means a storm day; Cp > 2.0 indicates an extreme event. It tracks the same storms as Kp/Ap in one daily number.",
    `In your data: Cp peaked at ${fmt(peak.value, 2)} on ${peak.date} — ${cpStormClass(peak.value)}. Most other days stayed below ~1.0 (quiet to active).`,
  ];

  if (peak.value >= 1.0) {
    bullets.push(
      `The spike on ${peak.date} is clear storm evidence. Compare with the Kp chart — both should peak in the same week when a major CME-driven storm arrives.`,
    );
  }

  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormGeomagneticBullet(bundle, kpPeak, "cp");
    if (runUp) bullets.push(runUp);
  } else if (kpPeak) {
    const sameWeek =
      peak.date.slice(0, 7) === kpPeak.date.slice(0, 7) ||
      Math.abs(new Date(peak.date).getTime() - new Date(kpPeak.date).getTime()) < 4 * 86400000;
    if (sameWeek) {
      bullets.push(
        `Confirmed: Kp ${fmt(kpPeak.value)} on ${kpPeak.date} and Cp ${fmt(peak.value, 2)} on ${peak.date} describe the same geomagnetic storm from two independent official indices.`,
      );
    }
  }

  return {
    lead: "Cp chart — yes, this shows geomagnetic storms. High spikes = disturbed Earth magnetic field, not just an active Sun.",
    bullets,
  };
}

export function analyzeVtecStormOverlay(
  bundle: SourceBundle,
  stormDates: string[],
  vtecLabels: string[],
  kpPeak: { date: string; value: number } | null,
  vtecDatasets: { label: string; data: number[] }[] = [],
): ChartAnalysisBlock {
  if (!vtecLabels.length) {
    return { lead: "", bullets: [] };
  }

  const bullets: string[] = [
    "Red shaded columns mark days when Kp ≥ 5 or Dst ≤ −50 nT was recorded by at least one provider. Below we compare Zimbabwe CORS VTEC on those same calendar dates with the Kp and Dst values recorded that day.",
  ];

  const stormSet = new Set(stormDates);
  const quietDates = vtecLabels.filter((d) => !stormSet.has(d));

  const networkVtec = (date: string): number | null => {
    const idx = vtecLabels.indexOf(date);
    if (idx < 0) return null;
    const vals = vtecDatasets
      .map((ds) => ds.data[idx])
      .filter((v): v is number => v != null && !Number.isNaN(v));
    if (vals.length) return mean(vals);
    const omniRow = bundle.omni?.series.find((r) => r.date === date);
    return omniRow?.mean_vtec ?? null;
  };

  const indicesOnDate = (date: string): { kp: number | null; dst: number | null; stormClass: string | null } => {
    const kps = [
      bundle.omni?.series.find((r) => r.date === date)?.kp,
      bundle.celestrak?.series.find((r) => r.date === date)?.kp,
      bundle.gfz?.series.find((r) => r.date === date)?.kp,
      bundle.kyoto?.series.find((r) => r.date === date)?.kp,
    ].filter((v): v is number => v != null);
    const dsts = [
      bundle.omni?.series.find((r) => r.date === date)?.dst,
      bundle.kyoto?.series.find((r) => r.date === date)?.dst,
    ].filter((v): v is number => v != null);
    const omni = bundle.omni?.series.find((r) => r.date === date);
    return {
      kp: kps.length ? Math.max(...kps) : null,
      dst: dsts.length ? Math.min(...dsts) : null,
      stormClass: omni?.storm_class ?? bundle.kyoto?.series.find((r) => r.date === date)?.storm_class ?? null,
    };
  };

  const quietVtec = quietDates.map(networkVtec).filter((v): v is number => v != null);
  const quietMean = mean(quietVtec);

  type StormCompare = {
    date: string;
    vtec: number;
    kp: number | null;
    dst: number | null;
    delta: number | null;
    elevated: boolean;
  };

  const stormCompares: StormCompare[] = stormDates
    .filter((d) => vtecLabels.includes(d))
    .map((date) => {
      const vtec = networkVtec(date);
      if (vtec == null) return null;
      const { kp, dst } = indicesOnDate(date);
      const delta = quietMean != null ? vtec - quietMean : null;
      return {
        date,
        vtec,
        kp,
        dst,
        delta,
        elevated: delta != null && delta > 0.5,
      };
    })
    .filter((r): r is StormCompare => r !== null);

  if (!stormCompares.length) {
    if (stormDates.length) {
      bullets.push("Storm days occurred in this period but no VTEC archive points overlap those dates — widen the TEC date range.");
    }
    if (kpPeak && kpPeak.value >= 5) {
      const runUp = preStormVtecBullet(bundle, kpPeak, vtecLabels, networkVtec, quietMean);
      if (runUp) bullets.unshift(runUp);
    }
    return {
      lead: "VTEC vs storms — compare local ionosphere response with Kp/Dst on the same day.",
      bullets,
    };
  }

  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormVtecBullet(bundle, kpPeak, vtecLabels, networkVtec, quietMean);
    if (runUp) bullets.unshift(runUp);
  }

  const elevatedCount = stormCompares.filter((r) => r.elevated).length;
  const stormMean = mean(stormCompares.map((r) => r.vtec));

  if (quietMean != null && stormMean != null) {
    const delta = stormMean - quietMean;
    const pct = quietMean > 0 ? ((delta / quietMean) * 100).toFixed(0) : null;
    bullets.push(
      `Overall: mean VTEC ${fmt(stormMean, 2)} TECU on ${stormCompares.length} storm day(s) vs ${fmt(quietMean, 2)} TECU on quiet days (${delta >= 0 ? "+" : ""}${fmt(delta, 2)} TECU${pct ? `, ~${pct}%` : ""}). ${elevatedCount} of ${stormCompares.length} storm day(s) show VTEC above the quiet-day average — ${elevatedCount >= stormCompares.length * 0.5 ? "VTEC is responding to geomagnetic forcing in this archive." : "some storm days show weak or delayed VTEC response (ionosphere can lag Kp by hours or respond to solar flux instead)."}`,
    );
  }

  const topByKp = [...stormCompares]
    .filter((r) => r.kp != null)
    .sort((a, b) => (b.kp ?? 0) - (a.kp ?? 0))
    .slice(0, 4);

  if (topByKp.length) {
    bullets.push("Same-day Kp / Dst vs VTEC on the strongest storm dates:");
    for (const row of topByKp) {
      const kpPart = row.kp != null ? `Kp ${fmt(row.kp)} (${kpStormClass(row.kp)})` : "Kp n/a";
      const dstPart = row.dst != null ? `Dst ${fmt(row.dst, 0)} nT (${dstStormNote(row.dst)})` : "Dst n/a";
      const vtecPart = `VTEC ${fmt(row.vtec, 2)} TECU`;
      const vsQuiet =
        row.delta != null
          ? row.delta > 0.5
            ? ` — ${fmt(row.delta, 2)} TECU above quiet average; ionosphere disturbed`
            : row.delta < -0.5
              ? ` — ${fmt(Math.abs(row.delta), 2)} TECU below quiet average; storm recorded but weak local TEC uplift`
              : " — near quiet-day average; storm confirmed by Kp/Dst, modest TEC change"
          : "";
      bullets.push(`${row.date}: ${kpPart}, ${dstPart}, ${vtecPart}${vsQuiet}.`);
    }
  }

  const weakResponse = stormCompares.filter((r) => r.kp != null && r.kp >= 5 && !r.elevated);
  if (weakResponse.length && weakResponse.length < stormCompares.length) {
    bullets.push(
      `${weakResponse.length} storm day(s) had Kp ≥ 5 but VTEC stayed near or below quiet levels (e.g. ${weakResponse.slice(0, 2).map((r) => r.date).join(", ")}) — storms are still valid from Kp/Dst; TEC over Zimbabwe does not always spike on every storm day.`,
    );
  }

  const highVtecStorm = [...stormCompares].sort((a, b) => (b.vtec ?? 0) - (a.vtec ?? 0))[0];
  if (highVtecStorm && kpPeak && highVtecStorm.date !== kpPeak.date) {
    const peakIndices = indicesOnDate(kpPeak.date);
    const peakVtec = networkVtec(kpPeak.date);
    bullets.push(
      `Highest VTEC (${fmt(highVtecStorm.vtec, 2)} TECU) was on ${highVtecStorm.date} (Kp ${fmt(highVtecStorm.kp)}, Dst ${fmt(highVtecStorm.dst, 0)} nT). Peak Kp day ${kpPeak.date} (Kp ${fmt(kpPeak.value)}, Dst ${fmt(peakIndices.dst, 0)} nT) had VTEC ${peakVtec != null ? fmt(peakVtec, 2) : "n/a"} TECU — ionospheric peak can occur on a different day than maximum Kp as the disturbance propagates.`,
    );
  } else if (kpPeak) {
    const peakIndices = indicesOnDate(kpPeak.date);
    const peakVtec = networkVtec(kpPeak.date);
    if (peakVtec != null) {
      const d = quietMean != null ? peakVtec - quietMean : null;
      bullets.push(
        `Peak storm day ${kpPeak.date}: Kp ${fmt(kpPeak.value)} (${kpStormClass(kpPeak.value)}), Dst ${fmt(peakIndices.dst, 0)} nT, VTEC ${fmt(peakVtec, 2)} TECU${d != null && d > 0 ? ` (+${fmt(d, 2)} vs quiet)` : ""} — ${d != null && d > 0.5 ? "local ionosphere shows clear storm-time enhancement aligned with Kp/Dst." : "storm confirmed by indices; check adjacent days for delayed TEC response."}`,
      );
    }
  }

  const verdict =
    elevatedCount >= stormCompares.length * 0.6
      ? `Yes — VTEC over Zimbabwe generally tracks geomagnetic storms when compared day-by-day with Kp and Dst (${elevatedCount}/${stormCompares.length} storm days elevated).`
      : elevatedCount > 0
        ? `Partially — VTEC shows storm signatures on ${elevatedCount}/${stormCompares.length} days; always confirm storms with Kp ≥ 5 and Dst ≤ −50 nT on the same date.`
        : `Storm days are confirmed by Kp/Dst, but VTEC in this window did not consistently rise above quiet levels — use Kp/Dst charts as primary storm proof; VTEC reflects ionospheric conditions that can lag or mix with solar-driven background.`;

  return {
    lead: verdict,
    bullets,
  };
}

/** Summary strip at top of comparison tab */
export function analyzeOverallSummary(bundle: SourceBundle): ChartAnalysisBlock {
  const dates = unionDates(bundle);
  const kpPeak = globalKpPeak(bundle, dates);
  const bullets: string[] = [
    "Solar indices (F10.7, sunspots) → how active the Sun is → affects long-term TEC background.",
    "Geomagnetic indices (Kp, Ap, Dst, Cp) → storms and disturbances at Earth → affect TEC and GNSS on storm days.",
    "Red shading on Kp/Dst charts marks storm intervals. Always use Kp ≥ 5 or Dst ≤ −50 nT to confirm a storm; F10.7/SSN alone are not enough.",
  ];
  if (kpPeak && kpPeak.value >= 5) {
    const runUp = preStormGeomagneticBullet(bundle, kpPeak, "kp");
    if (runUp) bullets.unshift(runUp);
    bullets.unshift(
      `Strongest event in this window: Kp ${fmt(kpPeak.value)} on ${kpPeak.date} (${kpStormClass(kpPeak.value)}). The 3-day run-up below shows how indices changed before the storm hit.`,
    );
  } else if (kpPeak) {
    bullets.unshift(
      `Strongest event in this window: Kp ${fmt(kpPeak.value)} on ${kpPeak.date} (${kpStormClass(kpPeak.value)}). Check Cp and Dst on the same dates for full storm confirmation.`,
    );
  }
  return {
    lead: "How to read these charts: solar metrics explain the Sun; geomagnetic metrics prove storms at Earth.",
    bullets,
  };
}

function intermagnetPeakDbdt(intermagnet: IntermagnetAnalysisResponse): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null;
  for (const row of intermagnet.series) {
    if (row.max_dbdt == null) continue;
    if (!best || row.max_dbdt > best.value) best = { date: row.date, value: row.max_dbdt };
  }
  return best;
}

/** Links local INTERMAGNET dB/dt/GIC chart to planetary Dst/Ap on the same dates. */
export function analyzeIntermagnetDbdtLink(
  intermagnet: IntermagnetAnalysisResponse,
  bundle: SourceBundle,
): ChartAnalysisBlock {
  const peak = intermagnetPeakDbdt(intermagnet);
  if (!peak) {
    return {
      lead: "Local dB/dt at the observatory drives modelled GIC — compare timing with planetary Dst/Ap below.",
      bullets: [
        "Max |dH/dt| ≥ 10 nT/min flags elevated GIC risk at this ground site. Planetary Dst (ring current) and Ap (daily activity) on the chart below confirm whether a global geomagnetic storm was underway on the same day.",
      ],
    };
  }

  const snap = bundleDaySnapshot(bundle, peak.date);
  const bullets: string[] = [
    `Peak local activity: max |dH/dt| ${fmt(peak.value, 1)} nT/min on ${peak.date} at ${intermagnet.observatory} — modelled GIC scales with this rate of change.`,
    `Same day planetary indices: Dst ${snap.dst != null ? `${fmt(snap.dst, 0)} nT (${dstStormNote(snap.dst)})` : "n/a"}, Ap ${snap.ap != null ? `${fmt(snap.ap, 0)} (${apStormNote(snap.ap)})` : "n/a"}. When Dst ≤ −50 nT and Ap ≥ 50, a global storm is confirmed — local dB/dt spikes are then geomagnetically driven, not just quiet-day noise.`,
  ];

  const window = preStormRunUp(peak.date);
  const runUpParts = window.map(({ date }) => {
    const row = intermagnet.series.find((r) => r.date === date);
    const snapDay = bundleDaySnapshot(bundle, date);
    return `${date}: dB/dt ${fmt(row?.max_dbdt ?? null, 1)} nT/min, Dst ${fmt(snapDay.dst, 0)} nT, Ap ${fmt(snapDay.ap, 0)}`;
  });
  bullets.push(`3 days before peak dB/dt (${peak.date}): ${runUpParts.join("; ")}.`);

  const gicOnPeak = intermagnet.series.find((r) => r.date === peak.date)?.gic_est_a;
  if (gicOnPeak != null) {
    bullets.push(
      `Modelled GIC reached ${fmt(gicOnPeak, 1)} A on ${peak.date}. Rising Dst depression and Ap in the days before match the dB/dt build-up — this is consistent with a storm-driven GIC event at ${intermagnet.observatory}.`,
    );
  }

  return {
    lead: `Local dB/dt peak on ${peak.date} — cross-check planetary Dst/Ap on the same dates in the chart below.`,
    bullets,
  };
}

/** Analysis for NASA / Kyoto Dst + CelesTrak / Kyoto Ap dual-axis chart on INTERMAGNET tab. */
export function analyzeIntermagnetDstApChart(
  bundle: SourceBundle,
  dates: string[],
  intermagnet: IntermagnetAnalysisResponse,
  stormDates: string[],
): ChartAnalysisBlock {
  const kpPeak = globalKpPeak(bundle, dates);
  const dbdtPeak = intermagnetPeakDbdt(intermagnet);

  const bullets: string[] = [
    "Left axis — Dst (nanoTesla): ring-current storm intensity. More negative = stronger storm (≤ −50 nT threshold). NASA OMNIWeb and WDC Kyoto (Japan) should track closely on definitive archive dates.",
    "Right axis — Ap: daily planetary geomagnetic activity (≥ 50 = storm day). CelesTrak publishes daily mean Ap; WDC Kyoto provides definitive daily planetary Ap. NASA OMNIWeb does not include Ap — CelesTrak fills that role here.",
    "Red shading marks planetary storm days (Kp ≥ 5 or Dst ≤ −50 from loaded index providers). Compare with the dB/dt chart above — both should spike on the same storm interval.",
  ];

  const dstSpread = dates
    .map((date) => {
      const omni = bundle.omni?.series.find((r) => r.date === date)?.dst;
      const kyoto = bundle.kyoto?.series.find((r) => r.date === date)?.dst;
      if (omni != null && kyoto != null) return Math.abs(omni - kyoto);
      return null;
    })
    .filter((v): v is number => v != null);
  const dstSpreadMean = mean(dstSpread);
  if (dstSpreadMean != null) {
    bullets.push(`NASA vs Kyoto Dst mean |difference| ${fmt(dstSpreadMean, 0)} nT in this window — small gaps are normal redistribution/resampling differences.`);
  }

  const apSpread = dates
    .map((date) => {
      const cel = bundle.celestrak?.series.find((r) => r.date === date)?.ap;
      const kyoto = bundle.kyoto?.series.find((r) => r.date === date)?.ap_daily ?? bundle.kyoto?.series.find((r) => r.date === date)?.ap;
      if (cel != null && kyoto != null) return Math.abs(cel - kyoto);
      return null;
    })
    .filter((v): v is number => v != null);
  const apSpreadMean = mean(apSpread);
  if (apSpreadMean != null) {
    bullets.push(`CelesTrak vs Kyoto Ap mean |difference| ${fmt(apSpreadMean, 1)} — both should follow the same storm envelope; larger gaps can reflect preliminary vs final Kyoto values.`);
  }

  const focusDate = kpPeak?.date ?? dbdtPeak?.date ?? null;
  if (focusDate && (kpPeak?.value ?? 0) >= 5) {
    const runUpDst = preStormGeomagneticBullet(bundle, { date: focusDate, value: kpPeak!.value }, "dst");
    const runUpAp = preStormGeomagneticBullet(bundle, { date: focusDate, value: kpPeak!.value }, "ap");
    if (runUpDst) bullets.push(runUpDst);
    if (runUpAp) bullets.push(runUpAp);

    const window = preStormRunUp(focusDate);
    const cross = window.map(({ date }) => {
      const snap = bundleDaySnapshot(bundle, date);
      const imag = intermagnet.series.find((r) => r.date === date);
      return `${date}: Dst ${fmt(snap.dst, 0)} nT, Ap ${fmt(snap.ap, 0)}, local dB/dt ${fmt(imag?.max_dbdt ?? null, 1)} nT/min`;
    });
    bullets.push(
      `Storm run-up vs ${intermagnet.observatory} ground magnetometer (3 days before Kp ${fmt(kpPeak!.value)} on ${focusDate}): ${cross.join("; ")}. Planetary Dst/Ap depression and local dB/dt should rise together during the main phase.`,
    );
  } else if (dbdtPeak) {
    const snap = bundleDaySnapshot(bundle, dbdtPeak.date);
    bullets.push(
      `Peak local dB/dt on ${dbdtPeak.date} (${fmt(dbdtPeak.value, 1)} nT/min): same-day Dst ${fmt(snap.dst, 0)} nT, Ap ${fmt(snap.ap, 0)} — use both panels together to confirm geomagnetic storm forcing at Earth and at the observatory.`,
    );
  }

  const stormOverlap = stormDates.filter((d) => dates.includes(d)).length;
  if (stormOverlap) {
    bullets.push(`${stormOverlap} planetary storm day(s) overlap this INTERMAGNET timeline — expect elevated dB/dt and H-range on those dates at ${intermagnet.observatory}.`);
  }

  const lead = kpPeak
    ? `Planetary storm proof: Kp ${fmt(kpPeak.value)} on ${kpPeak.date}. Dst and Ap on this chart confirm global storm conditions that drive local dB/dt and GIC.`
    : "Dst and Ap prove geomagnetic storms at Earth — compare with local dB/dt from the observatory above.";

  return { lead, bullets };
}
