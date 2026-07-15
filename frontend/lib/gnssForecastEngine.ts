import type { NavigationNewsBrief } from "./gnssAudienceNews";
import { buildAudienceNews } from "./gnssAudienceNews";
import type { SpaceWeatherCurrent, Station } from "./types";
import type {
  DigitalTwinSite,
  ForecastStatus,
  GnssPerformanceForecast,
  GnssPerformanceStage,
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
  { city: "BULAWAYO", displayName: "Bulawayo", stationCodes: ["bula"] },
  { city: "MUTARE", displayName: "Mutare", stationCodes: ["muta"] },
  { city: "GWERU", displayName: "Gweru", stationCodes: ["gwer"] },
  { city: "MASVINGO", displayName: "Masvingo", stationCodes: ["masv"] },
  { city: "KWEKWE", displayName: "Kwekwe", stationCodes: ["kwek"] },
  { city: "KARIBA", displayName: "Kariba", stationCodes: ["kari"] },
  { city: "VICTORIA FALLS", displayName: "Victoria Falls", stationCodes: ["vicf"] },
  { city: "KAROI", displayName: "Karoi", stationCodes: ["karo"] },
  { city: "CHIVHU", displayName: "Chivhu", stationCodes: ["chiv"] },
  { city: "CHIREDZI", displayName: "Chiredzi", stationCodes: ["chir"] },
  { city: "BEITBRIDGE", displayName: "Beitbridge", stationCodes: ["beit"] },
  { city: "BINGA", displayName: "Binga", stationCodes: ["bing"] },
  { city: "GOKWE", displayName: "Gokwe", stationCodes: ["gokw"] },
];

