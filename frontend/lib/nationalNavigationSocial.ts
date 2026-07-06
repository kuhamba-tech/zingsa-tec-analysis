import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import { buildNationalGnssStatusBlock } from "./nationalGnssStatus";

export type StormSocialTier = "mild" | "moderate" | "severe" | "extreme";

const TEMPLATES: Record<StormSocialTier, string> = {
  mild: `🟡 ACTIVE (MILD) CONDITIONS

🇿🇼 ZINGSA Navigation & Space Weather Update

🛰️ Today's Status: 🟡 Mild Geomagnetic Activity

A minor geomagnetic disturbance is affecting Earth's magnetic field. Most GPS services will continue operating normally, although small reductions in positioning accuracy are possible.

What this means

🚗 Drivers – Your GPS may briefly drift before correcting itself.

📐 Surveyors – RTK remains available, but allow extra time to obtain a fixed solution.

🌾 Farmers – Precision farming can continue normally.

🚁 Drone Operators – Check RTK quality before and during flights.

✈️ Aviation – Continue normal navigation procedures.

⚡ Power Utilities – Routine monitoring is recommended.

🇿🇼 Navigation Outlook

🟢 GPS Availability: Excellent

🟡 RTK Accuracy: Minor fluctuations possible

🟡 Geomagnetic Activity: Mild

There is no cause for concern. ZINGSA continues monitoring the national space environment.

#ZINGSA #Zimbabwe #GNSS #SpaceWeather #GPS`,
  moderate: `🟠 MODERATE GEOMAGNETIC STORM

🇿🇼 ⚠️ ZINGSA Navigation Alert

🛰️ Current Status: 🟠 Moderate Geomagnetic Storm

Zimbabwe is experiencing increased geomagnetic activity that may affect GPS and GNSS performance, particularly for high-precision applications.

Expected impacts

🚗 Drivers – Occasional GPS position drift may occur.

📐 Surveyors – Longer RTK initialisation times and reduced accuracy are possible.

🌾 Farmers – Monitor positioning quality during precision field operations.

🚁 Drone Operators – Verify RTK status before critical mapping missions.

✈️ Aviation – Continue monitoring GNSS performance as part of standard procedures.

⚡ Power Utilities – Continue observing GIC monitoring systems.

🇿🇼 Navigation Outlook

🟠 GPS Accuracy: Reduced

🟠 RTK Reliability: Moderate

🟠 Ionospheric Activity: Elevated

Most users will continue to navigate successfully, but high-precision users should take extra care.

#SpaceWeather #ZINGSA #Zimbabwe #GNSS #GPS #RTK`,
  severe: `🔴 SEVERE GEOMAGNETIC STORM

🇿🇼 🚨 ZINGSA National Navigation Warning

🔴 Severe Geomagnetic Storm in Progress

A strong geomagnetic storm is affecting the ionosphere over Zimbabwe and may significantly reduce GPS and GNSS accuracy.

Potential impacts

🚗 Drivers – Navigation apps may occasionally display incorrect positions.

📐 Surveyors – RTK interruptions and reduced positioning accuracy are likely.

🌾 Farmers – Delay critical precision farming activities if possible.

🚁 Drone Operators – Consider postponing high-precision mapping flights until conditions improve.

✈️ Aviation – Continue enhanced monitoring of satellite navigation systems.

⚡ Power Utilities – Increased geomagnetic activity may influence long transmission lines. Continue monitoring GIC systems.

🇿🇼 Navigation Outlook

🔴 GPS Accuracy: Reduced

🔴 RTK Reliability: Poor

🔴 Ionospheric Disturbance: High

ZINGSA is closely monitoring the event and will provide updates as conditions evolve.

Stay informed. Stay prepared.

#ZINGSA #Zimbabwe #GeomagneticStorm #GNSS #GPS #SpaceWeather`,
  extreme: `🟣 EXTREME GEOMAGNETIC STORM

🇿🇼 🚨 ZINGSA National Space Weather Emergency Advisory

🟣 Extreme Geomagnetic Storm

An extreme geomagnetic storm is currently affecting Earth's magnetic field. Significant disruptions to satellite navigation and other space-based technologies are possible.

Expected impacts

🚗 Drivers – GPS accuracy may be unreliable in some areas.

📐 Surveyors – High-precision GNSS surveying is not recommended until conditions improve.

🌾 Farmers – Delay precision agriculture activities that depend on centimetre-level positioning.

🚁 Drone Operators – Postpone RTK-dependent flights where possible.

✈️ Aviation – Operators should remain alert for GNSS degradation and follow established operational procedures.

⚡ Power Utilities – Increased monitoring of power infrastructure and GIC systems is recommended.

📡 Telecommunications – Some satellite-based timing and HF communication systems may experience disturbances.

🇿🇼 Navigation Outlook

🟣 GPS Accuracy: Significantly Reduced

🟣 RTK Services: May Be Unavailable

🟣 Space Weather Activity: Extreme

ZINGSA is continuously monitoring the situation through Zimbabwe's national CORS network and international space weather services. Further updates will be issued as conditions change.

#ZINGSA #Zimbabwe #SpaceWeather #GeomagneticStorm #GNSS #GPS #NationalAdvisory #CORS`,
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
