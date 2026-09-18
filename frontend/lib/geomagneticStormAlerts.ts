/** Geomagnetic storm alert thresholds — mirrors zgiis/space_weather/geomagnetic_storm_alerts.py */

import type { SpaceWeatherCurrent } from "./types";

export const KP_ACTIVE = 4;
export const KP_STORM = 5;
export const DST_MODERATE = -30;
export const DST_STORM = -50;

export const GEOMAGNETIC_ALERT_RULES = [
  "Possible geomagnetic storm: Kp ≥ 4 (active) or Dst ≤ −30 nT",
  "Geomagnetic storm: Kp ≥ 5 (G1+) or Dst ≤ −50 nT",
] as const;

export type GeomagneticAlertLevel = "none" | "possible" | "storm";

function formatDstDisplay(dst: number): string {
  return dst >= 0 ? `+${dst.toFixed(0)}` : dst.toFixed(0);
}

export function geomagneticAlertMessages(
  kp: number | null | undefined,
  dst: number | null | undefined,
): string[] {
  const messages: string[] = [];
  const storm =
    (kp != null && Number.isFinite(kp) && kp >= KP_STORM) ||
    (dst != null && Number.isFinite(dst) && dst <= DST_STORM);

  if (storm) {
    if (kp != null && kp >= KP_STORM) {
      messages.push(
        `🔴 Kp Index: ${kp.toFixed(0)} — Geomagnetic storm in progress. GNSS, power, and navigation systems may be degraded.`,
      );
    }
    if (dst != null && dst <= DST_STORM) {
      messages.push(
        `🔴 Dst Index: ${formatDstDisplay(dst)} nT — Geomagnetic storm threshold reached. Earth's magnetic field is strongly disturbed.`,
      );
    }
    return messages;
  }

  if (kp != null && Number.isFinite(kp) && kp >= KP_ACTIVE) {
    messages.push(
      `🟠 Kp Index: ${kp.toFixed(0)} — Geomagnetic activity is increasing. Possible storm conditions developing.`,
    );
  }
  if (dst != null && Number.isFinite(dst) && dst <= DST_MODERATE) {
    messages.push(
      `🟠 Dst Index: ${formatDstDisplay(dst)} nT — Earth's magnetic field is becoming increasingly disturbed. Possible storm conditions developing.`,
    );
  }
  return messages;
}

export function classifyGeomagneticActivity(
  kp: number | null | undefined,
  dst: number | null | undefined,
): {
  level: GeomagneticAlertLevel;
  reasons: string[];
  headline: string | null;
} {
  const reasons: string[] = [];
  let level: GeomagneticAlertLevel = "none";

  const storm =
    (kp != null && Number.isFinite(kp) && kp >= KP_STORM) ||
    (dst != null && Number.isFinite(dst) && dst <= DST_STORM);

  if (storm) {
    level = "storm";
    if (kp != null && kp >= KP_STORM) reasons.push(`Kp ${kp.toFixed(0)} ≥ ${KP_STORM}`);
    if (dst != null && dst <= DST_STORM) reasons.push(`Dst ${dst.toFixed(0)} nT ≤ ${DST_STORM}`);
  } else {
    const possible =
      (kp != null && Number.isFinite(kp) && kp >= KP_ACTIVE) ||
      (dst != null && Number.isFinite(dst) && dst <= DST_MODERATE);
    if (possible) {
      level = "possible";
      if (kp != null && kp >= KP_ACTIVE) reasons.push(`Kp ${kp.toFixed(0)} ≥ ${KP_ACTIVE}`);
      if (dst != null && dst <= DST_MODERATE) reasons.push(`Dst ${dst.toFixed(0)} nT ≤ ${DST_MODERATE}`);
    }
  }

  let headline: string | null = null;
  const alertMessages = geomagneticAlertMessages(kp, dst);
  if (alertMessages.length > 0) {
    headline = alertMessages.join(" · ");
  }

  return { level, reasons, headline };
}

export function isGeomagneticStorm(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return classifyGeomagneticActivity(sw.kp, sw.dst).level === "storm";
}

export function isPossibleGeomagneticStorm(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return classifyGeomagneticActivity(sw.kp, sw.dst).level === "possible";
}

export function geomagneticAlertLevel(
  sw: SpaceWeatherCurrent | null,
): GeomagneticAlertLevel {
  if (!sw) return "none";
  return classifyGeomagneticActivity(sw.kp, sw.dst).level;
}