export interface GnssForecastBundle {
  forecasts: GnssForecastCity[];
  digitalTwin: DigitalTwinSite[];
  performanceForecast: GnssPerformanceForecast;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function averageFeedReliability(stations: Station[]): number {
  if (!stations.length) return 50;
  const values = stations.map(feedReliability);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function integrityLabel(score: number): GnssPerformanceForecast["integrityLabel"] {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 55) return "Moderate";
  return "Poor";
}

function advisoryForIntegrity(label: GnssPerformanceForecast["integrityLabel"]): string {
  if (label === "Excellent") return "Routine GNSS, RTK, PPP, and aviation monitoring can continue normally.";
  if (label === "Good") return "Continue operations, but keep live ionospheric and station-health checks visible.";
  if (label === "Moderate") return "Use dual-frequency checks, verify fixed solutions, and prefer morning survey windows.";
  return "Postpone precision RTK/PPP work where possible; verify navigation with independent methods.";
}

function buildPerformanceForecast(
  sw: SpaceWeatherCurrent | null,
  stations: Station[],
  forecasts: GnssForecastCity[],
): GnssPerformanceForecast {
  const kp = sw?.kp ?? 0;
  const dst = sw?.dst ?? 0;
  const s4 = sw?.s4 ?? 0;
  const wind = sw?.plasma_speed ?? 400;
  const vtec = sw?.mean_vtec ?? null;
  const iono = ionoStress(sw);
  const feed = averageFeedReliability(stations);
  const degradedCities = forecasts.filter((f) => f.status !== "excellent").length;
  const cityPenalty = forecasts.length ? (degradedCities / forecasts.length) * 18 : 6;

  const stormProbability = clamp(
    kp * 11 + Math.max(0, -dst - 35) * 0.32 + Math.max(0, wind - 450) * 0.09 + s4 * 28,
    2,
    98,
  );
  const expectedKp = clamp(kp + stormProbability / 55 + Math.max(0, wind - 550) / 350, 0, 9);
  const expectedDst = Math.round(dst - stormProbability * 1.15 - Math.max(0, wind - 500) * 0.08);

  const baseTec = vtec ?? clamp(10 + iono * 0.38, 8, 95);
  const tecGrowth = 1 + stormProbability / 230;
  const forecastTec30m = clamp(baseTec * (1 + stormProbability / 850), 0, 140);
  const forecastTec1h = clamp(baseTec * tecGrowth, 0, 160);
  const forecastTec6h = clamp(baseTec * (1 + stormProbability / 120), 0, 190);
  const forecastTec24h = clamp(baseTec * (1 + stormProbability / 180), 0, 180);

  const rotiCurrent = clamp(0.05 + iono / 95 + s4 * 0.75, 0.02, 2.5);
  const roti30m = clamp(rotiCurrent + stormProbability / 160, 0.02, 3.5);
  const roti1h = clamp(rotiCurrent + stormProbability / 105, 0.02, 4.0);
  const scintillationProbability = clamp(s4 * 120 + roti1h * 24 + Math.max(0, expectedKp - 4) * 8, 3, 98);
  const cycleSlipProbability = clamp(scintillationProbability * 0.58 + roti1h * 12 + (100 - feed) * 0.22, 2, 96);
  const expectedCycleSlipsPerHour = clamp(cycleSlipProbability / 6.2, 0.2, 28);
  const pppConvergenceMinutes = clamp(16 + roti1h * 17 + cycleSlipProbability * 0.24, 12, 90);
  const horizontalErrorM = clamp(0.18 + roti1h * 0.62 + cycleSlipProbability / 115 + (100 - feed) / 190, 0.15, 8);
  const verticalErrorM = clamp(horizontalErrorM * 1.85 + forecastTec1h / 85, 0.25, 15);
  const integrityIndex = Math.round(clamp(100 - iono * 0.34 - roti1h * 8 - s4 * 20 - (100 - feed) * 0.18 - cityPenalty, 0, 100));
  const label = integrityLabel(integrityIndex);

  const stages: GnssPerformanceStage[] = [
    {
      stage: "1",
      title: "Solar wind monitoring",
      output: `${Math.round(wind)} km/s solar wind`,
      detail: `Kp ${kp.toFixed(1)}, Dst ${dst} nT, S4 ${s4.toFixed(2)} feed the disturbance model.`,
      confidence: sw ? 82 : 45,
    },
    {
      stage: "2",
      title: "Storm probability",
      output: `${Math.round(stormProbability)}% next 6 h`,
      detail: `Expected Kp ${round(expectedKp, 1)} and Dst ${expectedDst} nT from current forcing.`,
      confidence: sw ? 76 : 42,
    },
    {
      stage: "3",
      title: "TEC forecast",
      output: `${round(forecastTec1h, 1)} TECU in 1 h`,
      detail: `Now ${vtec != null ? `${vtec.toFixed(1)} TECU` : "estimated"}; 6 h ${round(forecastTec6h, 1)} TECU.`,
      confidence: vtec != null ? 72 : 52,
    },
    {
      stage: "4",
      title: "ROTI forecast",
      output: `${round(roti1h, 2)} TECU/min in 1 h`,
      detail: `Turbulence rises from ${round(rotiCurrent, 2)} to ${round(roti30m, 2)} in 30 min.`,
      confidence: 64,
    },
    {
      stage: "5",
      title: "Scintillation probability",
      output: `${Math.round(scintillationProbability)}%`,
      detail: "Combines S4, ROTI, storm level, and local ionospheric stress.",
      confidence: sw?.s4 != null ? 68 : 50,
    },
    {
      stage: "6",
      title: "Cycle-slip probability",
      output: `${Math.round(cycleSlipProbability)}%`,
      detail: `${round(expectedCycleSlipsPerHour, 1)} expected slips/hour for vulnerable carrier-phase users.`,
      confidence: 58,
    },
    {
      stage: "7",
      title: "PPP convergence",
      output: `${Math.round(pppConvergenceMinutes)} min`,
      detail: "Longer convergence is expected as ROTI and cycle-slip probability increase.",
      confidence: 60,
    },
    {
      stage: "8",
      title: "Position error",
      output: `${round(horizontalErrorM, 2)} m H / ${round(verticalErrorM, 2)} m V`,
      detail: "Operational estimate for degraded GNSS conditions, not a certified navigation value.",
      confidence: 57,
    },
    {
      stage: "9",
      title: "GNSS integrity index",
      output: `${integrityIndex}/100 ${label}`,
      detail: "Weighted from TEC, ROTI, S4, cycle-slip risk, CORS health, and city forecast degradation.",
      confidence: 70,
    },
    {
      stage: "10",
      title: "Operational advisory",
      output: label,
      detail: advisoryForIntegrity(label),
      confidence: 74,
    },
  ];

  return {
    stormProbability: Math.round(stormProbability),
    expectedKp: round(expectedKp, 1),
    expectedDst,
    currentTec: vtec,
    forecastTec30m: round(forecastTec30m, 1),
    forecastTec1h: round(forecastTec1h, 1),
    forecastTec6h: round(forecastTec6h, 1),
    forecastTec24h: round(forecastTec24h, 1),
    rotiCurrent: round(rotiCurrent, 2),
    roti30m: round(roti30m, 2),
    roti1h: round(roti1h, 2),
    scintillationProbability: Math.round(scintillationProbability),
    cycleSlipProbability: Math.round(cycleSlipProbability),
    expectedCycleSlipsPerHour: round(expectedCycleSlipsPerHour, 1),
    pppConvergenceMinutes: Math.round(pppConvergenceMinutes),
    horizontalErrorM: round(horizontalErrorM, 2),
    verticalErrorM: round(verticalErrorM, 2),
    integrityIndex,
    integrityLabel: label,
    advisory: advisoryForIntegrity(label),
    stages,
  };
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

export function expectedAccuracy(iono: number, feed: number): string {
  const stress = iono * 0.6 + (100 - feed) * 0.4;
  if (stress < 20) return "1–2 cm";
  if (stress < 40) return "3–5 cm";
  if (stress < 55) return "5–10 cm";
  if (stress < 70) return "10–20 cm";
  return "> 20 cm";
}

export function accuracyCmDisplay(iono: number, feed: number, status: ForecastStatus): string {
  if (status === "warning") return "Warning";
  const stress = iono * 0.6 + (100 - feed) * 0.4;
  const cm = 0.8 + stress * 0.29;
  if (cm >= 10) return `${Math.round(cm)} cm`;
  const rounded = Math.round(cm * 10) / 10;
  return rounded === Math.round(rounded) ? `${Math.round(rounded)} cm` : `${rounded.toFixed(1)} cm`;
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
    ionoStress: iono,
    feedReliability: feed,
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
  const performanceForecast = buildPerformanceForecast(sw, safeStations, forecasts);

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
    performanceForecast,
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
