import type { SpaceWeatherCurrent } from "./types";
import type { LiveStationCounts } from "./liveStationStatus";
import { connectedStreamCount, formatCorsConnectedDisplay } from "./liveStationStatus";
import { kpConditionFromValue } from "./homeSpaceWeather";

export type MetricKey =
  | "kp"
  | "geomagnetic"
  | "dst"
  | "f107"
  | "solar_wind"
  | "s4"
  | "gnss_risk"
  | "stations";

export interface MetricCardSpec {
  key: MetricKey;
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
}

export const METRIC_EXPLANATIONS: Record<MetricKey, string> = {
  kp:
    "A 0-9 scale updated every 3 hours that summarises how disturbed Earth's magnetic field is across the entire planet. It is derived from a network of ground magnetometers worldwide. Kp 0-1 indicates quiet conditions, while Kp 5 or higher marks the beginning of a geomagnetic storm. Kp 8-9 represents an extreme storm. Zimbabwe's CORS network is directly affected from Kp 5 onwards as ionospheric irregularities increase sharply.",
  geomagnetic:
    "A geomagnetic storm is a major temporary disturbance of Earth's magnetosphere caused by solar activity. A solar-wind shock wave or coronal mass ejection colliding with Earth compresses the dayside magnetosphere and stretches its nightside, driving electric currents that affect power grids and GNSS satellites. Storms are classified G1-G5 using Kp, with G5 the most severe. Zimbabwe's equatorial location means scintillation and TEC spikes are the primary impacts.",
  dst:
    "The Disturbance Storm Time index measures the average horizontal magnetic field around Earth's equator. When a solar storm reaches Earth, it compresses and distorts the magnetic field, causing the Dst value to drop sharply negative. The more negative the value, the more severe the geomagnetic storm. It acts as a global magnetic-disturbance meter.",
  f107:
    "Solar Flux F10.7 measures the radio energy emitted by the Sun at a 10.7 cm wavelength (2.8 GHz). It is a reliable daily proxy for solar ultraviolet radiation, the main driver of ionospheric electron density and TEC. Higher F10.7 means a more ionised, electrically thicker atmosphere above Zimbabwe, which increases GNSS error and signal degradation.",
  solar_wind:
    "The Sun continuously releases a stream of charged particles called the solar wind. Normal speed is about 400 km/s. When a solar eruption reaches Earth, the speed can rise above 700 km/s. High-speed streams compress Earth's magnetosphere and amplify geomagnetic effects, acting as the delivery mechanism for solar storms.",
  s4:
    "The S4 scintillation index measures how much a GNSS or radio signal's amplitude fluctuates while passing through irregular ionospheric plasma. S4 = 0 means a steady signal, while S4 = 1 indicates severe fluctuation and possible total fading. Values above 0.5 can cause receivers to lose lock on satellites. This is especially important near Zimbabwe's equatorial region.",
  gnss_risk:
    "GNSS Risk is a combined operational assessment for positioning and navigation users. It considers geomagnetic activity, ionospheric TEC, S4 scintillation and related space-weather indicators. Low risk supports routine CORS and RTK operations; increasing risk means users should verify fixes, use dual-frequency observations and consider post-processing.",
  stations:
    "Stations Online shows how many Zimbabwe CORS stations have an active NTRIP connection (receiving MSM or connected idle) compared with the total network. Receiving = MSM streaming; Idle = connected without MSM yet. A lower connected count reduces geographic coverage and may weaken real-time correction reliability.",
};

function dstColor(dst: number | null): string {
  if (dst === null) return "#ffffff";
  if (dst < -100) return "#ef4444";
  if (dst < -50) return "#f97316";
  if (dst < -20) return "#eab308";
  return "#00ff88";
}

function s4Color(s4: number | null): string {
  if (s4 === null) return "#ffffff";
  if (s4 >= 0.5) return "#ef4444";
  if (s4 >= 0.3) return "#f97316";
  if (s4 >= 0.1) return "#eab308";
  return "#00ff88";
}

function solarWindColor(speed: number | null): string {
  if (speed === null) return "#ffffff";
  if (speed > 600) return "#ef4444";
  if (speed > 400) return "#eab308";
  return "#00ff88";
}

export interface MetricCardOptions {
  liveStationCounts?: LiveStationCounts | null;
  ekfFilled?: Set<string>;
}

