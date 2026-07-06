/**
 * Compact "So what?" recommendations per sector — derived from live CORS + space weather.
 * Not a separate ML model; rule-based fusion of the same inputs as Navigation News briefs.
 */
import { effectiveNavigationTone } from "./gnssAudienceNews";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import type { GicStatusResponse, SpaceWeatherCurrent } from "./types";
import { formatPowerIndicesDetail, formatTelecomIndicesDetail } from "./spaceWeatherMetrics";

export type AiRecommendationAudience =
  | "surveyors"
  | "farmers"
  | "pilots"
  | "power"
  | "telecom";

export interface AiAudienceRecommendation {
  id: AiRecommendationAudience;
  label: string;
  icon: string;
  headline: string;
  detail?: string;
  tone: ForecastStatus;
}

export interface AiRecommendationResult {
  recommendations: AiAudienceRecommendation[];
  tone: ForecastStatus;
  computedAt: string | null;
}

function field(city: GnssForecastCity | undefined, label: string): string | undefined {
  return city?.fields.find((f) => f.label === label)?.value;
}

function surveyorDetail(city: GnssForecastCity | undefined): string | undefined {
  if (!city) return undefined;
  const accuracy = field(city, "Expected Accuracy");
  const rtk = field(city, "RTK Reliability");
  const window = field(city, "Best Survey Window") ?? "07:00 – 14:00";
  if (!accuracy) {
    return window ? `Survey window ${window}` : undefined;
  }
  if (city.status === "warning") {
    return `Expected accuracy ${accuracy}`;
  }
  const parts = [`Expected accuracy ${accuracy}`];
  if (rtk) parts.push(`RTK ${rtk}`);
  parts.push(`Window ${window}`);
  return parts.join(" · ");
}

function scintillationPilotNote(sw: SpaceWeatherCurrent | null, tone: ForecastStatus): string {
  const s4 = sw?.s4;
  if (tone === "warning" || (s4 != null && s4 >= 0.5)) {
    return "Significant scintillation possible 16:00–21:00 local — monitor RAIM and HF.";
  }
  if (tone === "moderate" || (s4 != null && s4 >= 0.15)) {
    return "Minor scintillation possible after 18:00 local.";
  }
  return "En-route GNSS within normal limits today.";
}

function powerGicNote(sw: SpaceWeatherCurrent | null, gic: GicStatusResponse | null): string {
  const kp = sw?.kp;
  const dst = sw?.dst;
  const levels = (gic?.stations ?? [])
    .map((s) => (s.latest_level ?? "").toLowerCase())
    .filter(Boolean);

  if (levels.some((l) => l === "severe" || l === "high" || l === "large")) {
    return "GIC warning — elevated transformer-neutral currents detected.";
  }
  if (
    (kp != null && kp >= 7) ||
    (dst != null && dst <= -100) ||
    levels.some((l) => l === "elevated")
  ) {
    return "Elevated GIC risk — increase monitoring on long transmission lines.";
  }
  if ((kp != null && kp >= 5) || (dst != null && dst <= -50)) {
    return "Routine GIC monitoring — minor geomagnetic disturbance under way.";
  }
  return "No GIC warning.";
}

function telecomNote(sw: SpaceWeatherCurrent | null, tone: ForecastStatus): string {
  const s4 = sw?.s4;
  const kp = sw?.kp;
  if (tone === "warning" || (s4 != null && s4 >= 0.5) || (kp != null && kp >= 6)) {
    return "Timing holds may degrade — verify GNSS-disciplined clocks and PTP.";
  }
  if (tone === "moderate" || (s4 != null && s4 >= 0.25)) {
    return "Minor timing jitter possible this afternoon on GNSS-linked links.";
  }
  return "Timing stable.";
}

const SURVEYOR_HEADLINE: Record<ForecastStatus, string> = {
  excellent: "Proceed.",
  moderate: "Allow extra RTK occupation time.",
  warning: "Delay centimetre-critical surveys.",
};

const FARMER_HEADLINE: Record<ForecastStatus, string> = {
  excellent: "Good day for precision planting.",
  moderate: "Plan GPS-heavy field work before late morning.",
  warning: "Verify boundaries before legal or financial commitments.",
};

export function buildAiRecommendations(
  forecasts: GnssForecastCity[],
  sw: SpaceWeatherCurrent | null,
  gic: GicStatusResponse | null = null,
  computedAt: string | null = null,
): AiRecommendationResult {
  const tone = effectiveNavigationTone(forecasts, sw);
  const harare = forecasts.find((f) => f.city === "HARARE");
  const mutare = forecasts.find((f) => f.city === "MUTARE");
  const surveyCity = mutare ?? harare;
  const surveyStatus = surveyCity?.status ?? tone;
  const farmerStatus = harare?.status ?? tone;

  const surveyDetail = surveyorDetail(surveyCity);
  const farmerWindow = field(harare, "Best Survey Window");

  const recommendations: AiAudienceRecommendation[] = [
    {
      id: "surveyors",
      label: "Surveyors",
      icon: "📐",
      headline: SURVEYOR_HEADLINE[surveyStatus],
      detail: surveyDetail,
      tone: surveyStatus,
    },
    {
      id: "farmers",
      label: "Farmers",
      icon: "🌾",
      headline: FARMER_HEADLINE[farmerStatus],
      detail:
        farmerStatus === "excellent"
          ? undefined
          : farmerWindow
            ? `Preferred window ${farmerWindow}`
            : undefined,
      tone: farmerStatus,
    },
    {
      id: "pilots",
      label: "Pilots",
      icon: "✈️",
      headline:
        tone === "excellent"
          ? "Routine GNSS navigation expected."
          : tone === "moderate"
            ? "Monitor GPS approaches through the afternoon."
            : "Storm procedures — verify navaid backups.",
      detail: scintillationPilotNote(sw, tone),
      tone,
    },
    {
      id: "power",
      label: "Power Utilities",
      icon: "⚡",
      headline: powerGicNote(sw, gic),
      detail: formatPowerIndicesDetail(sw),
      tone,
    },
    {
      id: "telecom",
      label: "Telecommunications",
      icon: "📡",
      headline: telecomNote(sw, tone),
      detail: formatTelecomIndicesDetail(sw),
      tone,
    },
  ];

  return {
    recommendations,
    tone,
    computedAt,
  };
}
