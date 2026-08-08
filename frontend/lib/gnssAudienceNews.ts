import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import {
  ZINGSA_BROADCAST_FOOTER,
  ZINGSA_NAVIGATION_CHANNELS,
  ZINGSA_NAVIGATION_MODERATE_ACTION,
  ZINGSA_NAVIGATION_WARNING_ACTION,
  ZINGSA_PHONE,
} from "./zingsaContact";

export type AudienceId = "farmer" | "surveyor" | "citizen" | "driver" | "aviation" | "scientist";

export interface NavigationNewsBrief {
  id: AudienceId;
  icon: string;
  title: string;
  audience: string;
  headline: string;
  summary: string;
  /** Plain-language space weather context — what is happening above us today */
  spaceWeatherToday: string;
  spaceWeatherBullets: string[];
  bullets: string[];
  action: string;
  statusTone: ForecastStatus;
  broadcastScript: string;
  socialScript: string;
  channels: string[];
}

interface SpaceWeatherLayman {
  headline: string;
  explainer: string;
  readout: string[];
  impact: string;
}

function byCity(forecasts: GnssForecastCity[]): Record<string, GnssForecastCity> {
  return Object.fromEntries(forecasts.map((f) => [f.city, f]));
}

function field(city: GnssForecastCity | undefined, label: string): string | undefined {
  return city?.fields.find((f) => f.label === label)?.value;
}

function nationalTone(forecasts: GnssForecastCity[]): ForecastStatus {
  if (forecasts.some((f) => f.status === "warning")) return "warning";
  if (forecasts.some((f) => f.status === "moderate")) return "moderate";
  return "excellent";
}

const TONE_RANK: Record<ForecastStatus, number> = { excellent: 0, moderate: 1, warning: 2 };

/** Minimum tone from live NOAA indices — storms must not read as "good news" because CORS feeds are up. */
export function spaceWeatherFloor(sw: SpaceWeatherCurrent | null): ForecastStatus {
  if (!sw) return "excellent";
  const kp = sw.kp;
  const dst = sw.dst;
  const s4 = sw.s4;
  const risk = (sw.gnss_risk ?? "").toLowerCase();

  if (
    (kp != null && kp >= 7) ||
    (dst != null && dst <= -100) ||
    (s4 != null && s4 >= 0.5) ||
    risk === "critical" ||
    (kp != null && kp >= 5 && dst != null && dst <= -50)
  ) {
    return "warning";
  }
  if (
    (kp != null && kp >= 5) ||
    (dst != null && dst <= -50) ||
    (s4 != null && s4 >= 0.3) ||
    risk === "high"
  ) {
    return "moderate";
  }
  return "excellent";
}

/** Regional CORS outlook merged with live Kp/Dst/S4 — the more severe wins. */
export function effectiveNavigationTone(
  forecasts: GnssForecastCity[],
  sw: SpaceWeatherCurrent | null,
): ForecastStatus {
  const fromForecasts = nationalTone(forecasts);
  const fromSw = spaceWeatherFloor(sw);
  return TONE_RANK[fromForecasts] >= TONE_RANK[fromSw] ? fromForecasts : fromSw;
}

function statusWord(status: ForecastStatus): string {
  if (status === "excellent") return "Excellent";
  if (status === "moderate") return "Moderate";
  return "Poor";
}

function formatUtc(iso: string): string {
  return iso.replace("T", " ").replace("Z", " UTC").slice(0, 19);
}

function joinScript(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return value.toFixed(digits);
}

function kpLayman(kp: number | null | undefined): string {
  if (kp == null) return "Earth's magnetic field: updating";
  if (kp <= 2) return `Earth's magnetic field is calm (Kp ${fmtNum(kp)})`;
  if (kp <= 4) return `Earth's magnetic field is a little unsettled (Kp ${fmtNum(kp)})`;
  if (kp <= 6) return `Mild magnetic storm under way (Kp ${fmtNum(kp)})`;
  return `Strong magnetic storm under way (Kp ${fmtNum(kp)})`;
}