/** Single display rules for every dashboard surface (cards, Navigation News, briefs). */
export function formatKpDisplay(kp: number | null | undefined): string {
  if (kp == null || !Number.isFinite(kp)) return "N/A";
  const rounded = Math.round(kp * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatDstDisplay(dst: number | null | undefined): string {
  if (dst == null || !Number.isFinite(dst)) return "N/A";
  const rounded = Math.round(dst * 10) / 10;
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded} nT`;
}

export function formatF107Display(f107: number | null | undefined): string {
  if (f107 == null || !Number.isFinite(f107)) return "N/A";
  return String(Math.round(f107 * 10) / 10);
}

export function formatSolarWindDisplay(speed: number | null | undefined): string {
  if (speed == null || !Number.isFinite(speed)) return "N/A";
  return `${Math.round(speed)} km/s`;
}

export function formatS4Display(s4: number | null | undefined): string {
  if (s4 == null || !Number.isFinite(s4)) return "N/A";
  return s4.toFixed(2);
}

/** Index detail lines for Navigation News sector cards — must match metric cards exactly. */
export function formatPowerIndicesDetail(sw: SpaceWeatherCurrent | null): string | undefined {
  if (!sw || sw.kp == null || sw.dst == null) return undefined;
  return `Kp ${formatKpDisplay(sw.kp)} · Dst ${formatDstDisplay(sw.dst)}`;
}

export function formatTelecomIndicesDetail(sw: SpaceWeatherCurrent | null): string | undefined {
  if (!sw || sw.s4 == null) return undefined;
  return `S4 ${formatS4Display(sw.s4)} · ionospheric amplitude scintillation index`;
}

export function formatIndicesUpdatedLabel(sw: SpaceWeatherCurrent | null): string | null {
  const raw = sw?.updated_utc;
  if (!raw) return null;
  return raw.replace("T", " ").replace("Z", " UTC").slice(0, 19);
}

export function buildMetricCards(
  sw: SpaceWeatherCurrent | null,
  opts?: MetricCardOptions,
): MetricCardSpec[] {
  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const f107 = sw?.f107 ?? null;
  const s4 = sw?.s4 ?? null;
  const wind = sw?.plasma_speed ?? null;
  const online = sw?.stations_online ?? null;
  const total = sw?.stations_total ?? null;
  const kpColor = sw?.kp_color ?? "#168bd2";
  const riskColor = sw?.gnss_risk_color ?? "#1D9E75";
  const ekfFilled = opts?.ekfFilled ?? new Set<string>();
  const liveCounts = opts?.liveStationCounts;

  const ekfSuffix = (key: string) => (ekfFilled.has(key) ? " · EKF predicted" : "");

  const dstValue = formatDstDisplay(dst);
  const stationsOnlineCount = liveCounts ? connectedStreamCount(liveCounts) : online;
  const stationsTotal = liveCounts?.total ?? total;
  const corsDisplay = liveCounts ? formatCorsConnectedDisplay(liveCounts) : null;
  const stationsLabel =
    corsDisplay?.value ??
    (stationsOnlineCount !== null && stationsTotal ? `${stationsOnlineCount}/${stationsTotal}` : "N/A");
  const windValue = formatSolarWindDisplay(wind);

  const stationsNote = corsDisplay?.note ?? "CORS connected (NTRIP probe pending)";

  return [
    {
      key: "kp",
      icon: "🧭",
      label: "Kp Index",
      value: formatKpDisplay(kp),
      note: `Planetary activity${ekfSuffix("kp")}`,
      valueColor: kp !== null ? "#168bd2" : "#ffffff",
    },
    {
      key: "geomagnetic",
      icon: "🌌",
      label: "Geomagnetic",
      value: sw?.kp_condition ?? "N/A",
      note: `Current state${ekfSuffix("kp_condition") || ekfSuffix("kp")}`,
      valueColor: kpColor,
    },
    {
      key: "dst",
      icon: "🌡️",
      label: "Dst Index",
      value: dstValue,
      note: "Storm index",
      valueColor: dstColor(dst),
    },
    {
      key: "f107",
      icon: "☀️",
      label: "Solar Flux",
      value: formatF107Display(f107),
      note: "Solar flux units",
      valueColor: f107 !== null ? "#168bd2" : "#ffffff",
    },
    {
      key: "solar_wind",
      icon: "🌬️",
      label: "Solar Wind",
      value: windValue,
      note: "Solar wind speed",
      valueColor: solarWindColor(wind),
    },
    {
      key: "s4",
      icon: "📶",
      label: "Scintillation S4",
      value: formatS4Display(s4),
      note: s4 !== null ? "Observed archive" : "Observed data unavailable",
      valueColor: s4Color(s4),
    },
    {
      key: "gnss_risk",
      icon: "🛰️",
      label: "GNSS Risk",
      value: sw?.gnss_risk ?? "N/A",
      note: "Navigation impact",
      valueColor: riskColor,
    },
    {
      key: "stations",
      icon: "📡",
      label: "CORS Connected",
      value: stationsLabel,
      note: stationsNote,
      valueColor: "#168bd2",
    },
  ];
}

export function interpretMetric(sw: SpaceWeatherCurrent | null, key: MetricKey): string {
  if (!sw) return "Live data is unavailable. No interpretation can be issued.";

  const kp = sw.kp;
  const dst = sw.dst;
  const f107 = sw.f107;
  const s4 = sw.s4;
  const wind = sw.plasma_speed;
  const online = sw.stations_online;
  const total = sw.stations_total;

  switch (key) {
    case "kp":
      if (kp === null) {
        return "The live Kp feed is unavailable. No geomagnetic interpretation is issued.";
      }
      if (kp < 3) {
        return `Kp ${kp} indicates quiet geomagnetic conditions. GNSS and CORS operations should remain stable, with minimal storm-related disturbance.`;
      }
      if (kp < 4) {
        return `Kp ${kp} indicates unsettled conditions. Small ionospheric changes are possible, so precision users should continue monitoring.`;
      }
      if (kp < 5) {
        return `Kp ${kp} indicates active geomagnetic conditions. Increased TEC variation and scintillation may begin affecting precise positioning.`;
      }
      if (kp < 7) {
        return `Kp ${kp} indicates a G1-G2 geomagnetic storm. GNSS accuracy, RTK fixes and CORS corrections may be degraded.`;
      }
      return `Kp ${kp} indicates a strong to extreme geomagnetic storm. Significant GNSS disruption and positioning errors should be expected.`;

    case "geomagnetic":
      if (kp === null) {
        return "The geomagnetic condition is unavailable because no live Kp observation was received.";
      }
      return `The current geomagnetic state is ${sw.kp_condition}. ${
        kp < 3
          ? "Earth's magnetic field is presently stable, supporting normal GNSS operations."
          : "Magnetic disturbance is active and precision GNSS performance should be monitored."
      }`;

    case "dst":
      if (dst === null) {
        return "No current Dst measurement is available, so ring-current storm intensity cannot be interpreted from this indicator at present.";
      }
      let level: string;
      if (dst > -20) level = "quiet";
      else if (dst > -50) level = "weakly disturbed";
      else if (dst > -100) level = "moderately disturbed";
      else if (dst > -200) level = "an intense geomagnetic storm";
      else if (dst > -350) level = "a severe geomagnetic storm";
      else level = "an exceptional super-storm";
      return `Dst ${formatDstDisplay(dst)} indicates ${level} conditions.`;

    case "f107":
      if (f107 === null) {
        return "The live F10.7 feed is unavailable. No solar-flux interpretation is issued.";
      }
      let fluxLevel: string;
      if (f107 < 80) fluxLevel = "solar-minimum activity and generally low background ionisation";
      else if (f107 < 100) fluxLevel = "low solar activity";
      else if (f107 < 130) fluxLevel = "below-average to moderate solar activity";
      else if (f107 < 170) fluxLevel = "moderate solar activity and elevated daytime TEC";
      else if (f107 < 220) fluxLevel = "high solar activity with increased ionospheric electron density";
      else fluxLevel = "very high to extreme solar activity";
      return `F10.7 at ${f107} SFU indicates ${fluxLevel}.`;

    case "solar_wind":
      if (wind === null) {
        return "No current solar-wind speed is available, so its present influence on Earth's magnetosphere cannot be assessed.";
      }
      let windLevel: string;
      if (wind < 350) windLevel = "a slow solar wind with limited geomagnetic forcing";
      else if (wind < 450) windLevel = "a typical solar-wind flow";
      else if (wind < 550) windLevel = "a fast solar wind that may increase geomagnetic activity";
      else if (wind < 650) windLevel = "a very fast stream capable of disturbing the magnetosphere";
      else windLevel = "storm-level solar wind with elevated geomagnetic risk";
      return `A solar-wind speed of ${wind} km/s represents ${windLevel}.`;

    case "s4":
      if (s4 === null) {
        return "No observed S4 measurement is available.";
      }
      let s4Level: string;
      if (s4 < 0.1) s4Level = "no significant scintillation and a stable GNSS signal";
      else if (s4 < 0.2) s4Level = "negligible scintillation";
      else if (s4 < 0.3) s4Level = "weak scintillation with minor signal fluctuation";
      else if (s4 < 0.5) s4Level = "moderate scintillation that may reduce positioning quality";
      else if (s4 < 0.7) s4Level = "strong scintillation with possible satellite lock loss";
      else s4Level = "severe scintillation and a high risk of signal outage";
      return `S4 at ${s4.toFixed(2)} indicates ${s4Level}.`;

    case "gnss_risk": {
      const interpretations: Record<string, string> = {
        Low: "Routine GNSS, RTK and CORS operations can continue normally.",
        Moderate: "Verify precision fixes and monitor ionospheric conditions.",
        High: "Expect positioning degradation; use dual-frequency data and validation.",
        Critical: "GNSS positioning may be unreliable; postpone critical operations where possible.",
      };
      const risk = sw.gnss_risk ?? "Unknown";
      return `The current GNSS risk is ${risk}. ${interpretations[risk] ?? "Continue monitoring current conditions."}`;
    }

    case "stations":
      if (online === null || !total) {
        return "No live CORS telemetry is available.";
      }
      {
        const availability = (online / total) * 100;
        let availLevel: string;
        if (availability >= 90) availLevel = "excellent network availability";
        else if (availability >= 70) availLevel = "good availability with some local coverage gaps";
        else if (availability >= 50) availLevel = "reduced availability that may affect regional corrections";
        else availLevel = "low availability with significant CORS coverage limitations";
        return `${online} of ${total} CORS stations are NTRIP-connected (${availability.toFixed(0)}%), indicating ${availLevel}.`;
      }
  }
}

/** Short geomagnetic / ionospheric condition label for chart point tooltips. */
export function kpGeomagneticCondition(kp: number | null | undefined): string | null {
  if (kp == null || !Number.isFinite(kp)) return null;
  return kpConditionFromValue(kp).label;
}

export function dstGeomagneticCondition(dst: number | null | undefined): string | null {
  if (dst == null || !Number.isFinite(dst)) return null;
  if (dst > -20) return "Quiet";
  if (dst > -50) return "Weak disturbance";
  if (dst > -100) return "Moderate storm";
  if (dst > -200) return "Intense storm";
  if (dst > -350) return "Severe storm";
  return "Super storm";
}

export function tecIonosphericCondition(tec: number | null | undefined): string | null {
  if (tec == null || !Number.isFinite(tec)) return null;
  if (tec < 10) return "Very low";
  if (tec < 25) return "Low";
  if (tec < 40) return "Moderate";
  if (tec < 60) return "Elevated";
  if (tec < 100) return "High";
  return "Severe storm level";
}

export function s4ScintillationCondition(s4: number | null | undefined): string | null {
  if (s4 == null || !Number.isFinite(s4)) return null;
  if (s4 < 0.1) return "None";
  if (s4 < 0.2) return "Negligible";
  if (s4 < 0.3) return "Weak";
  if (s4 < 0.5) return "Moderate";
  if (s4 < 0.7) return "Strong";
  if (s4 < 0.9) return "Severe";
  return "Full outage risk";
}

export function conditionsForSeries(
  values: (number | null)[],
  kind: "kp" | "dst" | "tec" | "s4",
): (string | null)[] {
  const fn =
    kind === "kp"
      ? kpGeomagneticCondition
      : kind === "dst"
        ? dstGeomagneticCondition
        : kind === "tec"
          ? tecIonosphericCondition
          : s4ScintillationCondition;
  return values.map((v) => fn(v));
}
