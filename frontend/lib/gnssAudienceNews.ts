import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import {
  buildNationalNavigationSocial,
} from "./nationalNavigationSocial";
import {
  ZINGSA_AGENCY,
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
  if (kp == null) return "Geomagnetic activity: data updating";
  if (kp <= 2) return `Geomagnetic activity is quiet (Kp ${fmtNum(kp)} — like calm weather for Earth's magnetic field)`;
  if (kp <= 4) return `Geomagnetic activity is unsettled (Kp ${fmtNum(kp)} — minor solar influence on Earth's field)`;
  if (kp <= 6) return `Geomagnetic activity is elevated (Kp ${fmtNum(kp)} — a minor geomagnetic storm is under way)`;
  return `Geomagnetic activity is strong (Kp ${fmtNum(kp)} — a significant geomagnetic storm is affecting Earth)`;
}

function s4Layman(s4: number | null | undefined): string {
  if (s4 == null) return "GPS signal stability: data updating";
  if (s4 < 0.15) return `GPS signal path is stable (S4 ${fmtNum(s4, 2)} — the ionosphere is calm)`;
  if (s4 < 0.3) return `GPS signals may flicker slightly (S4 ${fmtNum(s4, 2)} — the ionosphere is restless)`;
  return `GPS signals are disturbed (S4 ${fmtNum(s4, 2)} — strong ionospheric scintillation over Zimbabwe)`;
}

function dstLayman(dst: number | null | undefined): string {
  if (dst == null) return "Solar wind pressure on Earth: data updating";
  if (dst > -30) return `Earth's magnetosphere is steady (Dst ${fmtNum(dst, 0)} nT)`;
  if (dst > -50) return `Earth's magnetic field is being pushed (Dst ${fmtNum(dst, 0)} nT — mild solar wind pressure)`;
  if (dst > -100) return `Magnetic field disturbance detected (Dst ${fmtNum(dst, 0)} nT — navigation may feel it)`;
  return `Strong magnetic disturbance (Dst ${fmtNum(dst, 0)} nT — part of an active space-weather event)`;
}