function s4Layman(s4: number | null | undefined): string {
  if (s4 == null) return "GPS signal strength: updating";
  if (s4 < 0.15) return `GPS signals are steady (S4 ${fmtNum(s4, 2)})`;
  if (s4 < 0.3) return `GPS signals may flicker a little (S4 ${fmtNum(s4, 2)})`;
  return `GPS signals are disturbed (S4 ${fmtNum(s4, 2)})`;
}

function dstLayman(dst: number | null | undefined): string {
  if (dst == null) return "Solar wind pressure: updating";
  if (dst > -30) return `No strong solar-wind push on Earth (Dst ${fmtNum(dst, 0)} nT)`;
  if (dst > -50) return `Mild solar-wind pressure on Earth (Dst ${fmtNum(dst, 0)} nT)`;
  if (dst > -100) return `Magnetic disturbance may affect GPS (Dst ${fmtNum(dst, 0)} nT)`;
  return `Strong magnetic disturbance (Dst ${fmtNum(dst, 0)} nT)`;
}

function riskLayman(risk: string | null | undefined): string {
  const r = (risk ?? "unknown").toLowerCase();
  if (r === "low") return "GPS risk today: Low — maps should work normally";
  if (r === "moderate") return "GPS risk today: Moderate — location may be a bit slow or off";
  if (r === "high" || r === "critical") return "GPS risk today: High — do not trust a map pin alone";
  return `GPS risk today: ${risk ?? "updating"}`;
}

/** Plain-language snapshot of live space weather for all audience briefs. */
export function buildSpaceWeatherLayman(
  sw: SpaceWeatherCurrent | null,
  tone: ForecastStatus,
): SpaceWeatherLayman {
  const kp = sw?.kp;
  const s4 = sw?.s4;
  const dst = sw?.dst;
  const wind = sw?.plasma_speed;
  const risk = sw?.gnss_risk;
  const kpCond = sw?.kp_condition ?? "updating";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Calm sky for GPS — maps should work normally",
    moderate: "Mild space weather — GPS may be a little slow or off",
    warning: "Active space weather — GPS may show the wrong place",
  };

  const explainers: Record<ForecastStatus, string> = {
    excellent:
      "Space weather is activity from the Sun that can affect GPS. Today it is quiet.",
    moderate:
      "The Sun is stirring the air high above us where GPS signals travel. Your phone still works, but the blue dot may drift a few metres.",
    warning:
      "Strong activity from the Sun is disturbing GPS over Zimbabwe. Maps and location apps may be wrong until it settles.",
  };

  const impacts: Record<ForecastStatus, string> = {
    excellent: "Use maps, taxis, and WhatsApp location as normal.",
    moderate: "If your pin looks wrong, wait a moment or step outside for a clearer sky view.",
    warning: `Do not trust a map pin alone. Confirm by phone or street signs. Help: ${ZINGSA_PHONE}.`,
  };

  const readout: string[] = [
    kpLayman(kp),
    s4Layman(s4),
    dstLayman(dst),
    riskLayman(risk),
  ];

  if (wind != null) {
    readout.push(
      wind > 500
        ? `Solar wind is fast (${fmtNum(wind, 0)} km/s — energetic particles reaching Earth)`
        : `Solar wind speed: ${fmtNum(wind, 0)} km/s (typical background level)`,
    );
  }

  if (kpCond && kpCond !== "updating") {
    readout.push(`NOAA summary: ${kpCond} geomagnetic conditions`);
  }

  return {
    headline: headlines[tone],
    explainer: explainers[tone],
    readout,
    impact: impacts[tone],
  };
}

