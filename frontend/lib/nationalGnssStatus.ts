import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import { expectedAccuracy } from "./gnssForecastEngine";
import type { SpaceWeatherCurrent } from "./types";

export const NATIONAL_GNSS_CITY_ORDER = ["HARARE", "BULAWAYO", "MUTARE", "VICTORIA FALLS"] as const;

const CITY_DISPLAY: Record<string, string> = {
  HARARE: "Harare",
  BULAWAYO: "Bulawayo",
  MUTARE: "Mutare",
  "VICTORIA FALLS": "Victoria Falls",
};

const STATUS_EMOJI: Record<ForecastStatus, string> = {
  excellent: "🟢",
  moderate: "🟡",
  warning: "🔴",
};

const NATIONAL_SERVICES: Record<ForecastStatus, Record<string, string>> = {
  excellent: {
    Surveying: "GNSS NORMAL",
    Agriculture: "GNSS NORMAL",
    Mining: "GNSS NORMAL",
    Aviation: "GNSS NORMAL",
    "Power Grid": "LOW RISK",
  },
  moderate: {
    Surveying: "GNSS ADVISORY",
    Agriculture: "GNSS ADVISORY",
    Mining: "GNSS ADVISORY",
    Aviation: "GNSS ADVISORY",
    "Power Grid": "LOW–MODERATE",
  },
  warning: {
    Surveying: "GNSS CAUTION",
    Agriculture: "GNSS CAUTION",
    Mining: "GNSS CAUTION",
    Aviation: "GNSS CAUTION",
    "Power Grid": "MODERATE RISK",
  },
};

/** Maps Navigation News audience cards to National Services sector names. */
export const AUDIENCE_NATIONAL_SERVICE: Record<string, string> = {
  surveyors: "Surveying",
  farmers: "Agriculture",
  pilots: "Aviation",
  power: "Power Grid",
  telecom: "Telecommunications",
};

const TELECOM_SERVICE_STATUS: Record<ForecastStatus, string> = {
  excellent: "GNSS NORMAL",
  moderate: "GNSS ADVISORY",
  warning: "GNSS CAUTION",
};

const TONE_RANK: Record<ForecastStatus, number> = {
  excellent: 0,
  moderate: 1,
  warning: 2,
};

function worseTone(a: ForecastStatus, b: ForecastStatus): ForecastStatus {
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b;
}

export function nationalServiceStatusColor(label: string, tone: ForecastStatus): string {
  if (
    label === "GNSS CAUTION" ||
    label === "MODERATE RISK" ||
    label === "Limited" ||
    label === "Caution"
  ) {
    return "#ef4444";
  }
  if (label === "Monitor" || label === "LOW–MODERATE") return tone === "warning" ? "#ef4444" : "#eab308";
  if (label === "GNSS ADVISORY" || label === "Advisory") return "#eab308";
  if (tone === "warning") return "#ef4444";
  return "#00ff88";
}

export function getAudienceNationalServiceStatus(
  audienceId: string,
  tone: ForecastStatus,
  sectorTone?: ForecastStatus,
): { serviceName: string; statusLabel: string; effectiveTone: ForecastStatus } | null {
  const serviceName = AUDIENCE_NATIONAL_SERVICE[audienceId];
  if (!serviceName) return null;
  const effectiveTone = sectorTone ? worseTone(tone, sectorTone) : tone;
  if (audienceId === "telecom") {
    return { serviceName, statusLabel: TELECOM_SERVICE_STATUS[effectiveTone], effectiveTone };
  }
  const statusLabel = NATIONAL_SERVICES[effectiveTone][serviceName];
  if (!statusLabel) return null;
  return { serviceName, statusLabel, effectiveTone };
}

function forecastField(fc: GnssForecastCity, label: string): string | undefined {
  return fc.fields.find((f) => f.label === label)?.value;
}

/** Same Expected Accuracy ranges used in Navigation News forecast cards and surveyor briefs. */
function cityAccuracyLine(fc: GnssForecastCity): { emoji: string; value: string } {
  const fromField = forecastField(fc, "Expected Accuracy");
  const iono = fc.ionoStress ?? 50;
  const feed = fc.feedReliability ?? 50;
  return {
    emoji: STATUS_EMOJI[fc.status],
    value: fromField ?? expectedAccuracy(iono, feed),
  };
}

export function stormRiskLabel(sw: SpaceWeatherCurrent | null): string {
  if (sw?.kp == null) return "Updating";
  const kp = sw.kp;
  if (kp >= 9) return "G5 Extreme";
  if (kp >= 8) return "G4 Severe";
  if (kp >= 7) return "G3 Strong";
  if (kp >= 6) return "G2 Moderate";
  if (kp >= 5) return "G1 Minor Storm";
  if (kp >= 4) return "G0 Active (below G1)";
  if (kp >= 3) return "G0 Unsettled";
  return "G0 Quiet";
}

export interface NationalGnssStatusData {
  title: string;
  cities: { name: string; emoji: string; value: string }[];
  kp: string;
  stormRisk: string;
  services: { name: string; label: string; color: string }[];
}

export function buildNationalGnssStatusData(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
): NationalGnssStatusData {
  const byCity = Object.fromEntries(forecasts.map((f) => [f.city, f]));
  const cities = NATIONAL_GNSS_CITY_ORDER.flatMap((cityKey) => {
    const fc = byCity[cityKey];
    if (!fc) return [];
    const { emoji, value } = cityAccuracyLine(fc);
    return [{ name: CITY_DISPLAY[cityKey] ?? cityKey, emoji, value }];
  });

  const kp =
    sw?.kp != null
      ? `Kp = ${Number.isInteger(sw.kp) ? sw.kp : sw.kp}`
      : "Kp = Updating";

  const services = Object.entries(NATIONAL_SERVICES[tone]).map(([name, label]) => ({
    name,
    label,
    color: nationalServiceStatusColor(label, tone),
  }));

  return {
    title: "🇿🇼 ZIMBABWE NATIONAL GNSS STATUS",
    cities,
    kp,
    stormRisk: `Geomagnetic storm = ${stormRiskLabel(sw)}`,
    services,
  };
}

export function buildNationalGnssStatusBlock(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
): string {
  const data = buildNationalGnssStatusData(forecasts, tone, sw);
  const cityLines = data.cities.flatMap((c) => [`${c.emoji} ${c.name}`, c.value]);
  const serviceLines = data.services.flatMap((s) => [s.name, s.label]);

  return [
    data.title,
    "",
    "GNSS Accuracy Today",
    ...cityLines,
    "",
    "Current Space Weather",
    data.kp,
    data.stormRisk,
    "",
    "National Services",
    ...serviceLines,
  ].join("\n");
}
