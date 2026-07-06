import { classifyGeomagneticActivity, geomagneticAlertMessages } from "./geomagneticStormAlerts";
import type { EkfAlert, EkfStatus, SpaceWeatherCurrent } from "./types";

export interface HomeStormAlert {
  message: string;
  severity: "warn" | "alert";
}

function worstUnackedAlert(ekf: EkfStatus | null, pending: EkfAlert[]): EkfAlert | null {
  const rows = pending.length > 0 ? pending : (ekf?.alerts ?? []).filter((a) => !a.acknowledged_status);
  if (rows.length === 0) return null;
  const rank: Record<string, number> = { Low: 0, Moderate: 1, High: 2, Severe: 3 };
  return [...rows].sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0))[0];
}

function formatEkfDeviationAlert(alert: EkfAlert): string {
  const label = alert.parameter_label ?? alert.parameter;
  if (alert.alert_message?.includes("Extended Kalman Filter")) {
    return (
      `Possible geomagnetic disturbance detected: ${label} observed value differs significantly from EKF prediction. ` +
      "Check Kp, Dst, TEC and solar wind conditions."
    );
  }
  return alert.alert_message;
}

function isEkfBannerPart(part: string): boolean {
  const lower = part.toLowerCase();
  return lower.includes("ekf deviation") || lower.includes("differs from prediction") || lower.includes("ekf prediction");
}

/** Build home-page storm banners from live indices + EKF status (mirrors dashboard alarm rules). */
export function buildHomeStormAlerts(
  sw: SpaceWeatherCurrent | null,
  ekf: EkfStatus | null,
  pendingAlerts: EkfAlert[] = [],
): HomeStormAlert[] {
  const geo = classifyGeomagneticActivity(sw?.kp, sw?.dst);
  const alerts: HomeStormAlert[] = [];
  const seen = new Set<string>();
  const defaultSeverity: "warn" | "alert" = geo.level === "storm" ? "alert" : "warn";

  const push = (message: string, severity: "warn" | "alert") => {
    const key = message.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    alerts.push({ message: key, severity });
  };

  for (const message of geomagneticAlertMessages(sw?.kp, sw?.dst)) {
    push(message, geo.level === "storm" ? "alert" : "warn");
  }

  if (ekf?.banner) {
    for (const part of ekf.banner.split(" · ").map((p) => p.trim()).filter(Boolean)) {
      if (isEkfBannerPart(part)) {
        push(part, defaultSeverity);
      }
    }
  }

  const worst = worstUnackedAlert(ekf, pendingAlerts);
  if (worst) {
    push(formatEkfDeviationAlert(worst), defaultSeverity);
  }

  return alerts;
}

export function shouldShowHomeStormAlerts(
  sw: SpaceWeatherCurrent | null,
  ekf: EkfStatus | null,
  pendingAlerts: EkfAlert[] = [],
): boolean {
  const geo = classifyGeomagneticActivity(sw?.kp, sw?.dst);
  const ekfCount = ekf?.active_alert_count ?? 0;
  const pending = pendingAlerts.filter((a) => !a.acknowledged_status).length;
  return geo.level !== "none" || ekfCount > 0 || pending > 0 || !!ekf?.banner;
}