function citizenBrief(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const status = tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const poorAreas = forecasts
    .filter((f) => f.status !== "excellent")
    .map((f) => f.city.replace("VICTORIA FALLS", "Vic Falls"))
    .slice(0, 3);
  const areaNote =
    poorAreas.length > 0
      ? `Watch these areas: ${poorAreas.join(", ")}.`
      : "Nationwide outlook: good for everyday GPS.";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Good GPS day — your maps should work normally",
    moderate: "GPS may wobble a little today",
    warning: "GPS alert — check your location carefully",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Your phone uses satellites for Maps, WhatsApp location, and taxis. Today those signals are clear across Zimbabwe.",
    moderate:
      "GPS is a bit unsettled. Your phone may take longer to find you, or show you a few metres from where you stand. This is not a broken phone.",
    warning:
      `GPS may show the wrong place today. Do not trust a map pin alone for meetings or travel. Call ZINGSA on ${ZINGSA_PHONE} if you need help.`,
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      "Use maps and location apps as normal",
      areaNote,
      "ZINGSA is watching space weather for the country",
    ],
    moderate: [
      "You may see a slow GPS lock or a blue dot a few metres off",
      areaNote,
      "Step outside if your location looks wrong",
    ],
    warning: [
      "Map pins or delivery pickups may be wrong",
      areaNote,
      "Confirm places by phone or street signs",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "No action needed.",
    moderate: ZINGSA_NAVIGATION_MODERATE_ACTION,
    warning: ZINGSA_NAVIGATION_WARNING_ACTION,
  };

  const broadcast = joinScript([
    "🇿🇼 *ZINGSA Navigation News*",
    formatUtc(computedAt),
    "",
    `*Today:* ${headlines[status]}`,
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *What to do:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "🇿🇼 ZINGSA Navigation News",
    headlines[status],
    summaries[status],
    `What to do: ${actions[status]}`,
    "#ZINGSA #Zimbabwe #GPS",
  ]);

  return {
    id: "citizen",
    icon: "🌌",
    title: "For Everyone",
    audience: "Ordinary citizens, schools & community groups",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline}. ${swCtx.explainer}`,
    spaceWeatherBullets: swCtx.readout.slice(0, 3),
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "Facebook Page", "X / Twitter", "Community WhatsApp", "Radio bulletins", "School outreach"],
  };
}

function farmerBrief(
  harare: GnssForecastCity | undefined,
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const status = harare?.status ?? tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const window = field(harare, "Best Survey Window") ?? "07:00 – 14:00";
  const rtk = field(harare, "RTK Reliability") ?? "See live forecast";
  const accuracy = field(harare, "Expected Accuracy") ?? "See live forecast";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Good day for tractor GPS and field mapping",
    moderate: "Do GPS field work in the morning if you can",
    warning: "Caution: auto-steer and drone mapping may drift",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Tractor auto-steer, spraying, and boundary mapping should work well today. Satellite GPS for the farm is steady.",
    moderate:
      "Farm GPS still works, but lines may wander a little after midday. Auto-steer may take longer to lock. Prefer morning planting, spraying, and mapping.",
    warning:
      "Precision GPS may drift beyond normal farm limits. Check fence lines and spray paths before any legal or payment decisions. Use known ground marks if you must map today.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `Field GPS: ${statusWord(status)} (Harare area)`,
      `RTK: ${rtk} · Accuracy: ${accuracy}`,
      `Best work window: ${window}`,
    ],
    moderate: [
      `Field GPS: ${statusWord(status)} (Harare area)`,
      `RTK: ${rtk} · Accuracy: ${accuracy}`,
      `Best window: ${window} — finish GPS jobs before lunch if possible`,
    ],
    warning: [
      `Field GPS: ${statusWord(status)} (Harare area)`,
      `RTK: ${rtk} · Accuracy: ${accuracy}`,
      "Postpone centimetre mapping if you can; check ground marks before accepting boundaries",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Go ahead with precision planting, spraying, and mapping.",
    moderate: "Schedule GPS-heavy field work before 11:00.",
    warning: "Do not rely on GPS alone for legal boundaries until conditions improve.",
  };

  const broadcast = joinScript([
    "🌱 *ZINGSA Navigation News — Farmers*",
    `📍 Harare & surrounds · ${formatUtc(computedAt)}`,
    "",
    headlines[status],
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *What to do:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "🌱 ZINGSA | Farmers",
    headlines[status],
    `Window ${window} · RTK ${rtk}`,
    "#Farming #GPS #Zimbabwe",
  ]);

  return {
    id: "farmer",
    icon: "🌱",
    title: "Farmer Brief",
    audience: "Farmers, agronomists & smart-agri operators",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline}. ${swCtx.impact}`,
    spaceWeatherBullets: swCtx.readout.slice(0, 3),
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "WhatsApp farmer groups", "In-app alerts", "Facebook Page"],
  };
}

