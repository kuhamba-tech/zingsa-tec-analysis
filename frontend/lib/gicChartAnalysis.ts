import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";

export interface GicSwContextInput {
  labels: string[]; kp: (number | null)[]; dst: (number | null)[];
  gicLabels?: string[]; gicObserved?: (number | null)[]; gicRate?: (number | null)[];
}

export function analyzeGicSpaceWeatherContext(input: GicSwContextInput | null): ChartAnalysisBlock {
  const kp = input?.kp.filter((v): v is number => v != null) ?? [];
  const dst = input?.dst.filter((v): v is number => v != null) ?? [];
  return { lead: "Planetary indices provide geomagnetic context; they do not measure transformer-neutral current in Zimbabwe.", bullets: [
    kp.length ? `Available Kp maximum: ${Math.max(...kp).toFixed(2)}. Kp 5 is the NOAA geomagnetic-storm threshold.` : "Kp is unavailable in this window.",
    dst.length ? `Available Dst minimum: ${Math.min(...dst).toFixed(1)} nT. Dst and SYM-H are distinct products and must not be substituted for one another.` : "Dst is unavailable in this window.",
    "A temporal association with GIC does not establish causality. Review local magnetic components and dH/dt, sensor quality, and network operating conditions.",
  ] };
}

export function analyzeGicObservedChart(labels: string[], observed: (number | null)[], predicted: (number | null)[]): ChartAnalysisBlock {
  const values = observed.filter((v): v is number => v != null);
  const peak = values.reduce<number | null>((best, value) => best == null || Math.abs(value) > Math.abs(best) ? value : best, null);
  return { lead: "Signed transformer-neutral current from genuine stored observations.", bullets: [
    peak == null ? "No valid current measurements in this interval." : `Largest measured magnitude: ${Math.abs(peak).toFixed(3)} A; signed peak ${peak.toFixed(3)} A.`,
    "Physical current direction requires the documented sensor polarity convention. Category boundaries are provisional unless site engineering approval is recorded.",
    "Predicted-current overlays are withheld until independent validation. No transformer damage or reactive-power consumption can be inferred from current magnitude alone.",
  ] };
}

export function analyzeGicRateChart(labels: string[], rate: (number | null)[]): ChartAnalysisBlock {
  const values = rate.filter((v): v is number => v != null);
  return { lead: "dGIC/dt describes current change in A/min; it is not magnetic-field dB/dt.", bullets: [
    values.length ? `Largest absolute current rate in valid adjoining samples: ${values.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0).toFixed(3)} A/min.` : "No current derivative can be established without adjacent valid measurements and a configured cadence.",
    "Derivatives are not computed across long gaps. A rapid current change may have geomagnetic or local electrical causes; consult independent magnetometry and equipment records.",
  ] };
}