function riskLayman(risk: string | null | undefined): string {
  const r = (risk ?? "unknown").toLowerCase();
  if (r === "low") return "Overall GNSS risk today: Low — everyday positioning should be fine";
  if (r === "moderate") return "Overall GNSS risk today: Moderate — some users may notice slower GPS";
  if (r === "high" || r === "critical") return "Overall GNSS risk today: High — expect positioning problems in affected areas";
  return `Overall GNSS risk today: ${risk ?? "updating"}`;
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
    excellent: "Quiet space weather — the Sun is not disturbing our navigation today",
    moderate: "Mild space weather — the Sun is gently affecting signals above Zimbabwe",
    warning: "Active space weather — solar and magnetic activity is impacting navigation",
  };

  const explainers: Record<ForecastStatus, string> = {
    excellent:
      "Space weather is what the Sun and near-Earth space do to our planet — solar wind, flares, and magnetic storms. When conditions are quiet, the high-altitude layer that carries GPS signals (the ionosphere) stays smooth. Most people never see this science, but every map pin, taxi route, and farm GPS depends on it.",
    moderate:
      "The Sun constantly sends charged particles toward Earth. Today those particles are stirring the ionosphere — the invisible shell where navigation satellites talk to your phone. Think of it like radio static in the sky: signals still get through, but they may wobble for a few seconds or drift a few metres.",
    warning:
      "A burst of solar or geomagnetic activity is disturbing the ionosphere over southern Africa. Satellite signals are taking longer paths or fading in and out — the same physics behind auroras and radio blackouts, but felt on your phone as wrong map pins, lost GPS, or delayed location updates.",
  };

  const impacts: Record<ForecastStatus, string> = {
    excellent:
      "For most Zimbabweans this is invisible good news: maps, mobile money location checks, and in-car navigation should behave normally.",
    moderate:
      "You may notice your phone taking longer to find you, delivery apps showing a wider blue dot, or precision equipment (surveyors, farmers) needing extra patience — especially in the afternoon.",
    warning:
      `Ordinary navigation can mislead you today. Do not trust a map pin alone for remote travel or meeting someone at an exact spot. Space weather is temporary, but while it lasts, confirm locations by sight, address, or phone — or call ZINGSA on ${ZINGSA_PHONE} for navigation guidance.`,
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
  const regions = forecasts
    .map((f) => `${f.city.replace("VICTORIA FALLS", "Vic Falls")}: ${f.statusLabel}`)
    .join(" · ");

  const headlines: Record<ForecastStatus, string> = {
    excellent: "Space weather is calm — your everyday apps should work as usual",
    moderate: "Space weather is mildly active — your phone location may wobble a little",
    warning: "Space weather alert — satellite navigation may let you down today",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Did you know your phone's location comes from satellites passing through space weather? Today the Sun is quiet, Earth's magnetic field is stable, and the ionosphere over Zimbabwe is smooth. That means Google Maps, WhatsApp live location, and ride-hailing apps can find you reliably.",
    moderate:
      "Space weather is the 'weather in space' — solar wind and magnetic storms that ripple through the ionosphere where GPS signals travel. Today those ripples are small but real. Your phone might take a few extra seconds to lock on, or show you standing across the street from where you actually are. It is not your phone breaking; it is the sky above you shifting.",
    warning:
      `When the Sun throws energy at Earth, navigation satellites and your phone feel it first. Today geomagnetic and ionospheric activity is high enough to disturb positioning across parts of Zimbabwe. Maps may show the wrong place and rides may pick up at the wrong corner — call ${ZINGSA_AGENCY} on ${ZINGSA_PHONE} if you need help understanding conditions in your area.`,
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      "What you can do today: use maps and location apps normally",
      `Navigation outlook nationwide: ${statusWord(status)}`,
      `Regional detail: ${regions}`,
      "Why it matters: even on calm days, ZINGSA monitors space weather to protect farmers, drivers, and surveyors",
    ],
    moderate: [
      "What you might notice: slower GPS lock, blue dot a few metres off, apps saying ‘searching for GPS’",
      `Navigation outlook nationwide: ${statusWord(status)}`,
      `Regional detail: ${regions}`,
      "Step outside with a clear view of the sky if your location looks wrong — buildings plus space weather make it worse",
    ],
    warning: [
      "What you might notice: wrong map pins, ‘GPS signal lost’, delivery drivers at the wrong gate",
      `Navigation outlook nationwide: ${statusWord(status)}`,
      `Regional detail: ${regions}`,
      "Tell family your travel route; keep offline maps or landmarks as backup",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "No action needed. Enjoy the day — and know that quiet space weather is why your navigation works.",
    moderate: ZINGSA_NAVIGATION_MODERATE_ACTION,
    warning: ZINGSA_NAVIGATION_WARNING_ACTION,
  };

  const broadcast = joinScript([
    "🇿🇼 *ZINGSA Navigation News — Space Weather & You*",
    formatUtc(computedAt),
    "",
    "🌌 *What is space weather?*",
    "Activity on the Sun and in near-Earth space — solar wind, flares, and magnetic storms — that changes the ionosphere where GPS signals travel.",
    "",
    `*Today:* ${swCtx.headline}`,
    "",
    summaries[status],
    "",
    "*Live conditions (plain language):*",
    ...swCtx.readout.map((b) => `• ${b}`),
    "",
    "*What this means for ordinary life:*",
    swCtx.impact,
    "",
    ...bullets[status].map((b) => `• ${b}`),
    "",
    `👉 *Action:* ${actions[status]}`,
    "",
    ...ZINGSA_BROADCAST_FOOTER,
  ]);

  const social = buildNationalNavigationSocial(status, sw, computedAt, forecasts);

  return {
    id: "citizen",
    icon: "🌌",
    title: "Space Weather & You",
    audience: "General citizens, schools & community groups",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.explainer}`,
    spaceWeatherBullets: swCtx.readout,
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
    excellent: "Quiet space weather — good day for GPS-guided farming",
    moderate: "Mild space weather — schedule precision field work for the morning",
    warning: "Space weather disturbing GPS — caution with auto-steer and drone mapping",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Solar activity is low and the ionosphere over Harare is stable. Space weather is not interfering with tractor auto-steer, boundary mapping, or variable-rate spraying. Your GPS equipment is working in a calm sky.",
    moderate:
      "Space weather is stirring the ionosphere. Tractor GPS and agricultural drones still work, but satellite signals may drift slightly — especially after midday when scintillation often peaks. Space weather is the invisible reason your receiver may need longer to ‘fix’.",
    warning:
      "Active space weather is degrading precision GNSS over central Zimbabwe. The same solar and magnetic forces that cause auroras are now thickening and rippling the ionosphere, so RTK and auto-steer may drift beyond normal limits. Verify boundaries before any legal or financial commitments.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `Field GPS outlook: ${statusWord(status)} (Harare / HARA–ZINH)`,
      `RTK reliability: ${rtk} · Accuracy: ${accuracy}`,
      `Best work window: ${window}`,
      "Space weather impact on farming today: minimal",
    ],
    moderate: [
      `Field GPS outlook: ${statusWord(status)} (Harare / HARA–ZINH)`,
      `RTK reliability: ${rtk} · Accuracy: ${accuracy}`,
      `Preferred window: ${window} — before afternoon ionospheric disturbance`,
      "Space weather may add minutes to GPS lock on long boundary runs",
    ],
    warning: [
      `Field GPS outlook: ${statusWord(status)} (Harare / HARA–ZINH)`,
      `RTK reliability: ${rtk} · Accuracy: ${accuracy}`,
      "Space weather is the driver — postpone centimetre-level mapping if possible",
      "Use known ground control points before accepting drone or auto-steer boundaries",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Proceed with precision agriculture. Quiet space weather supports reliable GPS.",
    moderate: "Plan GPS-heavy tasks before 11:00 when space weather effects are usually lighter.",
    warning: "Treat GPS boundaries with caution until space weather settles — use backup surveying if stakes are high.",
  };

  const broadcast = joinScript([
    "🌱 *ZINGSA Navigation News — Farmers*",
    `📍 Harare & surrounds · ${formatUtc(computedAt)}`,
    "",
    `🌌 *Space weather today:* ${swCtx.headline}`,
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
    "🌱 ZINGSA Navigation News | Farmers",
    swCtx.headline,
    headlines[status],
    `Window ${window} · RTK ${rtk}`,
    "#SpaceWeather #PrecisionAg #Zimbabwe",
  ]);

  return {
    id: "farmer",
    icon: "🌱",
    title: "Farmer Brief",
    audience: "Farmers, agronomists & smart-agri operators",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.impact}`,
    spaceWeatherBullets: swCtx.readout,
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
    excellent: "Quiet ionosphere — survey-grade GNSS is reliable today",
    moderate: "Space weather adding noise — allow extra RTK occupation time",
    warning: "Space weather event — expect degraded survey accuracy",
  };

  const summaries: Record<ForecastStatus, string> = {
    excellent:
      "Geomagnetic and ionospheric conditions are calm. Space weather is not adding significant error to RTK baselines or CORS corrections. Standard cadastral and engineering surveys can proceed.",
    moderate:
      "Elevated space weather is increasing ionospheric delay and scintillation. RTK initialization may take longer and fixed solutions may slip during midday. This is a space-weather effect, not necessarily a faulty receiver or caster.",
    warning:
      "A space-weather disturbance is active. The ionosphere over eastern/central Zimbabwe is turbulent — the layer your satellite corrections pass through. Centimetre-level GNSS alone may not meet legal survey standards today; plan redundancy.",
  };

  const bullets: Record<ForecastStatus, string[]> = {
    excellent: [
      `Survey site: ${site} · GNSS: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy} · RTK: ${rtk}`,
      `Window: ${window}`,
      "Space weather contribution to error: negligible",
    ],
    moderate: [
      `Survey site: ${site} · GNSS: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy} · RTK: ${rtk}`,
      "Space weather: allow 15–30% longer initialization",
      `Best occupation: ${window}`,
    ],
    warning: [
      `Survey site: ${site} · GNSS: ${statusWord(status)}`,
      `Expected accuracy: ${accuracy}`,
      "Space weather is dominating the error budget — verify control points independently",
      primary?.cause ? `Live drivers: ${primary.cause}` : "Monitor Kp and S4 before mobilising",
    ],
  };

  const actions: Record<ForecastStatus, string> = {
    excellent: "Mobilise crews as planned. Space weather is not a limiting factor today.",
    moderate: "Brief crews: space weather may extend fix times. Prefer morning occupations.",
    warning: "Delay centimetre-critical submissions or deploy total-station redundancy until conditions ease.",
  };

  const broadcast = joinScript([
    "📐 *ZINGSA Navigation News — Surveyors*",
    `📍 ${site} · ${formatUtc(computedAt)}`,
    "",
    `🌌 *Space weather:* ${swCtx.headline}`,
    ...swCtx.readout.map((b) => `• ${b}`),
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
    "📐 ZINGSA Navigation News | Surveyors",
    swCtx.headline,
    `${site} · ${accuracy}`,
    "#SpaceWeather #Surveying #RTK #Zimbabwe",
  ]);

  return {
    id: "surveyor",
    icon: "📐",
    title: "Surveyor Brief",
    audience: "Land surveyors, engineers & cadastral teams",
    headline: headlines[status],
    summary: summaries[status],
    spaceWeatherToday: `${swCtx.headline} ${swCtx.explainer}`,
    spaceWeatherBullets: swCtx.readout,
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