function surveyorBrief(
  mutare: GnssForecastCity | undefined,
  harare: GnssForecastCity | undefined,
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const primary = mutare ?? harare;
  const status = primary?.status ?? tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const site = primary?.city === "MUTARE" ? "Mutare (MUTA)" : "Harare (HARA/ZINH)";
  const accuracy = field(primary, "Expected Accuracy") ?? "See live forecast";
  const rtk = field(primary, "RTK Reliability") ?? "See live forecast";
  const window = field(primary, "Best Survey Window") ?? "07:00 – 14:00";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "CORS/RTK conditions favourable — proceed with survey",
    moderate: "Allow extra RTK occupation time — ionospheric delay elevated",
    warning: "Degraded GNSS — centimetre work needs redundancy",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Ionosphere quiet. Negligible space-weather contribution to RTK baselines and CORS corrections. Cadastral and engineering surveys can proceed to normal tolerances.",
    moderate:
      "Elevated ionospheric delay and scintillation. Expect longer RTK initialisation and possible float slips around midday. Check receiver and caster before assuming a fault.",
    warning:
      "Active ionospheric disturbance. Ambiguity-fixed centimetre GNSS alone may not meet legal accuracy today. Hold centimetre submissions or add total-station / independent control checks.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `CORS focus: ${site} · Status: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy} · RTK reliability: ${rtk}`,
      `Preferred occupation window: ${window}`,
      `Indices: Kp ${fmtNum(sw?.kp)} · S4 ${fmtNum(sw?.s4, 2)} · Dst ${fmtNum(sw?.dst, 0)} nT`,
    ],
    moderate: [
      `CORS focus: ${site} · Status: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy} · RTK reliability: ${rtk}`,
      "Allow ~15–30% longer time to Fix; prefer morning occupations",
      `Window: ${window} · Kp ${fmtNum(sw?.kp)} · S4 ${fmtNum(sw?.s4, 2)}`,
    ],
    warning: [
      `CORS focus: ${site} · Status: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy} · RTK: ${rtk}`,
      "Error budget dominated by space weather — verify control independently",
      primary?.cause
        ? `Drivers: ${primary.cause}`
        : `Monitor Kp ${fmtNum(sw?.kp)} / S4 ${fmtNum(sw?.s4, 2)} before mobilising`,
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Mobilise as planned. Space weather is not limiting today.",
    moderate: "Brief crews on longer Fix times. Prefer morning occupations.",
    warning: "Delay centimetre-critical lodgement or add total-station redundancy.",
  };

  const broadcast = joinScript([
    "📐 *ZINGSA Navigation News — Surveyors*",
    `📍 ${site} · ${formatUtc(computedAt)}`,
    "",
    headlines[status],
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *Action:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "📐 ZINGSA | Surveyors",
    headlines[status],
    `${site} · ${accuracy} · RTK ${rtk}`,
    "#Surveying #RTK #CORS #Zimbabwe",
  ]);

  return {
    id: "surveyor",
    icon: "📐",
    title: "Surveyor Brief",
    audience: "Land surveyors, engineers & cadastral teams",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline}. Kp ${fmtNum(sw?.kp)} · S4 ${fmtNum(sw?.s4, 2)} · Dst ${fmtNum(sw?.dst, 0)} nT.`,
    spaceWeatherBullets: [
      `Kp ${fmtNum(sw?.kp)}`,
      `S4 ${fmtNum(sw?.s4, 2)}`,
      `Dst ${fmtNum(sw?.dst, 0)} nT`,
      `GNSS risk ${sw?.gnss_risk ?? "updating"}`,
    ],
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "WhatsApp surveyor groups", "In-app alerts", "LinkedIn"],
  };
}

function driverBrief(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const status = tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const vicf = forecasts.find((f) => f.city === "VICTORIA FALLS");
  const harare = forecasts.find((f) => f.city === "HARARE");
  const corridorNote =
    vicf?.status === "warning"
      ? "Western corridor (Victoria Falls): space weather may widen GPS error — read road signs, not only the app."
      : harare?.status === "excellent"
        ? "Harare urban routes: space weather is quiet — taxi and delivery GPS should be normal."
        : "Some corridors may show map offsets when space weather disturbs the ionosphere.";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Calm space weather — in-car and taxi navigation should be trustworthy",
    moderate: "Mild space weather — watch for map pins that drift from the road",
    warning: "Space weather alert for drivers — GPS may mislead you at junctions",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Space weather is not interfering with the satellite signals your dashboard, taxi meter, or ride-hailing app uses. Solar activity is low and the ionosphere is stable — the invisible conditions behind accurate ETAs and turn-by-turn directions.",
    moderate:
      "Space weather is making the ionosphere slightly uneven. You may see your car icon jump lanes, routes recalculate more often, or a passenger pickup pin land on the wrong side of the road. The road is still there — the satellite geometry is temporarily messy.",
    warning:
      "Active space weather is degrading GNSS for fleets and private drivers alike. Do not follow a turn arrow blindly in an unfamiliar area. The same magnetic and solar forces affecting surveyors and farmers are shifting the signals your navigation app depends on.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `Driving GPS outlook: ${statusWord(status)}`,
      corridorNote,
      "Space weather impact on navigation: none significant",
      "Ride-hailing, buses, delivery: normal",
    ],
    moderate: [
      `Driving GPS outlook: ${statusWord(status)}`,
      corridorNote,
      "Space weather may offset map pins by 5–15 m in open areas",
      "Call passengers if the pickup dot does not match the street",
    ],
    warning: [
      `Driving GPS outlook: ${statusWord(status)}`,
      corridorNote,
      "Space weather may cause ‘recalculating route’ and wrong-lane guidance",
      "Fleet managers: warn drivers before afternoon shifts",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Drive as normal. Quiet space weather supports reliable navigation.",
    moderate: "Trust road signs at junctions when space weather may be nudging your map.",
    warning: "Slow down in unknown areas. Confirm pickups and drop-offs by phone, not GPS alone.",
  };

  const broadcast = joinScript([
    "🚕 *ZINGSA Navigation News — Drivers & Fleet*",
    formatUtc(computedAt),
    "",
    `🌌 *Space weather:* ${swCtx.headline}`,
    ...swCtx.readout.slice(0, 3).map((b) => `• ${b}`),
    "",
    headlines[status],
    "",
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *Action:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "🚕 ZINGSA Navigation News | Drivers",
    swCtx.headline,
    corridorNote,
    "#SpaceWeather #Taxi #FleetGPS #Zimbabwe",
  ]);

  return {
    id: "driver",
    icon: "🚕",
    title: "Driver & Fleet Brief",
    audience: "Taxi drivers, bus operators, couriers & everyday motorists",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.impact}`,
    spaceWeatherBullets: swCtx.readout,
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "WhatsApp driver groups", "Fleet dispatch SMS", "Facebook Page"],
  };
}

