import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";

function fmt(n: number | null | undefined, d = 1): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n.toFixed(d);
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

function dstStormNote(dst: number): string {
  if (dst <= -200) return "intense ring-current storm";
  if (dst <= -100) return "moderate storm main phase";
  if (dst <= -50) return "weak storm / disturbed ring current";
  return "below typical storm threshold (−50 nT)";
}

function peakIndex(values: (number | null)[], abs = false): number | null {
  let best: { i: number; v: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    const x = abs ? Math.abs(v) : v;
    if (!best || x > best.v) best = { i, v: x };
  }
  return best?.i ?? null;
}

function troughIndex(values: (number | null)[]): number | null {
  let best: { i: number; v: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (!best || v < best.v) best = { i, v };
  }
  return best?.i ?? null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parseLabelMs(label: string): number {
  return Date.parse(label.replace(" ", "T") + "Z");
}

function gicDuringStormWindows(
  gicLabels: string[],
  gicObserved: (number | null)[],
  stormLabels: Set<string>,
): { peakStormGic: number; peakStormTime: string } | null {
  let best: { v: number; t: string } | null = null;
  for (let i = 0; i < gicLabels.length; i++) {
    const label = gicLabels[i];
    const key = label.slice(0, 13);
    if (!stormLabels.has(key)) continue;
    const v = gicObserved[i];
    if (v == null) continue;
    const abs = Math.abs(v);
    if (!best || abs > best.v) best = { v: abs, t: label };
  }
  return best ? { peakStormGic: best.v, peakStormTime: best.t } : null;
}

export interface GicSwContextInput {
  labels: string[];
  kp: (number | null)[];
  dst: (number | null)[];
  gicLabels?: string[];
  gicObserved?: (number | null)[];
  gicRate?: (number | null)[];
}

/** Data-driven explanation for Kp + Dst context charts on the GIC monitor. */
export function analyzeGicSpaceWeatherContext(input: GicSwContextInput | null): ChartAnalysisBlock {
  if (!input?.labels.length) {
    return {
      lead: "Planetary Kp and Dst over the same window as measured GIC — use both to judge whether grid currents are storm-driven.",
      bullets: [
        "Kp ≥ 5 (orange line) marks official geomagnetic storm level. Dst ≤ −50 nT marks ring-current storm conditions.",
        "When GIC spikes line up with elevated Kp or depressed Dst, the transformer currents are geomagnetically driven.",
      ],
    };
  }

  const { labels, kp, dst, gicLabels, gicObserved, gicRate } = input;
  const kpVals = kp.filter((v): v is number => v != null);
  const dstVals = dst.filter((v): v is number => v != null);

  const kpPeakIdx = peakIndex(kp);
  const dstTroughIdx = troughIndex(dst);
  const kpPeak = kpPeakIdx != null && kp[kpPeakIdx] != null ? { t: labels[kpPeakIdx], v: kp[kpPeakIdx]! } : null;
  const dstMin = dstTroughIdx != null && dst[dstTroughIdx] != null ? { t: labels[dstTroughIdx], v: dst[dstTroughIdx]! } : null;

  const stormKpCount = kp.filter((v) => v != null && v >= 5).length;
  const stormDstCount = dst.filter((v) => v != null && v <= -50).length;
  const bothStormCount = kp.filter((v, i) => v != null && v >= 5 && dst[i] != null && dst[i]! <= -50).length;

  const kpMean = mean(kpVals);
  const dstMean = mean(dstVals);

  const stormLabelKeys = new Set(
    labels.filter((_, i) => (kp[i] != null && kp[i]! >= 5) || (dst[i] != null && dst[i]! <= -50)).map((l) => l.slice(0, 13)),
  );

  const bullets: string[] = [
    "Kp (left) measures global geomagnetic storm level in 3-hour steps — values at or above the orange line (5) mean a G1–G5 storm. Dst (right) tracks the ring current; more negative values mean a stronger storm main phase (≤ −50 nT threshold).",
  ];

  if (kpPeak) {
    bullets.push(
      `Peak Kp ${fmt(kpPeak.v, 0)} at ${kpPeak.t} UTC — ${kpStormClass(kpPeak.v)}${kpPeak.v >= 5 ? "; storm threshold crossed." : "; below official storm level (5)."}`,
    );
  }

  if (dstMin) {
    bullets.push(
      `Deepest Dst ${fmt(dstMin.v, 0)} nT at ${dstMin.t} UTC — ${dstStormNote(dstMin.v)}.`,
    );
  }

  if (kpMean != null && dstMean != null) {
    bullets.push(
      `Window average: Kp ${fmt(kpMean, 1)}, Dst ${fmt(dstMean, 0)} nT — ${stormKpCount > 0 || stormDstCount > 0 ? "geomagnetic activity was elevated for part of this period." : "conditions stayed below storm thresholds throughout."}`,
    );
  }

  if (stormKpCount > 0 || stormDstCount > 0) {
    bullets.push(
      `${stormKpCount} sample(s) with Kp ≥ 5 and ${stormDstCount} with Dst ≤ −50 nT${bothStormCount > 0 ? `; ${bothStormCount} interval(s) where both storm criteria were met simultaneously.` : "."}`,
    );
  }

  if (gicLabels?.length && gicObserved?.length) {
    const gicPeakIdx = peakIndex(gicObserved, true);
    const gicPeak =
      gicPeakIdx != null && gicObserved[gicPeakIdx] != null
        ? { t: gicLabels[gicPeakIdx], v: Math.abs(gicObserved[gicPeakIdx]!) }
        : null;

    if (gicPeak) {
      const duringStorm = gicDuringStormWindows(gicLabels, gicObserved, stormLabelKeys);
      if (duringStorm && duringStorm.peakStormGic >= 10) {
        bullets.push(
          `Measured GIC peaked at ${fmt(duringStorm.peakStormGic, 1)} A around ${duringStorm.peakStormTime} UTC while Kp/Dst were in storm bands — strong evidence the grid current was geomagnetically driven.`,
        );
      } else if (gicPeak.v >= 25 && stormKpCount === 0 && stormDstCount === 0) {
        bullets.push(
          `Peak |GIC| ${fmt(gicPeak.v, 1)} A at ${gicPeak.t} UTC without Kp ≥ 5 or Dst ≤ −50 in this window — investigate local engineering sources (switching, load changes) alongside magnetometer dB/dt.`,
        );
      } else if (gicPeak.v >= 10) {
        bullets.push(
          `Peak |GIC| ${fmt(gicPeak.v, 1)} A at ${gicPeak.t} UTC — compare timing with the Kp/Dst peaks above to confirm storm coupling.`,
        );
      }
    }
  }

  if (gicRate?.length) {
    const ratePeakIdx = peakIndex(gicRate, true);
    if (ratePeakIdx != null && gicRate[ratePeakIdx] != null && Math.abs(gicRate[ratePeakIdx]!) >= 1) {
      const rateT = gicLabels?.[ratePeakIdx] ?? "unknown time";
      bullets.push(
        `Fastest GIC change: ${fmt(Math.abs(gicRate[ratePeakIdx]!), 2)} A/min around ${rateT} UTC — impulsive dGIC/dt tracks storm sudden commencements and sharp dB/dt.`,
      );
    }
  }

  const stormActive = (kpPeak?.v ?? 0) >= 5 || (dstMin?.v ?? 0) <= -50;
  const lead = stormActive
    ? `Geomagnetic storm conditions in this window${kpPeak && kpPeak.v >= 5 ? ` (Kp up to ${fmt(kpPeak.v, 0)})` : ""}${dstMin && dstMin.v <= -50 ? `, Dst down to ${fmt(dstMin.v, 0)} nT` : ""} — expect elevated GIC risk at ZETDC transformers.`
    : kpPeak && kpPeak.v >= 4
      ? `Elevated but sub-storm geomagnetic activity (peak Kp ${fmt(kpPeak.v, 0)}) — monitor GIC for coupling if Kp rises further.`
      : "Quiet to unsettled geomagnetic background in this window — GIC spikes without Kp/Dst support may be locally driven.";

  return { lead, bullets };
}

export function analyzeGicObservedChart(
  labels: string[],
  observed: (number | null)[],
  predicted: (number | null)[],
): ChartAnalysisBlock {
  if (!labels.length) {
    return { lead: "", bullets: [] };
  }

  const peakIdx = peakIndex(observed, true);
  const peak =
    peakIdx != null && observed[peakIdx] != null
      ? { t: labels[peakIdx], v: Math.abs(observed[peakIdx]!) }
      : null;
  const latest = observed.at(-1);
  const latestPred = predicted.at(-1);
  const errors = observed
    .map((o, i) => (o != null && predicted[i] != null ? Math.abs(o - predicted[i]!) : null))
    .filter((e): e is number => e != null);
  const errMean = mean(errors);

  const bullets: string[] = [
    "Solid line: transformer-neutral GIC measured in amperes (A). Dashed line: one-step-ahead Extended Kalman Filter prediction from recent history.",
    peak
      ? `Peak |GIC| ${fmt(peak.v, 1)} A at ${peak.t} UTC${peak.v >= 50 ? " — high grid-risk band (≥ 50 A)." : peak.v >= 25 ? " — moderate grid-risk band (≥ 25 A)." : peak.v >= 10 ? " — above large-GIC reference (10 A)." : " — below large-GIC reference (10 A)."}.`
      : "No measured GIC values in this window.",
  ];

  if (latest != null) {
    bullets.push(`Latest observed ${fmt(Math.abs(latest), 2)} A${latestPred != null ? `; EKF predicted ${fmt(Math.abs(latestPred), 2)} A` : ""}.`);
  }

  if (errMean != null) {
    bullets.push(
      `Mean |observed − EKF| ${fmt(errMean, 2)} A in this window. A sustained gap beyond mean + 3σ of recent errors triggers the geomagnetic disturbance alert below.`,
    );
  }

  return {
    lead: peak && peak.v >= 25 ? `Elevated measured GIC — peak ${fmt(peak.v, 1)} A.` : "Measured vs EKF-predicted GIC at the selected ZETDC monitoring station.",
    bullets,
  };
}

export function analyzeGicRateChart(labels: string[], rate: (number | null)[]): ChartAnalysisBlock {
  if (!labels.length) {
    return { lead: "", bullets: [] };
  }

  const peakIdx = peakIndex(rate, true);
  const peak =
    peakIdx != null && rate[peakIdx] != null ? { t: labels[peakIdx], v: Math.abs(rate[peakIdx]!) } : null;

  const bullets: string[] = [
    "dGIC/dt (A/min) is the rate of change of transformer current — the GIC analogue of geomagnetic dB/dt. Sharp positive or negative spikes mean impulsive driving from the magnetic field.",
    peak
      ? `Largest |dGIC/dt| ${fmt(peak.v, 2)} A/min at ${peak.t} UTC — these are the moments of highest transformer stress during storm sudden commencements.`
      : "No significant GIC rate changes recorded in this window.",
  ];

  return {
    lead: peak && peak.v >= 2 ? `Impulsive GIC change detected — peak |dGIC/dt| ${fmt(peak.v, 2)} A/min.` : "Rate of GIC change — watch for sharp spikes during geomagnetic storms.",
    bullets,
  };
}
