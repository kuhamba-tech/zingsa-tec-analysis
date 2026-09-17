/**
 * Compact "So what?" recommendations per sector — derived from live CORS + space weather.
 * Not a separate ML model; rule-based fusion of the same inputs as Navigation News briefs.
 */
import { effectiveNavigationTone } from "./gnssAudienceNews";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import type { GicStatusResponse, SpaceWeatherCurrent } from "./types";
import {
  formatPowerIndicesDetail,
  formatTelecomIndicesDetail,
  noaaGScaleFromKp,
  formatKpDisplay,
  formatVtecDisplay,
} from "./spaceWeatherMetrics";

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

function surveyorDetail(city: GnssForecastCity | undefined, sw: SpaceWeatherCurrent | null): string | undefined {
  const g = noaaGScaleFromKp(sw?.kp);
  const why = `Why this status? ${g.display} globally · Zimbabwe VTEC ${formatVtecDisplay(sw?.mean_vtec)} · ΔTEC/ROTI pending · provisional GNSS risk ${sw?.gnss_risk ?? "N/A"}`;
  if (!city) return why;
  const accuracy = field(city, "Expected Accuracy");
  const rtk = field(city, "RTK Reliability");
  const window = field(city, "Best Survey Window") ?? "07:00 – 14:00";
  if (!accuracy) {
    return `Survey window ${window} · ${why}`;
  }
  if (city.status === "warning") {
    return `Expected accuracy ${accuracy} · ${why}`;
  }
  const parts = [`Expected accuracy ${accuracy}`];
  if (rtk) parts.push(`RTK ${rtk}`);
  parts.push(`Window ${window}`);
  parts.push(why);
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
  const g = noaaGScaleFromKp(kp);
  const levels = (gic?.stations ?? [])
    .map((s) => (s.latest_level ?? "").toLowerCase())
    .filter(Boolean);

  if (levels.some((l) => l === "severe" || l === "high" || l === "large")) {
    return "Power utilities — GIC warning: check transformer neutrals and long HV lines.";
  }
  if (
    (kp != null && kp >= 7) ||
    (dst != null && dst <= -100) ||
    levels.some((l) => l === "elevated")
  ) {
    return `Power utilities — elevated GIC watch (${g.display}). Monitor long transmission corridors.`;
  }
  if (g.isStorm || (dst != null && dst <= -50)) {
    return `Power utilities — ${g.display} globally; keep routine GIC watch (geomagnetic ≠ automatic grid fault).`;
  }
  return `Power utilities — ${g.display}; no GIC warning from available monitors.`;
}

function telecomNote(sw: SpaceWeatherCurrent | null, tone: ForecastStatus): string {
  const s4 = sw?.s4;
  const kp = sw?.kp;
  const g = noaaGScaleFromKp(kp);
  if (tone === "warning" || (s4 != null && s4 >= 0.5) || (kp != null && kp >= 6)) {
    return `Telecommunications — timing holds may degrade (${g.display}). Verify GNSS-disciplined clocks and PTP.`;
  }
  if (tone === "moderate" || (s4 != null && s4 >= 0.25)) {
    return `Telecommunications — minor timing jitter possible (${g.display}). GNSS risk remains provisional.`;
  }
  return `Telecommunications — timing stable (${g.display}).`;
}

const SURVEYOR_HEADLINE: Record<ForecastStatus, string> = {
  excellent: "Surveying — GNSS NORMAL. RTK conditions favourable.",
  moderate: "Surveying — GNSS ADVISORY. Allow extra RTK occupation time.",
  warning: "Surveying — GNSS CAUTION. Delay centimetre-critical work.",
};

const FARMER_HEADLINE: Record<ForecastStatus, string> = {
  excellent: "Precision agriculture — GNSS NORMAL. Autosteer favourable.",
  moderate: "Precision agriculture — GNSS ADVISORY. Prefer morning field GPS.",
  warning: "Precision agriculture — GNSS CAUTION. Verify boundaries before legal decisions.",
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

  const surveyDetail = surveyorDetail(surveyCity, sw);
  const farmerWindow = field(harare, "Best Survey Window");
  const g = noaaGScaleFromKp(sw?.kp);
  const farmerWhy = `Why this status? ${g.display} · VTEC ${formatVtecDisplay(sw?.mean_vtec)} · provisional GNSS risk ${sw?.gnss_risk ?? "N/A"}`;

  const recommendations: AiAudienceRecommendation[] = [
    {
      id: "surveyors",
      label: "Surveying",
      icon: "📐",
      headline: SURVEYOR_HEADLINE[surveyStatus],
      detail: surveyDetail,
      tone: surveyStatus,
    },
    {
      id: "farmers",
      label: "Precision Agriculture",
      icon: "🌾",
      headline: FARMER_HEADLINE[farmerStatus],
      detail:
        farmerStatus === "excellent"
          ? farmerWhy
          : farmerWindow
            ? `Preferred window ${farmerWindow} · ${farmerWhy}`
            : farmerWhy,
      tone: farmerStatus,
    },
    {
      id: "pilots",
      label: "Aviation & Drones",
      icon: "✈️",
      headline:
        tone === "excellent"
          ? "Aviation / drones — GNSS NORMAL. Routine navigation expected."
          : tone === "moderate"
            ? "Aviation / drones — GNSS ADVISORY. Monitor GPS approaches through the afternoon."
            : "Aviation / drones — GNSS CAUTION. Verify navaid backups.",
      detail: `${scintillationPilotNote(sw, tone)} Why this status? ${g.display} (Kp ${formatKpDisplay(sw?.kp)}) · provisional GNSS risk ${sw?.gnss_risk ?? "N/A"} — not automatic from Kp alone.`,
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
