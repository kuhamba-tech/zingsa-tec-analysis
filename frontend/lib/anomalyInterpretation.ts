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
  const z = day.tec_response_z ?? 0;
  if (day.storm_flag && kp >= 7) return "severe";
  if (day.storm_flag && kp >= 5) return "high";
  if (above >= 15 || z >= 3) return "high";
  if (above >= 5 || z >= 2) return "moderate";
  return "low";
}

export function interpretAnomalyDay(day: AnomalyDay, thresholdPct: number): AnomalyInterpretation {
  const above = deviationAboveThreshold(day) ?? 0;
  const severity = severityFromDay(day, above);
  const pctStr = `${thresholdPct}th percentile`;
  const aboveStr = above > 0 ? `+${above.toFixed(1)} TECU above threshold` : "at threshold";

  if (!day.anomaly) {
    return {
      category: "Normal",
      severity: "quiet",
      headline: "Within expected range",
      detail: `Mean VTEC stayed below the ${pctStr} cutoff (${day.threshold.toFixed(1)} TECU).`,
      recommendation: "No action required — ionosphere behaved normally for this archive day.",
    };
  }

  if (day.storm_flag) {
    const stormLabel = day.kp_severity ?? (day.kp != null && day.kp >= 5 ? "Geomagnetic storm" : "Storm period");
    return {
      category: "Storm-linked",
      severity,
      headline: `${stormLabel} — TEC elevated`,
      detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU (${aboveStr}). Kp ${day.kp?.toFixed(1) ?? "—"}${
        day.dst != null ? `, Dst ${day.dst.toFixed(0)} nT` : ""
      }. ${day.tec_response ?? "Positive ionospheric response expected during disturbed conditions."}`,
      recommendation:
        "Treat as space-weather driven. Check GNSS accuracy, scintillation (S4), and compare with PRN Explorer for satellite-specific effects.",
    };
  }

  if (day.tec_response === "Negative ionospheric response") {
    return {
      category: "Depression",
      severity: severity === "quiet" ? "moderate" : severity,
      headline: "TEC below quiet baseline",
      detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU flagged as an anomaly but ionospheric response was negative vs prior quiet days.`,
      recommendation: "Review time series — may indicate data gap, masking, or unusual depletion rather than a storm enhancement.",
    };
  }

  return {
    category: "Unconfirmed spike",
    severity,
    headline: "High TEC without storm flag",
    detail: `Mean VTEC ${day.mean_vtec.toFixed(1)} TECU (${aboveStr}). No Kp ≥ 5 storm on this day — could be Equatorial Ionospheric Anomaly (EIA), post-sunset enhancement, or regional gradient.`,
    recommendation:
      "Cross-check TEC heatmap and diurnal profile. Confirm on time series before treating as operational alert.",
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
