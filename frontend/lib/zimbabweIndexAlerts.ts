import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";

/** ZINGSA operating limits. An alert is issued only after a measured value crosses one. */
const VTEC_LIMIT = 40;
const S4_LIMIT = 0.35;
const KP_LIMIT = 4;
const DST_LIMIT = -30;
const BZ_LIMIT = -5;
const WIND_LIMIT = 550;
const DENSITY_LIMIT = 10;
const BT_LIMIT = 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ZimbabweAlertSeverity = "Moderate" | "High" | "Severe";

export type ZimbabweIndexAlert = {
  code: string;
  name: string;
  valueText: string;
  limitText: string;
  severity: ZimbabweAlertSeverity;
  meaning: string;
  explanation: string;
  retrievedAt: string;
  validFrom: string;
  validTo: string;
  expired: boolean;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAlertUtc(value: string | Date | null | undefined): string | null {
  const date = value instanceof Date ? value : parseTime(value ?? null);
  if (!date) return null;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${day} ${hour}${minute} UTC`;
}

function validity(retrievedIso: string | null | undefined, minutes: number, now: Date): {
  retrievedAt: string;
  validFrom: string;
  validTo: string;
  expired: boolean;
} | null {
  const start = parseTime(retrievedIso);
  const from = formatAlertUtc(start);
  if (!start || !from) return null;
  const end = new Date(start.getTime() + minutes * 60_000);
  const until = formatAlertUtc(end);
  if (!until) return null;
  return { retrievedAt: from, validFrom: from, validTo: until, expired: end.getTime() < now.getTime() };
}

function feedTime(solar: SolarActivityFull | null, key: string): string | null {
  const stamp = solar?.feed_status?.[key]?.timestamp;
  return typeof stamp === "string" && stamp.trim() ? stamp : null;
}

function feedFresh(solar: SolarActivityFull | null, key: string): boolean {
  return Boolean(solar?.feed_status?.[key]?.fresh);
}

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? text : text;
}

export function kpWords(kp: number): string {
  if (kp < 3) return "Quiet";
  if (kp < 4) return "Unsettled";
  if (kp < 5) return "Active";
  if (kp < 6) return "G1, minor storm";
  if (kp < 7) return "G2, moderate storm";
  if (kp < 8) return "G3, strong storm";
  if (kp < 9) return "G4, severe storm";
  return "G5, extreme storm";
}

export function windWords(speed: number): string {
  if (speed < 400) return "Slow";
  if (speed < WIND_LIMIT) return "Average";
  return "Fast";
}

export function densityWords(density: number): string {
  if (density < 3) return "Low";
  if (density < DENSITY_LIMIT) return "Average";
  return "High";
}

export function fieldWords(bt: number): string {
  if (bt < 5) return "Weak";
  if (bt < BT_LIMIT) return "Average";
  return "Strong";
}

export function orientationWords(bz: number): string {
  if (bz <= -0.5) return "South";
  if (bz >= 0.5) return "North";
  return "Mixed";
}

function flareLetter(flareClass: string | null | undefined): "C" | "M" | "X" | null {
  const match = (flareClass || "").trim().match(/^([CMX])/i);
  if (!match) return null;
  return match[1].toUpperCase() as "C" | "M" | "X";
}

function push(
  alerts: ZimbabweIndexAlert[],
  alert: Omit<ZimbabweIndexAlert, "retrievedAt" | "validFrom" | "validTo" | "expired">,
  times: ReturnType<typeof validity>,
) {
  if (!times) return;
  alerts.push({ ...alert, ...times });
}

export function buildZimbabweIndexAlerts(
  sw: SpaceWeatherCurrent | null,
  solar: SolarActivityFull | null,
  now = new Date(),
): ZimbabweIndexAlert[] {
  const alerts: ZimbabweIndexAlert[] = [];
  const bundleTime = sw?.updated_utc ?? null;

  if (finite(sw?.kp) && sw.kp >= KP_LIMIT) {
    const severity: ZimbabweAlertSeverity = sw.kp >= 7 ? "Severe" : sw.kp >= 5 ? "High" : "Moderate";
    push(alerts, {
      code: "ZWKP",
      name: "Planetary K",
      valueText: `Kp ${signed(sw.kp, 1)} (${kpWords(sw.kp)})`,
      limitText: `Kp ${KP_LIMIT} (Active). G1 begins at Kp 5.`,
      severity,
      meaning: `Planetary K is ${signed(sw.kp, 1)}, above the Active threshold of ${KP_LIMIT}.`,
      explanation: sw.kp >= 5
        ? "Kp is at or above the G1 threshold. Intervals of this magnitude can alter TEC over Zimbabwe. Confirm with CORS TEC and S4, together with southward IMF Bz."
        : "Kp 4 is Active, still below the G1 threshold at Kp 5. Local impact over Zimbabwe is typically limited unless TEC or S4 also changes in the same window.",
    }, validity(bundleTime, 180, now));
  }

  if (finite(sw?.dst) && sw.dst <= DST_LIMIT) {
    const severity: ZimbabweAlertSeverity = sw.dst <= -100 ? "Severe" : sw.dst <= -50 ? "High" : "Moderate";
    push(alerts, {
      code: "ZWDST",
      name: "Ring current",
      valueText: `Dst ${signed(sw.dst, 0)} nT`,
      limitText: `${DST_LIMIT} nT (watch). A storm reading begins at −50 nT.`,
      severity,
      meaning: `Dst is ${signed(sw.dst, 0)} nT, below the watch threshold of ${DST_LIMIT} nT.`,
      explanation: sw.dst <= -50
        ? "Dst is at or below the −50 nT storm threshold. The ring current is enhanced. Confirm concurrent CORS TEC and S4."
        : "Dst between −30 and −50 nT is elevated but remains above the −50 nT storm threshold. Monitor CORS TEC and S4 for GNSS impact.",
    }, validity(bundleTime, 15, now));
  }

  if (finite(sw?.mean_vtec) && sw.mean_vtec >= VTEC_LIMIT) {
    const severity: ZimbabweAlertSeverity = sw.mean_vtec >= 100 ? "Severe" : "High";
    push(alerts, {
      code: "ZWTEC",
      name: "Zimbabwe TEC",
      valueText: `${signed(sw.mean_vtec, 1)} TECU`,
      limitText: `${VTEC_LIMIT} TECU (high band on the Zimbabwe ionosphere scale).`,
      severity,
      meaning: `CORS network mean TEC is ${signed(sw.mean_vtec, 1)} TECU, above ${VTEC_LIMIT} TECU.`,
      explanation: sw.mean_vtec >= 100
        ? "TEC is in the storm band of the Zimbabwe scale. GNSS range delay is large. Cross-check with Kp, Dst and S4."
        : "TEC is in the high band of the Zimbabwe scale. GNSS range delay is elevated relative to quiet conditions. Storm classification requires concurrent Kp, Dst or S4 disturbance.",
    }, validity(bundleTime, 15, now));
  }

  if (finite(sw?.s4) && sw.s4 >= S4_LIMIT) {
    const severity: ZimbabweAlertSeverity = sw.s4 >= 0.7 ? "Severe" : sw.s4 >= 0.5 ? "High" : "Moderate";
    push(alerts, {
      code: "ZWS4",
      name: "Scintillation",
      valueText: `S4 ${signed(sw.s4, 2)}`,
      limitText: `S4 ${S4_LIMIT.toFixed(2)} (moderate). Strong begins at 0.50 and severe at 0.70.`,
      severity,
      meaning: `S4 is ${signed(sw.s4, 2)}, above the moderate scintillation threshold of ${S4_LIMIT.toFixed(2)}.`,
      explanation: "S4 measures intensity scintillation on GNSS signals over Zimbabwe. Above this threshold, receivers may lose lock, particularly on low-elevation satellites.",
    }, validity(bundleTime, 15, now));
  }

  const windTime = feedTime(solar, "solar_wind_plasma") ?? solar?.updated ?? null;
  const magTime = feedTime(solar, "solar_wind_mag") ?? solar?.updated ?? null;
  const windFresh = feedFresh(solar, "solar_wind_plasma");
  const magFresh = feedFresh(solar, "solar_wind_mag");
  const speed = windFresh && finite(solar?.solar_wind?.speed) && solar.solar_wind.speed > 0 ? solar.solar_wind.speed : null;
  const density = windFresh && finite(solar?.solar_wind?.density) && solar.solar_wind.density > 0 ? solar.solar_wind.density : null;
  const bt = magFresh && finite(solar?.solar_wind?.bt) && solar.solar_wind.bt > 0 ? solar.solar_wind.bt : null;
  const bz = magFresh && finite(solar?.solar_wind?.bz) ? solar.solar_wind.bz : null;

  if (speed != null && speed >= WIND_LIMIT) {
    push(alerts, {
      code: "ZWWND",
      name: "Solar wind speed",
      valueText: `${signed(speed, 0)} km/s (${windWords(speed)})`,
      limitText: `${WIND_LIMIT} km/s (fast).`,
      severity: speed >= 700 ? "Severe" : "High",
      meaning: `Solar wind speed is ${signed(speed, 0)} km/s, above the fast-wind threshold of ${WIND_LIMIT} km/s.`,
      explanation: "A fast stream can elevate geomagnetic activity when the interplanetary field turns south. Zimbabwe impact is confirmed only on measured TEC and S4.",
    }, validity(windTime, 15, now));
  }

  if (density != null && density >= DENSITY_LIMIT) {
    push(alerts, {
      code: "ZWDEN",
      name: "Solar wind density",
      valueText: `${signed(density, 1)} /cm³ (${densityWords(density)})`,
      limitText: `${DENSITY_LIMIT} /cm³ (high).`,
      severity: density >= 20 ? "Severe" : "High",
      meaning: `Solar wind density is ${signed(density, 1)} per cm³, above the high-density threshold of ${DENSITY_LIMIT}.`,
      explanation: "Elevated density increases solar-wind dynamic pressure on Earth's magnetic field. GNSS impact over Zimbabwe is more likely when Bz is also southward.",
    }, validity(windTime, 15, now));
  }

  if (bt != null && bt >= BT_LIMIT) {
    push(alerts, {
      code: "ZWBT",
      name: "IMF strength",
      valueText: `Bt ${signed(bt, 1)} nT (${fieldWords(bt)})`,
      limitText: `${BT_LIMIT} nT (strong).`,
      severity: bt >= 15 ? "Severe" : "High",
      meaning: `Interplanetary field strength is ${signed(bt, 1)} nT, above the strong-field threshold of ${BT_LIMIT} nT.`,
      explanation: "A strong interplanetary field couples more energy into the magnetosphere when Bz is southward. Confirm Zimbabwe impact on CORS TEC and S4.",
    }, validity(magTime, 15, now));
  }

  if (bz != null && bz <= BZ_LIMIT) {
    const severity: ZimbabweAlertSeverity = bz <= -20 ? "Severe" : bz <= -10 ? "High" : "Moderate";
    push(alerts, {
      code: "ZWBZ",
      name: "IMF orientation",
      valueText: `Bz ${signed(bz, 1)} nT (South)`,
      limitText: `${BZ_LIMIT} nT (southward coupling).`,
      severity,
      meaning: `Bz is ${signed(bz, 1)} nT, below the southward-coupling threshold of ${BZ_LIMIT} nT.`,
      explanation: "Southward Bz favours solar-wind–magnetosphere coupling. Monitor CORS TEC and S4 for subsequent change over Zimbabwe.",
    }, validity(magTime, 15, now));
  }

  const letter = feedFresh(solar, "goes_xray") ? flareLetter(solar?.flare_class) : null;
  if (letter) {
    push(alerts, {
      code: "ZWXRY",
      name: "GOES X-ray",
      valueText: solar?.flare_class ?? letter,
      limitText: "C-class. M is high and X is severe.",
      severity: letter === "X" ? "Severe" : letter === "M" ? "High" : "Moderate",
      meaning: `GOES soft X-rays are ${solar?.flare_class}, at or above C-class.`,
      explanation: "On the sunlit hemisphere, including Zimbabwe in daylight, HF links may fade for minutes. Confirm GNSS effects with a dayside TEC rise. Earth-directed CMEs are assessed separately.",
    }, validity(feedTime(solar, "goes_xray") ?? solar?.updated ?? null, 15, now));
  }

  return alerts;
}
