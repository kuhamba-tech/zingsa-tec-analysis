import { classifyGeomagneticActivity, geomagneticAlertMessages } from "./geomagneticStormAlerts";
import type { SpaceWeatherCurrent } from "./types";

export interface HomeStormAlert {
  message: string;
  severity: "warn" | "alert";
}

/**
 * Home-page storm banners from live observed indices only (Kp / Dst).
 * EKF filter residuals are not storm evidence and must not appear here.
 */
export function buildHomeStormAlerts(sw: SpaceWeatherCurrent | null): HomeStormAlert[] {
  const geo = classifyGeomagneticActivity(sw?.kp, sw?.dst);
  if (geo.level === "none") return [];

  const severity: "warn" | "alert" = geo.level === "storm" ? "alert" : "warn";
  const seen = new Set<string>();
  const alerts: HomeStormAlert[] = [];

  for (const message of geomagneticAlertMessages(sw?.kp, sw?.dst)) {
    const key = message.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    alerts.push({ message: key, severity });
  }

  return alerts;
}

export function shouldShowHomeStormAlerts(sw: SpaceWeatherCurrent | null): boolean {
  return classifyGeomagneticActivity(sw?.kp, sw?.dst).level !== "none";
}