function aviationBrief(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const status = tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const harare = forecasts.find((f) => f.city === "HARARE");
  const vicf = forecasts.find((f) => f.city === "VICTORIA FALLS");
  const routeNote =
    vicf?.status === "warning"
      ? "Victoria Falls / western routes: expect wider GNSS error and possible HF radio noise on long sectors."
      : harare?.status === "excellent"
        ? "Harare and central Zimbabwe: aviation GNSS and routine approaches should be within normal limits."
        : "Some en-route and approach sectors may show GNSS degradation when the ionosphere is disturbed.";

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Calm space weather — aviation GNSS and routine navigation should be reliable",
    moderate: "Mild space weather — monitor GPS approaches and HF communications",
    warning: "Space weather alert for aviation — expect GNSS and HF impacts",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Solar activity is low and the ionosphere is stable over Southern Africa. Space weather is not expected to interfere with GPS-based navigation (RNAV/GPS approaches), en-route GNSS, or standard HF radio links used on cross-border sectors.",
    moderate:
      "Space weather is making the ionosphere uneven. Pilots and drone operators may see slightly longer GNSS acquisition, small position offsets on moving maps, or brief HF static on polar and long-haul HF routes. Most commercial GNSS with RAIM will continue to operate, but monitor NOTAMs and ZINGSA briefs through the afternoon.",
    warning:
      "Active geomagnetic and ionospheric disturbance is affecting high-altitude navigation signals. GPS-guided approaches, unmanned aerial operations, and HF communications can all degrade during the storm main phase. Do not assume cockpit or controller displays match actual position without cross-checks — the same space weather affecting farmers and surveyors reaches aircraft at cruise altitude.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `Aviation GNSS outlook: ${statusWord(status)}`,
      routeNote,
      "Space weather impact: minimal for RNAV/GPS and en-route GNSS",
      "Drone ops (VLOS): normal with standard pre-flight checks",
    ],
    moderate: [
      `Aviation GNSS outlook: ${statusWord(status)}`,
      routeNote,
      "Watch for RAIM alerts or longer approach lock-on during afternoon scintillation",
      "HF users: possible flutter on long paths; VHF/UHF mostly unaffected",
    ],
    warning: [
      `Aviation GNSS outlook: ${statusWord(status)}`,
      routeNote,
      "GPS/RNAV approaches may be unavailable or require reversion to conventional navaids",
      "Drone operators: delay BVLOS and precision survey flights until conditions ease",
      "Crew: elevated high-altitude radiation possible on polar/long-haul routes during strong storms",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Operate as normal. Include space weather in standard briefing — quiet ionosphere supports reliable GNSS.",
    moderate: "Brief crews on possible GNSS wobble and HF noise. Prefer morning sectors for precision drone or survey flights.",
    warning: "Activate storm procedures: verify navaid backups, delay non-essential drone ops, and monitor Kp/Dst until recovery.",
  };

  const broadcast = joinScript([
    "✈️ *ZINGSA Navigation News — Aviation*",
    formatUtc(computedAt),
    "",
    `🌌 *Space weather:* ${swCtx.headline}`,
    ...swCtx.readout.slice(0, 3).map((b) => `• ${b}`),
    "",
    headlines[status],
    "",
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *Action:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "✈️ ZINGSA Navigation News | Aviation",
    swCtx.headline,
    routeNote,
    "#SpaceWeather #Aviation #GNSS #Zimbabwe",
  ]);

  return {
    id: "aviation",
    icon: "✈️",
    title: "Aviation Brief",
    audience: "Pilots, air traffic controllers & drone operators",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.impact}`,
    spaceWeatherBullets: swCtx.readout,
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "ATC briefings", "Airline ops WhatsApp", "UAS operator groups"],
  };
}

function scientistBrief(
  forecasts: GnssForecastCity[],
  tone: ForecastStatus,
  sw: SpaceWeatherCurrent | null,
  computedAt: string,
): NavigationNewsBrief {
  const status = tone;
  const swCtx = buildSpaceWeatherLayman(sw, tone);
  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const s4 = sw?.s4 ?? null;
  const vtec = sw?.mean_vtec ?? null;
  const gnssRisk = sw?.gnss_risk ?? "unknown";
  const national = nationalTone(forecasts);
  const degradedStations = forecasts.filter((f) => f.status !== "excellent").length;

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Quiet ionosphere — favourable window for GNSS science and CORS QC",
    moderate: "Elevated space weather — expect measurable TEC bias and scintillation in afternoon data",
    warning: "Storm conditions — flag CORS arcs, widen uncertainty on TEC/GNSS products",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Geomagnetic and ionospheric drivers are subdued over Zimbabwe. CORS-derived VTEC, dual-frequency combinations, and EKF-monitored residuals should stay within typical quiet-day envelopes — suitable for calibration runs, model validation, and publication-quality extracts from the ZINGSA archive.",
    moderate:
      "Space weather is injecting extra delay and phase noise into the ionosphere. Researchers should expect elevated TEC gradients, higher S4 on low-elevation satellites, and longer RTK re-convergence in CORS time series — especially post-noon. Compare live Kp/Dst with ZINGSA EKF deviation alerts before assimilating data into storm studies.",
    warning:
      "Active geomagnetic disturbance is dominating the ionospheric state. TEC maps, ROTI proxies, and carrier-phase solutions may contain outliers; do not treat automatic QC as sufficient without manual review. Cross-check NOAA/SWPC indices, WDC Kyoto Dst, and ZINGSA storm-watch logs — this is a high-value event for case studies but a poor window for baseline inter-comparisons.",
  };

  const metricsLine = `Live indices: Kp ${fmtNum(kp)} · Dst ${fmtNum(dst, 0)} nT · S4 ${fmtNum(s4, 2)} · VTEC ${fmtNum(vtec, 2)} TECU · GNSS risk ${gnssRisk}`;

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `National GNSS outlook: ${statusWord(national)} across ${forecasts.length} forecast cities`,
      metricsLine,
      `CORS network: ${degradedStations} cities outside excellent — routine QC only`,
      "EKF pipeline: residuals expected near climatology; good day for filter tuning",
      "Data use: archive pulls, student labs, and inter-station TEC comparisons",
    ],
    moderate: [
      `National GNSS outlook: ${statusWord(national)}`,
      metricsLine,
      `CORS network: ${degradedStations} cities showing moderate/warning positioning stress`,
      "Watch afternoon scintillation (S4) on east-west baselines and low elevations",
      "EKF deviation alerts may fire on TEC/S4 — treat as science signal, not sensor fault",
    ],
    warning: [
      `National GNSS outlook: ${statusWord(national)}`,
      metricsLine,
      `CORS network: ${degradedStations} cities degraded — flag RINEX before ingestion`,
      "Prioritise storm case logging: Kp, Dst, solar wind, GIC if available",
      "Delay cm-level RTK research products; publish event bulletin instead",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Proceed with routine processing and research extracts. Document quiet-day baselines for the archive.",
    moderate: "Enable enhanced QC flags on CORS ingest; compare ZINGSA TEC with IGS/global maps.",
    warning: "Activate storm-data protocol: snapshot indices hourly, segregate contaminated arcs, coordinate with ZINGSA ops before releasing operational TEC products.",
  };

  const broadcast = joinScript([
    "🔬 *ZINGSA Navigation News — Scientists & Researchers*",
    formatUtc(computedAt),
    "",
    `🌌 *Space weather:* ${swCtx.headline}`,
    ...swCtx.readout.slice(0, 4).map((b) => `• ${b}`),
    "",
    headlines[status],
    "",
    summaries[status],
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *Action:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = joinScript([
    "🔬 ZINGSA Navigation News | Scientists",
    swCtx.headline,
    metricsLine,
    "#SpaceWeather #Ionosphere #GNSS #Research #Zimbabwe",
  ]);

  return {
    id: "scientist",
    icon: "🔬",
    title: "Scientist Brief",
    audience: "Researchers, geophysicists & GNSS data analysts",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.impact}`,
    spaceWeatherBullets: swCtx.readout,
    bullets: bullets[status],
    action: actions[status],
    statusTone: status,
    broadcastScript: broadcast,
    socialScript: social,
    channels: [...ZINGSA_NAVIGATION_CHANNELS, "Research WhatsApp", "University mailing lists", "Data portal RSS"],
  };
}

/** Build copy-ready audience briefs for UI and future AI broadcast agent. */
export function buildAudienceNews(
  forecasts: GnssForecastCity[],
  computedAt: string,
  sw: SpaceWeatherCurrent | null = null,
): NavigationNewsBrief[] {
  const cities = byCity(forecasts);
  const tone = effectiveNavigationTone(forecasts, sw);

  return [
    citizenBrief(forecasts, tone, sw, computedAt),
    farmerBrief(cities.HARARE, tone, sw, computedAt),
    surveyorBrief(cities.MUTARE, cities.HARARE, tone, sw, computedAt),
    aviationBrief(forecasts, tone, sw, computedAt),
    driverBrief(forecasts, tone, sw, computedAt),
    scientistBrief(forecasts, tone, sw, computedAt),
  ];
}

/** Single brief lookup — for future `/api/navigation-news?audience=farmer` agent routes. */
export function getAudienceBrief(
  forecasts: GnssForecastCity[],
  computedAt: string,
  audience: AudienceId,
  sw: SpaceWeatherCurrent | null = null,
): NavigationNewsBrief | undefined {
  return buildAudienceNews(forecasts, computedAt, sw).find((b) => b.id === audience);
}
