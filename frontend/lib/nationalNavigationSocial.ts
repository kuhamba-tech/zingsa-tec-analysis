import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import { buildNationalGnssStatusBlock } from "./nationalGnssStatus";

export type StormSocialTier = "mild" | "moderate" | "severe" | "extreme";

const TEMPLATES: Record<StormSocialTier, string> = {
  mild: `🟡 Mild space weather

🇿🇼 ZINGSA Navigation Update

GPS for everyday use should work. Small wobbles possible.

🚗 Drivers – Map pin may drift briefly, then correct.
📐 Surveyors – RTK OK; allow a little extra time to Fix.
🌾 Farmers – Tractor GPS and planting can continue.
⚡ Power – Keep routine GIC watch on the grid.

Most people: use Maps as normal.

#ZINGSA #Zimbabwe #GPS`,
  moderate: `🟠 Moderate space weather

🇿🇼 ZINGSA Navigation Alert

GPS may be slower or a few metres off — especially for precise work.

🚗 Drivers – Check the road, not only the app, at junctions.
📐 Surveyors – Longer RTK init; prefer morning occupations.
🌾 Farmers – Finish GPS field work before late morning.
⚡ Power – Watch GIC / transformer neutrals; minor geomagnetic disturbance.

Everyday maps still usable. Precision users: take care.

#ZINGSA #Zimbabwe #GPS #RTK`,
  severe: `🔴 Severe space weather

🇿🇼 ZINGSA Navigation Warning

GPS may show the wrong place. Do not trust a pin alone.

🚗 Drivers – Confirm pickups by phone; watch junctions.
📐 Surveyors – Expect RTK drops; add control checks.
🌾 Farmers – Pause critical auto-steer / legal boundary work if you can.
⚡ Power – Heighten GIC monitoring on long HV lines.

ZINGSA is monitoring. Updates to follow.

#ZINGSA #Zimbabwe #GPS #SpaceWeather`,
  extreme: `🟣 Extreme space weather

🇿🇼 ZINGSA National Advisory

GPS and precision GNSS may fail in places. Confirm locations by other means.

🚗 Drivers – GPS unreliable in some areas.
📐 Surveyors – Do not rely on cm GNSS until conditions ease.
🌾 Farmers – Delay centimetre farm GPS jobs.
⚡ Power – Increase grid / GIC monitoring.
📡 Telecom – Watch GNSS timing holds.

ZINGSA is monitoring via the national CORS network.

#ZINGSA #Zimbabwe #SpaceWeather #GPS`,
};

export function resolveStormSocialTier(
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
): StormSocialTier {
  if (tone === "excellent") return "mild";
  if (tone === "moderate") return "moderate";
  const kp = sw?.kp;
  const dst = sw?.dst;
  const risk = (sw?.gnss_risk ?? "").toLowerCase();
  if (
    (kp != null && kp >= 8) ||
    (dst != null && dst <= -150) ||
    risk === "critical"
  ) {
    return "extreme";
  }
  return "severe";
}

export function buildNationalNavigationSocial(
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt?: string,
  forecasts?: GnssForecastCity[],
): string {
  const tier = resolveStormSocialTier(tone, sw);
  const parts = [TEMPLATES[tier]];
  if (forecasts?.length) {
    parts.push("", buildNationalGnssStatusBlock(forecasts, tone, sw));
  }
  if (computedAt) {
    const stamp = computedAt.replace("T", " ").replace("Z", " UTC").slice(0, 19);
    parts.push("", `Updated ${stamp}`);
  }
  return parts.join("\n");
}
