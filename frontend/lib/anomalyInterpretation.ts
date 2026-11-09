import type { AnomalyDay } from "@/lib/types";

export type AnomalySeverity = "quiet" | "low" | "moderate" | "high" | "severe";

export interface AnomalyInterpretation {
  category: string;
  severity: AnomalySeverity;
  headline: string;
  detail: string;
  recommendation: string;
}

export function deviationAboveThreshold(day: AnomalyDay): number | null {
  if (typeof day.tec_deviation_tecu === "number" && Number.isFinite(day.tec_deviation_tecu)) {
    return day.tec_deviation_tecu;
  }
  if (!Number.isFinite(day.mean_vtec) || !Number.isFinite(day.threshold)) return null;
  return day.mean_vtec - day.threshold;
}

export function deviationPercent(day: AnomalyDay): number | null {
  const delta = deviationAboveThreshold(day);
  if (delta == null || !Number.isFinite(day.threshold) || day.threshold <= 0) return null;
  return (delta / day.threshold) * 100;
}

function severityFromDay(day: AnomalyDay, above: number): AnomalySeverity {
  if (!day.anomaly) return "quiet";
  const kp = day.kp ?? 0;
  const z = Math.abs(day.tec_response_z ?? 0);
  if (day.geomagnetic_coincidence && kp >= 7) return "severe";
  if (day.geomagnetic_coincidence && kp >= 5) return "high";
  if (Math.abs(above) >= 15 || z >= 3) return "high";
  if (Math.abs(above) >= 5 || z >= 2) return "moderate";
  return "low";
}

export function interpretAnomalyDay(day: AnomalyDay, thresholdPct: number): AnomalyInterpretation {
  const above = deviationAboveThreshold(day) ?? 0;
  const severity = severityFromDay(day, above);
  const pctStr = `${thresholdPct}th percentile`;
  const deltaStr =
    above > 0 ? `ΔTEC +${above.toFixed(1)} TECU` : above < 0 ? `ΔTEC ${above.toFixed(1)} TECU` : "ΔTEC ≈ 0";
  const polarity = day.anomaly_polarity ?? (day.negative_anomaly ? "negative" : day.positive_anomaly ? "positive" : "none");
  const coincidence = Boolean(day.geomagnetic_coincidence ?? day.storm_flag);

  if (!day.anomaly) {
    return {
      category: "Normal",
      severity: "quiet",
      headline: "Within expected range",
      detail: `Mean VTEC stayed inside the quiet-reference / ${pctStr} envelope (${day.threshold.toFixed(1)} TECU high threshold).`,
      recommendation: "No action required — ionosphere behaved normally for this archive day.",
    };
  }

  if (polarity === "negative" || day.tec_response === "Negative ionospheric response") {
    return {
      category: coincidence ? "Negative TEC · geomagnetic coincidence" : "Negative TEC storm",
      severity: severity === "quiet" ? "moderate" : severity,
      headline: coincidence
        ? "TEC depletion with same-day geomagnetic coincidence"
        : "TEC depletion relative to quiet-time reference",
      detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU (${deltaStr}). ${
        coincidence
          ? `Kp ${day.kp?.toFixed(1) ?? "—"}${day.dst != null ? `, Dst ${day.dst.toFixed(0)} nT` : ""} coincided on this day — investigate SYM-H, IMF Bz, solar wind and TEC timing before attributing cause.`
          : "No Kp ≥ 5 coincidence. Assess data completeness, masking and regional gradients before treating as an operational alert."
      }`,
      recommendation:
        "Review the time series for depletion timing. Cross-check CORS completeness and scintillation before GNSS impact decisions.",
    };
  }

  if (coincidence) {
    const stormLabel = day.kp_severity ?? (day.kp != null && day.kp >= 5 ? "G1+ geomagnetic conditions" : "Storm period");
    return {
      category: "Positive TEC · geomagnetic coincidence",
      severity,
      headline: `${stormLabel} — TEC enhancement requires further assessment`,
      detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU (${deltaStr}). Kp ${day.kp?.toFixed(1) ?? "—"}${
        day.dst != null ? `, Dst ${day.dst.toFixed(0)} nT` : ""
      }. Same-day Kp ≥ 5 is a geomagnetic coincidence, not proof that the TEC change was storm-driven.`,
      recommendation:
        "Investigate with SYM-H, IMF Bz, solar-wind timing and CORS TEC/S4. Confirm GNSS effects locally before issuing an impact alert.",
    };
  }

  return {
    category: "Unconfirmed enhancement",
    severity,
    headline: "High TEC without geomagnetic coincidence",
    detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU (${deltaStr}). No Kp ≥ 5 coincidence — could be Equatorial Ionospheric Anomaly (EIA), post-sunset enhancement, or a regional gradient.`,
    recommendation:
      "Cross-check TEC heatmap and diurnal profile. Confirm on time series before treating as an operational alert.",
  };
}

export const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  quiet: "Normal",
  low: "Mild",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};

export const SEVERITY_COLORS: Record<AnomalySeverity, string> = {
  quiet: "#ffffff",
  low: "#34d399",
  moderate: "#fbbf24",
  high: "#f97316",
  severe: "#ef4444",
};
