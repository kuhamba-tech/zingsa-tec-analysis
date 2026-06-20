import type { NavigationNewsBrief } from "./gnssAudienceNews";
import { buildAudienceNews } from "./gnssAudienceNews";
import type { SpaceWeatherCurrent, Station } from "./types";
import type {
  DigitalTwinSite,
  ForecastStatus,
  GnssForecastCity,
} from "./gnssWeatherIntelligence";

export interface ForecastSiteConfig {
  city: string;
  displayName: string;
  stationCodes: string[];
}

/** Representative CORS sites routed to headline forecast cities. */
export const FORECAST_SITES: ForecastSiteConfig[] = [
  { city: "HARARE", displayName: "Harare", stationCodes: ["hara", "zinh", "hacy"] },
  { city: "MUTARE", displayName: "Mutare", stationCodes: ["muta"] },
  { city: "VICTORIA FALLS", displayName: "Victoria Falls", stationCodes: ["vicf"] },
];

export interface GnssForecastBundle {
  forecasts: GnssForecastCity[];
  digitalTwin: DigitalTwinSite[];
  audienceNews: NavigationNewsBrief[];
  sources: {
    spaceWeather: boolean;
    corsStations: boolean;
    ntripProbe: boolean;
  };
  computedAt: string;
  inputSummary: string;
}

const STATUS_EMOJI: Record<ForecastStatus, string> = {
  excellent: "🟢",
  moderate: "🟡",
  warning: "🟠",
};

function normCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function pickStation(stations: Station[], codes: string[]): Station | null {
  const byCode = new Map(
    stations
      .filter((s) => normCode(s?.code))
      .map((s) => [normCode(s.code), s]),
  );
  const candidates = codes.map((c) => byCode.get(normCode(c))).filter(Boolean) as Station[];
  if (candidates.length === 0) return null;

  const rank = (s: Station): number => {
    if (s.ntrip_verdict === "msm_streaming") return 0;
    if (s.status === "online" && s.ntrip_verdict !== "rtcm_no_msm") return 1;
    if (s.ntrip_verdict === "rtcm_no_msm") return 2;
    if (s.status === "degraded") return 3;
    return 4;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0];
}

function ionoStress(sw: SpaceWeatherCurrent | null): number {
  if (!sw) return 50;
  let score = 0;
  const kp = sw.kp ?? 0;
  const s4 = sw.s4 ?? 0;
  const dst = sw.dst ?? 0;
  const wind = sw.plasma_speed ?? 400;

  if (kp >= 7) score += 45;
  else if (kp >= 5) score += 32;
  else if (kp >= 4) score += 22;
  else if (kp >= 3) score += 12;

  if (s4 >= 0.5) score += 35;
  else if (s4 >= 0.3) score += 22;
  else if (s4 >= 0.1) score += 10;

  if (dst <= -100) score += 15;
  else if (dst <= -50) score += 8;

  if (wind > 600) score += 12;
  else if (wind > 450) score += 6;

  const risk = normCode(sw.gnss_risk);
  if (risk === "critical" || risk === "high") score += 18;
  else if (risk === "moderate") score += 8;

  return Math.min(100, score);
}

function feedReliability(station: Station | null): number {
  if (!station) return 0;
  if (station.ntrip_verdict === "msm_streaming") return 96;
  if (station.ntrip_verdict === "rtcm_no_msm") return 48;
  if (station.ntrip_verdict === "connected_no_data") return 28;
  if (station.status === "online") return 72;
  if (station.status === "degraded") return 45;
  return 12;
}

function combinedStatus(iono: number, feed: number): ForecastStatus {
  const blended = iono * 0.55 + (100 - feed) * 0.45;
  if (blended >= 55) return "warning";
  if (blended >= 28) return "moderate";
  return "excellent";
}

function statusLabel(status: ForecastStatus): string {
  if (status === "excellent") return "Excellent";
  if (status === "moderate") return "Moderate";
  return "Warning";
}

function expectedAccuracy(iono: number, feed: number): string {
  const stress = iono * 0.6 + (100 - feed) * 0.4;
  if (stress < 20) return "1–2 cm";
  if (stress < 40) return "3–5 cm";
  if (stress < 55) return "5–10 cm";
  if (stress < 70) return "10–20 cm";
  return "> 20 cm";
}

function surveyWindow(iono: number): string {
  return iono >= 40 ? "07:00 – 11:00" : "07:00 – 14:00";
}

function satelliteNote(station: Station | null): string {
  if (!station) return "No CORS feed";
  const n = station.constellations?.length ?? 0;
  const msm = station.ntrip_verdict === "msm_streaming";
  if (msm && n >= 3) return `Good geometry (${n} constellations, MSM live)`;
  if (msm) return "MSM observations live";
  if (n >= 2) return `${n} constellations — RTCM without MSM`;
  return station.site_status_label ?? station.status;
}

