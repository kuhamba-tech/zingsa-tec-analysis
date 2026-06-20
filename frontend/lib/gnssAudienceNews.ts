import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";

export type AudienceId = "farmer" | "surveyor" | "citizen" | "driver";

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
      "For most Zimbabweans this is invisible good news: maps, mobile money location checks, emergency call positioning, and in-car navigation should behave normally.",
    moderate:
      "You may notice your phone taking longer to find you, delivery apps showing a wider blue dot, or precision equipment (surveyors, farmers) needing extra patience — especially in the afternoon.",
    warning:
      "Ordinary navigation can mislead you today. Do not trust a map pin alone for remote travel, emergency response, or meeting someone at an exact spot. Space weather is temporary, but while it lasts, confirm locations the old-fashioned way — by sight, address, or phone call.",
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
      "Did you know your phone's location comes from satellites passing through space weather? Today the Sun is quiet, Earth's magnetic field is stable, and the ionosphere over Zimbabwe is smooth. That means Google Maps, WhatsApp live location, ride-hailing apps, and emergency services can find you reliably.",
    moderate:
      "Space weather is the 'weather in space' — solar wind and magnetic storms that ripple through the ionosphere where GPS signals travel. Today those ripples are small but real. Your phone might take a few extra seconds to lock on, or show you standing across the street from where you actually are. It is not your phone breaking; it is the sky above you shifting.",
    warning:
      "When the Sun throws energy at Earth, navigation satellites and your phone feel it first. Today geomagnetic and ionospheric activity is high enough to disturb positioning across parts of Zimbabwe. Maps may show the wrong place, rides may pick up at the wrong corner, and emergency callers should say their address out loud — do not assume the operator sees your exact pin.",
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
    moderate: "Wait a few seconds before trusting a map pin. If calling 999/993/994, confirm your address verbally.",
    warning: "Do not rely on GPS alone today. Confirm meeting points by phone and use street names, not just map arrows.",
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
    "_Free public service · Zimbabwe National Geospatial & Space Agency (ZINGSA)_",
  ]);

  const social = joinScript([
    "🇿🇼 ZINGSA Navigation News | Space Weather & You",
    swCtx.headline,
    summaries[status].split(".")[0] + ".",
    actions[status],
    "#SpaceWeather #Zimbabwe #GPS #PublicAwareness",
  ]);

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
    channels: ["Facebook Page", "X / Twitter", "Community WhatsApp", "Radio bulletins", "School outreach"],
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
    channels: ["WhatsApp farmer groups", "In-app alerts", "Facebook Page"],
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
    channels: ["WhatsApp surveyor groups", "In-app alerts", "LinkedIn"],
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
    channels: ["WhatsApp driver groups", "Fleet dispatch SMS", "Facebook Page"],
  };
}

/** Build copy-ready audience briefs for UI and future AI broadcast agent. */
export function buildAudienceNews(
  forecasts: GnssForecastCity[],
  computedAt: string,
  sw: SpaceWeatherCurrent | null = null,
): NavigationNewsBrief[] {
  const cities = byCity(forecasts);
  const tone = nationalTone(forecasts);

  return [
    citizenBrief(forecasts, tone, sw, computedAt),
    farmerBrief(cities.HARARE, tone, sw, computedAt),
    surveyorBrief(cities.MUTARE, cities.HARARE, tone, sw, computedAt),
    driverBrief(forecasts, tone, sw, computedAt),
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
