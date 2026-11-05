import { spaceWeatherFloor, type AudienceId } from "./gnssAudienceNews";
import type { SolarActivityFull, SpaceWeatherCurrent } from "./types";
import {
  ZINGSA_NAVIGATION_MODERATE_ACTION,
  ZINGSA_NAVIGATION_WARNING_ACTION,
  ZINGSA_WEBSITE,
} from "./zingsaContact";

export const ADVISORY_AUDIENCES = [
  "citizen",
  "farmer",
  "surveyor",
  "driver",
  "aviation",
  "scientist",
] as const satisfies readonly AudienceId[];

export const PUBLIC_SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://zingsa-gnss-tec.vercel.app"
).replace(/\/$/, "");

const CATEGORY: Record<AudienceId, { title: string; category: string }> = {
  citizen: { title: "For everyone", category: "Public navigation" },
  farmer: { title: "Farming and field GPS", category: "Agriculture" },
  surveyor: { title: "Survey and RTK", category: "Survey" },
  driver: { title: "Road navigation", category: "Transport" },
  aviation: { title: "Aviation awareness", category: "Aviation" },
  scientist: { title: "Scientific readout", category: "Monitoring" },
};

export interface AdvisoryCard {
  id: AudienceId;
  title: string;
  category: string;
  severity: "Routine" | "Watch" | "Warning" | "Unavailable";
  publishedLabel: string;
  headline: string;
  indicators: string[];
  impact: string;
  action: string;
  url: string;
  shareText: string;
}

export function isAdvisoryAudience(value: string): value is AudienceId {
  return (ADVISORY_AUDIENCES as readonly string[]).includes(value);
}

export function advisoryPath(id: AudienceId): string {
  return `/navigation-news/${id}/`;
}

export function advisoryUrl(id: AudienceId): string {
  return `${PUBLIC_SITE_ORIGIN}${advisoryPath(id)}`;
}

export function formatHarare(iso: string | null | undefined): string {
  if (!iso) return "Time unavailable";
  const normalised = /Z|[+-]\d{2}:?\d{2}$/i.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(normalised);
  if (!Number.isFinite(ms)) return "Time unavailable";
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Harare",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return `${label} CAT`;
}

function num(value: number | null | undefined, digits: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(digits);
}

function shown(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text || "unavailable";
}

function severityOf(sw: SpaceWeatherCurrent | null): AdvisoryCard["severity"] {
  const measured = sw != null && (sw.kp != null || sw.dst != null || sw.mean_vtec != null || sw.s4 != null);
  if (!measured) return "Unavailable";
  const tone = spaceWeatherFloor(sw);
  if (tone === "warning") return "Warning";
  if (tone === "moderate") return "Watch";
  return "Routine";
}

function impactOf(severity: AdvisoryCard["severity"]): string {
  if (severity === "Unavailable") {
    return "The indices for this bulletin did not load. No condition is classified, and this is not an all-clear.";
  }
  if (severity === "Warning") {
    return "Measured indices meet this platform's warning floor. Positioning may be disturbed. This is not confirmation that a receiver has failed.";
  }
  if (severity === "Watch") {
    return "Measured indices are elevated. Everyday GNSS can continue with extra checks. This is not a confirmed outage.";
  }
  return "Measured indices are below this platform's watch floor. No positioning failure is claimed from these readings.";
}

function actionOf(id: AudienceId, severity: AdvisoryCard["severity"]): string {
  if (severity === "Unavailable") {
    return "Open the space-weather monitor before making an operational decision. A missing bulletin is not an all-clear.";
  }
  if (id === "citizen") {
    if (severity === "Warning") return ZINGSA_NAVIGATION_WARNING_ACTION;
    if (severity === "Watch") return ZINGSA_NAVIGATION_MODERATE_ACTION;
    return "No extra action. Use maps as usual, and open this advisory again if a warning is published.";
  }
  if (id === "farmer") {
    return "Pause auto-steer if a line jumps or corrections drop. This bulletin does not give a regional reliability percentage.";
  }
  if (id === "surveyor") {
    return "Check a known control point, the fix type, and the correction age. Centimetre reliability is not verified from these indices alone.";
  }
  if (id === "driver") {
    return "If the map pin disagrees with the road, follow the road. This bulletin does not report a measured navigation outage.";
  }
  if (id === "aviation") {
    return "This is situational awareness only. Follow the operator's approved procedure and official aviation advisories.";
  }
  return "Quote each index with its time and source. Do not turn a missing regional TEC value into a north, central, or south classification.";
}

/** Measured bulletin. Missing feeds stay unavailable. No TEC, RTK, or regional forecast is filled in. */
export function buildMeasuredAdvisory(
  sw: SpaceWeatherCurrent | null,
  solar: SolarActivityFull | null,
  audience: AudienceId,
): AdvisoryCard {
  const meta = CATEGORY[audience];
  const severity = severityOf(sw);
  const wind = solar?.solar_wind;
  const speed = num(wind?.speed ?? sw?.plasma_speed, 0);
  const density = num(wind?.density, 1);
  const bz = num(wind?.bz, 1);
  const kp = num(sw?.kp, 1);
  const dst = num(sw?.dst, 0);
  const vtec = num(sw?.mean_vtec, 1);
  const s4 = num(sw?.s4, 2);
  const indicators = [
    `Solar activity: ${shown(solar?.activity_label)}`,
    `GOES X-ray class: ${shown(solar?.flare_class)}`,
    `Solar wind speed: ${speed ? `${speed} km/s` : "unavailable"}`,
    `Solar wind density: ${density ? `${density} p/cm³` : "unavailable"}`,
    `IMF Bz: ${bz ? `${bz} nT, measured at L1 and not a Zimbabwe observation` : "unavailable"}`,
    `Kp: ${kp ? `${kp}${sw?.kp_condition ? ` (${sw.kp_condition})` : ""}` : "unavailable"}`,
    `Dst: ${dst ? `${dst} nT` : "unavailable"}`,
    `Zimbabwe network VTEC: ${vtec ? `${vtec} TECU, network mean` : "unavailable"}`,
    `Scintillation S4: ${s4 ?? "unavailable"}`,
    `Estimated GNSS risk: ${shown(sw?.gnss_risk)} (platform estimate, not a confirmed failure)`,
    sw?.stations_online != null && sw.stations_total != null
      ? `CORS reporting in this snapshot: ${sw.stations_online} of ${sw.stations_total}`
      : "CORS reporting in this snapshot: unavailable",
    "Northern, Central and Southern Zimbabwe: unavailable. A national mean is not a regional forecast.",
    "Forecast: not issued on this bulletin.",
  ];
  const publishedLabel = formatHarare(sw?.updated_utc ?? solar?.updated ?? null);
  const impact = impactOf(severity);
  const action = actionOf(audience, severity);
  const url = advisoryUrl(audience);
  const headline = `${severity} navigation advisory for Zimbabwe`;
  const shareText = [
    "ZINGSA Navigation News",
    meta.title,
    publishedLabel,
    `Category: ${meta.category}`,
    `Severity: ${severity}`,
    "",
    headline,
    "",
    "Measured conditions:",
    ...indicators.map((line) => `• ${line}`),
    "",
    `Possible impact: ${impact}`,
    `What to do: ${action}`,
    "",
    `Full advisory: ${url}`,
    ZINGSA_WEBSITE,
  ].join("\n");

  return {
    id: audience,
    title: meta.title,
    category: meta.category,
    severity,
    publishedLabel,
    headline,
    indicators,
    impact,
    action,
    url,
    shareText,
  };
}

export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}