function buildCause(sw: SpaceWeatherCurrent | null, station: Station | null): string | undefined {
  const parts: string[] = [];
  if (sw?.kp != null) parts.push(`Kp ${sw.kp.toFixed(1)} (${sw.kp_condition ?? "geomagnetic"})`);
  if (sw?.s4 != null) parts.push(`S4 ${sw.s4.toFixed(2)}`);
  if (sw?.dst != null) parts.push(`Dst ${sw.dst >= 0 ? "+" : ""}${sw.dst} nT`);
  if (station?.ntrip_verdict) {
    parts.push(`NTRIP ${station.ntrip_verdict.replace(/_/g, " ")} @ ${normCode(station.code).toUpperCase()}`);
  } else if (station) {
    parts.push(`CORS ${station.status} (${station.status_source ?? "unknown"})`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildRecommendation(status: ForecastStatus, station: Station | null): string | undefined {
  if (status === "excellent") return undefined;
  if (station?.ntrip_verdict === "rtcm_no_msm") {
    return "Caster connected but no MSM — verify receiver/caster MSM output";
  }
  if (status === "warning") return "Postpone precision RTK/drone ops; use dual-frequency validation";
  return "Use network correction and monitor live space-weather indices";
}

function buildEffects(status: ForecastStatus, iono: number): string[] | undefined {
  if (status !== "warning") return undefined;
  const effects = ["Longer RTK fixing time", "Reduced accuracy"];
  if (iono >= 60) effects.push("Drone mapping risk");
  if (iono >= 45) effects.push("Elevated after 16:00 local (afternoon scintillation window)");
  return effects;
}

function buildForecast(
  site: ForecastSiteConfig,
  station: Station | null,
  sw: SpaceWeatherCurrent | null,
): GnssForecastCity {
  const iono = ionoStress(sw);
  const feed = feedReliability(station);
  const status = combinedStatus(iono, feed);
  const rtkPct = Math.round(Math.max(5, Math.min(99, feed - iono * 0.35)));

  const fields: { label: string; value: string }[] = [
    { label: "GNSS Condition", value: statusLabel(status) },
    { label: "RTK Reliability", value: `${rtkPct}%` },
    { label: "Expected Accuracy", value: expectedAccuracy(iono, feed) },
    { label: "Best Survey Window", value: surveyWindow(iono) },
    { label: "Satellites", value: satelliteNote(station) },
  ];

  if (station?.current_tec != null && station.current_tec > 0) {
    fields.push({ label: "VTEC (station)", value: `${station.current_tec.toFixed(1)} TECU` });
  }
  const siteCode = station ? normCode(station.code) : "";
  if (siteCode) {
    fields.push({ label: "CORS site", value: siteCode.toUpperCase() });
  }

  return {
    city: site.city,
    emoji: STATUS_EMOJI[status],
    status,
    statusLabel: statusLabel(status),
    fields,
    cause: buildCause(sw, station),
    recommendation: buildRecommendation(status, station),
    effects: buildEffects(status, iono),
  };
}

function buildDigitalTwin(
  site: ForecastSiteConfig,
  station: Station | null,
  sw: SpaceWeatherCurrent | null,
): DigitalTwinSite {
  const iono = ionoStress(sw);
  const feed = feedReliability(station);
  const status = combinedStatus(iono, feed);
  const confidence = `${Math.round(Math.max(40, Math.min(97, 100 - iono * 0.5)))}%`;

  const recommendations: string[] = [];
  if (status === "moderate") {
    recommendations.push("Survey: morning preferred");
    recommendations.push("Drone: medium risk");
    recommendations.push("Transport: normal");
  }
  if (status === "warning") {
    recommendations.push("Survey: avoid afternoon window");
    recommendations.push("Drone: high risk after 16:00");
    recommendations.push("Transport: verify fixes");
  }

  return {
    city: site.displayName,
    status,
    statusLabel:
      station?.ntrip_verdict === "msm_streaming"
        ? "MSM streaming"
        : station?.ntrip_verdict === "rtcm_no_msm"
          ? "Connected — no MSM"
          : statusLabel(status),
    rtk:
      station?.ntrip_verdict === "msm_streaming"
        ? "Available"
        : station?.ntrip_verdict === "rtcm_no_msm"
          ? "Degraded — RTCM only"
          : feed >= 60
            ? "Catalog online"
            : "Limited",
    accuracy: expectedAccuracy(iono, feed),
    confidence,
    reason: iono >= 35 ? "Elevated ionospheric stress index" : undefined,
    cause: buildCause(sw, station),
    recommendations,
  };
}

export function buildGnssForecastBundle(
  sw: SpaceWeatherCurrent | null,
  stations: Station[],
): GnssForecastBundle {
  const safeStations = Array.isArray(stations) ? stations : [];
  const forecasts = FORECAST_SITES.map((site) => {
    const station = pickStation(safeStations, site.stationCodes);
    return buildForecast(site, station, sw);
  });

  const digitalTwin = FORECAST_SITES.map((site) => {
    const station = pickStation(safeStations, site.stationCodes);
    return buildDigitalTwin(site, station, sw);
  });

  const hasSw = sw != null && (sw.kp != null || sw.s4 != null || sw.gnss_risk != null);
  const hasCors = safeStations.length > 0;
  const hasNtrip = safeStations.some((s) => Boolean(s.ntrip_verdict));

  const parts: string[] = [];
  if (hasSw) {
    parts.push(
      `Space weather: Kp ${sw?.kp?.toFixed(1) ?? "N/A"}, S4 ${sw?.s4?.toFixed(2) ?? "N/A"}, risk ${sw?.gnss_risk ?? "N/A"}`,
    );
  }
  if (hasCors) {
    const msm = safeStations.filter((s) => s.ntrip_verdict === "msm_streaming").length;
    parts.push(`CORS/NTRIP: ${safeStations.length} sites probed, ${msm} MSM streaming`);
  }

  const computedAt = new Date().toISOString();

  return {
    forecasts,
    digitalTwin,
    audienceNews: buildAudienceNews(forecasts, computedAt, sw),
    sources: {
      spaceWeather: hasSw,
      corsStations: hasCors,
      ntripProbe: hasNtrip,
    },
    computedAt,
    inputSummary: parts.join(" · ") || "Awaiting live feeds",
  };
}
