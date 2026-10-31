import { monitoringFreshness } from "./monitoringStatus";
import type { SolarActivityFull, SpaceWeatherCurrent } from "./types";
import type { LiveStationCounts } from "./liveStationStatus";
import { connectedStreamCount, formatCorsConnectedDisplay } from "./liveStationStatus";
import { kpConditionFromValue } from "./homeSpaceWeather";
import {
  donkiCmeCountColor,
  donkiFlareCountColor,
  donkiStormCountColor,
} from "./solarEventColors";
import { tecTypicalContext } from "./tecPrimer";
import {
  BZ_BEAT,
  CYCLE_25_SCALE,
  DST_BEAT,
  FLARE_BEAT,
  HOW_BULLETINS_ARE_WRITTEN,
  KP_BEAT,
  TEC_BEAT,
  WIND_BEAT,
  ZIMBABWE_TRANSLATION,
} from "./scientistBulletin";

/** Primary Sun→Zimbabwe summary cards (Phase 1 redesign). */
export type MetricKey =
  | "solar_activity"
  | "solar_flare"
  | "solar_wind"
  | "imf_bz"
  | "geomagnetic_storm"
  | "dst"
  | "zimbabwe_iono"
  | "gnss_risk"
  | "stations"
  | "donki_flares"
  | "donki_cmes"
  | "donki_storms";

/** Keys kept for Advanced Scientific Indices (not primary cards). */
export type AdvancedMetricKey = "ap" | "f107" | "kp";

export interface MetricDetailRow {
  label: string;
  value: string;
  valueColor?: string;
  /** Optional leading icon for list-style rows (Solar Wind plasma fields). */
  icon?: string;
}

export interface MetricCardSpec {
  key: MetricKey;
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
  source?: string;
  observedAt?: string | null;
  freshness?: "LIVE" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Optional flux / secondary line under the hero value (Solar Flare GOES). */
  subtitle?: string | null;
  /** Label/value rows like the Solar Activity summary card. */
  detailRows?: MetricDetailRow[];
  /** Show A–X GOES flare class legend under the card body. */
  showFlareScale?: boolean;
  /** Show G0–G5 NOAA geomagnetic scale under the card body. */
  showGScale?: boolean;
  /** Active G-scale code to emphasize (e.g. "G0"). */
  activeGCode?: string | null;
  /** Active KP-band id on the Geomagnetic Storm card (quiet/unsettled/…). */
  activeKpBand?: string | null;
  /** Show N/D/H/S/X typical-VTEC scale under the Zimbabwe Ionosphere card. */
  showTecScale?: boolean;
  /** Active TEC-scale code to emphasize (e.g. "D"). */
  activeTecCode?: string | null;
}

export interface MetricCardOptions {
  now?: number;
  refreshFailed?: boolean;
  solarRefreshFailed?: boolean;
  liveStationCounts?: LiveStationCounts | null;
  ekfFilled?: Set<string>;
  solar?: SolarActivityFull | null;
  /** Optional live network mean when /current mean_vtec is empty. */
  liveMeanVtec?: number | null;
  /** True while solar-activity feed is still resolving (avoid N/A flash). */
  solarLoading?: boolean;
  /** True while /current indices are still resolving. */
  indicesLoading?: boolean;
}

export const METRIC_EXPLANATIONS: Record<MetricKey, string> = {
  solar_activity: `${HOW_BULLETINS_ARE_WRITTEN} ${CYCLE_25_SCALE} The activity level on this card is that first beat: GOES flare context plus the SWPC bulletin count. It is not a geomagnetic storm rating.`,
  solar_flare: `${FLARE_BEAT} Classes A/B/C/M/X are the 0.1–0.8 nm X-ray flux. Each letter is about ten times the flux of the letter before it. The number is only the multiplier inside that class.`,
  solar_wind: `${WIND_BEAT} The card value is bulk speed. Density, proton temperature, Bz and Bt are the fields that decide whether the stream is geoeffective.`,
  imf_bz: `${BZ_BEAT} Southward Bz favours reconnection. A brief negative spike is reported as a fluctuation, not as a storm.`,
  geomagnetic_storm: `${KP_BEAT} ${ZIMBABWE_TRANSLATION}`,
  dst: `${DST_BEAT} Do not convert a Dst value into a NOAA G1–G5 label.`,
  zimbabwe_iono: `${TEC_BEAT} ${ZIMBABWE_TRANSLATION} Network VTEC is the line integral of electron density (1 TECU = 10¹⁶ el/m²). The colour strip is magnitude — Low below 10, Typical 10–40, High 40–100, Storm 100–200, Extreme above 200 TECU — not the local time of day. ΔTEC and ROTI stay unpublished until a quiet-day reference is validated.`,
  gnss_risk:
    "Write this label as a provisional operations line, not as proof that a receiver has failed. Name the driver (dayside flare, CME arrival, or coronal-hole stream), the Kp or G-scale, and whether Zimbabwe TEC or S4 has actually moved. Until local ΔTEC, ROTI and RTK rules are validated, the score is context from Kp, the scintillation archive and related indices.",
  stations:
    "State how many of the 19 ZINGSA CORS stations are online. Online is not the same as a fresh TEC solution. A drop in the count can put a hole in the network-mean TEC and S4 graphs, so say so before treating a TEC change as ionospheric.",
  donki_flares:
    "This is the 7-day flare count. It is not the 26 August M2.2 event by itself. In a bulletin each flare still needs a class, a peak time in UTC, and whether it was eruptive. More flares mean a more active disk. They do not, by themselves, mean an Earth-directed ejection or a storm at Kp.",
  donki_cmes:
    "This count is the CME catalogue for the selected 7 days. It is not the October or August watch by itself. Sort each ejection: Earth-directed plasma can arrive in 1–3 days, a glancing edge is weaker and less certain, and a limb or farside CME is directed away unless a later Earth-directed part is measured. Not every CME is geoeffective. The two watches below show how NOAA describes an ejection on its own, and an ejection that follows a coronal-hole stream.",
  donki_storms:
    "These are Earth-side geomagnetic storms in the 7-day window, closer to GNSS impact than a flare count. Still write Kp, Dst and Bz, then check the Zimbabwe TEC and S4 graphs before claiming a local effect.",
};

export interface NoaaGScale {
  /** G0 … G5 */
  code: string;
  /** e.g. "Quiet", "Minor Storm" */
  title: string;
  /** Primary card value line */
  display: string;
  note: string;
  color: string;
  isStorm: boolean;
}

/** NOAA G-scale colour strip — storm codes G0–G5. */
export const NOAA_G_SCALE = [
  { code: "G0", color: "#22c55e", desc: "Quiet / below storm (Kp 0–4)" },
  { code: "G1", color: "#f97316", desc: "Minor (Kp 5)" },
  { code: "G2", color: "#ef4444", desc: "Moderate (Kp 6)" },
  { code: "G3", color: "#dc2626", desc: "Strong (Kp 7)" },
  { code: "G4", color: "#991b1b", desc: "Severe (Kp 8)" },
  { code: "G5", color: "#a855f7", desc: "Extreme (Kp 9)" },
] as const;

/**
 * KP geomagnetic scale reference used on the Geomagnetic Storm metric card
 * (Quiet → Unsettled → Active → Minor Storm → Moderate G2 … Extreme G5).
 */
export const KP_GEOMAGNETIC_SCALE = [
  { id: "quiet", code: "G0", desc: "Quiet", short: "Quiet", color: "#22c55e", kpMin: 0, kpMaxExclusive: 3 },
  { id: "unsettled", code: "G0", desc: "Unsettled", short: "Unsettled", color: "#84cc16", kpMin: 3, kpMaxExclusive: 4 },
  { id: "active", code: "G0", desc: "Active", short: "Active", color: "#eab308", kpMin: 4, kpMaxExclusive: 5 },
  { id: "minor", code: "G1", desc: "Minor Storm", short: "Minor", color: "#f97316", kpMin: 5, kpMaxExclusive: 6 },
  { id: "moderate", code: "G2", desc: "Moderate G2", short: "Moderate", color: "#ef4444", kpMin: 6, kpMaxExclusive: 7 },
  { id: "strong", code: "G3", desc: "Strong G3", short: "Strong", color: "#dc2626", kpMin: 7, kpMaxExclusive: 8 },
  { id: "severe", code: "G4", desc: "Severe G4", short: "Severe", color: "#991b1b", kpMin: 8, kpMaxExclusive: 9 },
  { id: "extreme", code: "G5", desc: "Extreme G5", short: "Extreme", color: "#a855f7", kpMin: 9, kpMaxExclusive: Number.POSITIVE_INFINITY },
] as const;

export type KpGeomagneticBandId = (typeof KP_GEOMAGNETIC_SCALE)[number]["id"];

/**
 * Typical VTEC magnitude bands for the Zimbabwe Ionosphere card.
 * Labels are intensity tiers (quiet-night-like → quiet-day-like → …),
 * NOT the current local time of day.
 */
export const TEC_VTEC_SCALE = [
  { code: "N", color: "#00ff88", desc: "Low", range: "<10", minInclusive: 0, maxExclusive: 10 },
  { code: "D", color: "#38bdf8", desc: "Typical", range: "10–40", minInclusive: 10, maxExclusive: 40 },
  { code: "H", color: "#eab308", desc: "High", range: "40–100", minInclusive: 40, maxExclusive: 100 },
  { code: "S", color: "#ef4444", desc: "Storm", range: "100–200", minInclusive: 100, maxExclusive: 200 },
  { code: "X", color: "#a855f7", desc: "Extreme", range: ">200", minInclusive: 200, maxExclusive: Number.POSITIVE_INFINITY },
] as const;

export type TecVtecScaleCode = (typeof TEC_VTEC_SCALE)[number]["code"];

export interface TecVtecScaleLevel {
  code: TecVtecScaleCode | "—";
  title: string;
  range: string;
  color: string;
}

/** Map network mean VTEC (TECU) onto the N/D/H/S/X strip. */
export function tecScaleFromVtec(tec: number | null | undefined): TecVtecScaleLevel {
  if (tec == null || !Number.isFinite(tec)) {
    return { code: "—", title: "Unavailable", range: "—", color: "#94a3b8" };
  }
  const v = Math.max(0, tec);
  for (const level of TEC_VTEC_SCALE) {
    if (v < level.maxExclusive) {
      return {
        code: level.code,
        title: level.desc,
        range: level.range,
        color: level.color,
      };
    }
  }
  const last = TEC_VTEC_SCALE[TEC_VTEC_SCALE.length - 1];
  return { code: last.code, title: last.desc, range: last.range, color: last.color };
}

/** Format Kp for the Geomagnetic Storm card subtitle, e.g. `kP=0`. */
export function formatKpEqualsDisplay(kp: number | null | undefined, loading = false): string {
  if (kp == null || !Number.isFinite(kp)) return loading ? "kP=…" : "kP=—";
  const rounded = Math.round(kp * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `kP=${text}`;
}

/**
 * KP geomagnetic scale from Kp (matches the KP Scale reference tab):
 * 0–2 Quiet, 3 Unsettled, 4 Active, 5 Minor Storm, 6 Moderate G2 …
 * Never label Kp 0–2 as "No Storm".
 */
export function noaaGScaleFromKp(kp: number | null | undefined, loading = false): NoaaGScale & { bandId: KpGeomagneticBandId | "—" } {
  if (kp == null || !Number.isFinite(kp)) {
    return {
      code: "—",
      title: loading ? "Updating" : "Unavailable",
      display: loading ? "Updating…" : "Unavailable",
      note: loading ? "Kp loading" : "Kp feed unavailable",
      color: "#94a3b8",
      isStorm: false,
      bandId: "—",
    };
  }
  if (kp < 3) {
    return {
      code: "G0",
      title: "Quiet",
      display: "Quiet",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#22c55e",
      isStorm: false,
      bandId: "quiet",
    };
  }
  if (kp < 4) {
    return {
      code: "G0",
      title: "Unsettled",
      display: "Unsettled",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#84cc16",
      isStorm: false,
      bandId: "unsettled",
    };
  }
  if (kp < 5) {
    return {
      code: "G0",
      title: "Active",
      display: "Active",
      note: `Kp ${formatKpDisplay(kp)} · Below G1 storm threshold`,
      color: "#eab308",
      isStorm: false,
      bandId: "active",
    };
  }
  if (kp < 6) {
    return {
      code: "G1",
      title: "Minor Storm",
      display: "Minor Storm",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#f97316",
      isStorm: true,
      bandId: "minor",
    };
  }
  if (kp < 7) {
    return {
      code: "G2",
      title: "Moderate G2",
      display: "Moderate G2",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#ef4444",
      isStorm: true,
      bandId: "moderate",
    };
  }
  if (kp < 8) {
    return {
      code: "G3",
      title: "Strong G3",
      display: "Strong G3",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#dc2626",
      isStorm: true,
      bandId: "strong",
    };
  }
  if (kp < 9) {
    return {
      code: "G4",
      title: "Severe G4",
      display: "Severe G4",
      note: `Kp ${formatKpDisplay(kp)}`,
      color: "#991b1b",
      isStorm: true,
      bandId: "severe",
    };
  }
  return {
    code: "G5",
    title: "Extreme G5",
    display: "Extreme G5",
    note: `Kp ${formatKpDisplay(kp)}`,
    color: "#a855f7",
    isStorm: true,
    bandId: "extreme",
  };
}

function dstColor(dst: number | null): string {
  if (dst === null) return "#ffffff";
  if (dst < -100) return "#ef4444";
  if (dst < -50) return "#f97316";
  if (dst < -20) return "#eab308";
  return "#00ff88";
}

function apColor(ap: number | null): string {
  if (ap === null) return "#ffffff";
  if (ap >= 100) return "#ef4444";
  if (ap >= 50) return "#f97316";
  if (ap >= 30) return "#eab308";
  if (ap >= 8) return "#eab308";
  return "#00ff88";
}

function solarWindColor(speed: number | null): string {
  if (speed === null) return "#ffffff";
  if (speed > 700) return "#f97316";
  if (speed > 500) return "#eab308";
  return "#38bdf8";
}

function solarWindInterpretation(speed: number | null): string {
  if (speed == null) return "Feed unavailable";
  if (speed < 350) return "Slow";
  if (speed < 450) return "Typical";
  if (speed < 550) return "Enhanced";
  if (speed < 700) return "Fast";
  return "Very fast";
}

function imfBzColor(bz: number | null): string {
  if (bz === null) return "#ffffff";
  if (bz <= -10) return "#ef4444";
  if (bz < 0) return "#f97316";
  if (bz < 5) return "#eab308";
  return "#00ff88";
}

function flareColor(flareClass: string | null | undefined): string {
  if (!flareClass || flareClass === "Unavailable" || flareClass === "N/A") return "#94a3b8";
  const letter = flareClass.trim().charAt(0).toUpperCase();
  if (letter === "X") return "#a855f7";
  if (letter === "M") return "#ef4444";
  if (letter === "C") return "#f97316";
  if (letter === "B") return "#eab308";
  return "#38bdf8";
}

/** Same palette as the Zimbabwe Ionosphere N/D/H/S/X scale strip. */
export function vtecColor(tec: number | null): string {
  return tecScaleFromVtec(tec).color;
}

/** CORS connected count color — matches the CORS Connected metric card. */
export function corsCountColor(online: number | null, total: number | null): string {
  if (online == null || total == null || total <= 0) return "#94a3b8";
  const ratio = online / total;
  if (ratio >= 0.7) return "#168bd2";
  if (ratio >= 0.4) return "#eab308";
  return "#f97316";
}

/** Single display rules for every dashboard surface (cards, Navigation News, briefs). */
export function formatSolarWindDisplay(speed: number | null | undefined, loading = false): string {
  if (speed == null || !Number.isFinite(speed)) return loading ? "Updating…" : "Unavailable";
  return `${Math.round(speed)} km/s`;
}

export function formatF107Display(f107: number | null | undefined, loading = false): string {
  if (f107 == null || !Number.isFinite(f107)) return loading ? "Updating…" : "Unavailable";
  return String(Math.round(f107 * 10) / 10);
}

export function formatKpDisplay(kp: number | null | undefined, loading = false): string {
  if (kp == null || !Number.isFinite(kp)) return loading ? "Updating…" : "Unavailable";
  const rounded = Math.round(kp * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatDstDisplay(dst: number | null | undefined, loading = false): string {
  if (dst == null || !Number.isFinite(dst)) return loading ? "Updating…" : "Unavailable";
  const rounded = Math.round(dst * 10) / 10;
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded} nT`;
}

export function formatApDisplay(ap: number | null | undefined, loading = false): string {
  if (ap == null || !Number.isFinite(ap)) return loading ? "Updating…" : "Unavailable";
  return String(Math.round(ap));
}

export function formatBzDisplay(bz: number | null | undefined, loading = false): string {
  if (bz == null || !Number.isFinite(bz)) return loading ? "Updating…" : "Unavailable";
  const rounded = Math.round(bz * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} nT`;
}

export function formatVtecDisplay(tec: number | null | undefined, loading = false): string {
  if (tec == null || !Number.isFinite(tec)) return loading ? "Updating…" : "Unavailable";
  return `${tec.toFixed(1)} TECU`;
}

export function formatFlareClassDisplay(flareClass: string | null | undefined): string {
  if (!flareClass || flareClass === "Unavailable") return "Updating…";
  return flareClass.trim().toUpperCase();
}

export function formatGoesFluxDisplay(flux: number | null | undefined): string | null {
  if (flux == null || !Number.isFinite(flux)) return null;
  return `${flux.toExponential(2)} W/m²`;
}

export function formatS4Display(s4: number | null | undefined): string {
  if (s4 == null || !Number.isFinite(s4)) return "Updating…";
  return s4.toFixed(2);
}

export function formatSouthwardDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  if (minutes <= 0) return "Southward duration: 0 min";
  if (minutes < 60) return `Southward duration: ${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `Southward duration: ${h}h ${m}m` : `Southward duration: ${h}h`;
}

type FeedFreshness = "LIVE" | "DELAYED" | "STALE" | "UNAVAILABLE";

function freshnessFromFeed(
  feed: SolarActivityFull["feed_status"][string] | undefined,
  now: number,
  refreshFailed = false,
): FeedFreshness {
  if (!feed || !feed.reachable) return "UNAVAILABLE";
  if (refreshFailed) return "DELAYED";
  if (feed.fresh) return monitoringFreshness(feed.timestamp, now, true);
  const age = feed.age_minutes;
  if (age != null && age <= 60) return "DELAYED";
  return "STALE";
}

function formatObservedShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const slice = iso.replace("T", " ").replace("Z", "").slice(0, 16);
  return slice ? `${slice} UTC` : null;
}

/** Index detail lines for Navigation News sector cards — must match metric cards exactly. */
export function formatPowerIndicesDetail(sw: SpaceWeatherCurrent | null): string | undefined {
  if (!sw || sw.kp == null || sw.dst == null) return undefined;
  const g = noaaGScaleFromKp(sw.kp);
  return `${g.code} · Kp ${formatKpDisplay(sw.kp)} · Dst ${formatDstDisplay(sw.dst)}`;
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
  const now = opts?.now ?? Date.now();
  const solarRefreshFailed = Boolean(opts?.solarRefreshFailed || opts?.solar?.mode === "stale");
  // Honour caller loading flags. Prefer "Updating…" over "Unavailable" while the
  // feed is still pending — even if a partial `sw` / `solar` object already exists.
  const solarLoading = Boolean(opts?.solarLoading);
  const indicesLoading = Boolean(opts?.indicesLoading);
  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const wind = sw?.plasma_speed ?? opts?.solar?.solar_wind?.speed ?? null;
  const online = sw?.stations_online ?? null;
  const total = sw?.stations_total ?? null;
  const riskColor = sw?.gnss_risk_color ?? "#94a3b8";
  const liveCounts = opts?.liveStationCounts;
  const sa = opts?.solar;
  const feeds = sa?.feed_status ?? {};
  const flareRaw = sa?.flare_class;
  const flareMissing = !flareRaw || flareRaw === "Unavailable";
  const flareClass = flareMissing
    ? solarLoading
      ? "Updating…"
      : "Unavailable"
    : formatFlareClassDisplay(flareRaw);
  const bz = sa?.solar_wind?.bz ?? null;
  const density = sa?.solar_wind?.density ?? null;
  const pdyn = sa?.solar_wind?.dynamic_pressure ?? null;
  const southMin = sa?.solar_wind?.southward_duration_minutes ?? null;
  const vtec = sw?.mean_vtec ?? opts?.liveMeanVtec ?? null;
  const g = noaaGScaleFromKp(kp, indicesLoading);

  const liveOnline = liveCounts && liveCounts.online + liveCounts.offline > 0 ? connectedStreamCount(liveCounts) : null;
  // Prefer a real online count from NTRIP/Spider rows; never let a zero live
  // tally hide a healthier /current stations_online (and vice versa).
  const stationsOnlineCount =
    liveOnline != null
      ? liveOnline
      : online != null && online > 0
        ? online
        : (liveOnline ?? online);
  const stationsTotal =
    liveOnline != null
      ? liveCounts!.total
      : online != null && online > 0
        ? (total ?? liveCounts?.total ?? null)
        : (liveCounts?.total ?? total);
  const preferLiveDisplay = liveOnline != null;
  const corsDisplay = preferLiveDisplay && liveCounts ? formatCorsConnectedDisplay(liveCounts) : null;
  const stationsLabel =
    corsDisplay?.value ??
    (stationsOnlineCount !== null && stationsTotal
      ? `${stationsOnlineCount}/${stationsTotal}`
      : indicesLoading
        ? "Updating…"
        : "Unavailable");

  const stationsNote =
    corsDisplay?.note ??
    (stationsOnlineCount !== null && stationsTotal
      ? `${stationsOnlineCount}/${stationsTotal} from live network status`
      : "Awaiting Spider Site Status");

  const bzArrow = bz == null ? "" : bz < 0 ? " ↓" : bz > 0 ? " ↑" : "";
  const bzOrientation =
    bz == null
      ? solarLoading || !sa
        ? "Loading RTSW…"
        : "Orientation updating"
      : bz < 0
        ? "SOUTHWARD"
        : bz > 0
          ? "NORTHWARD"
          : "Bz ≈ 0";
  const southNote = formatSouthwardDuration(southMin);
  const bzNote = [bzOrientation, southNote].filter(Boolean).join(" · ");

  const temp = sa?.solar_wind?.temperature ?? null;
  const bt = sa?.solar_wind?.bt ?? null;

  const windInterpretation = wind == null ? "Loading…" : solarWindInterpretation(wind);
  const windDetailRows: MetricDetailRow[] = [
    {
      icon: "density",
      label: "Density",
      value:
        density != null && Number.isFinite(density)
          ? `${density.toFixed(1)} p/cm³`
          : solarLoading
            ? "Updating…"
            : "Unavailable",
    },
    {
      icon: "proton_temp",
      label: "Proton Temp.",
      value:
        temp != null && Number.isFinite(temp)
          ? `${Math.round(temp).toLocaleString()} K`
          : solarLoading
            ? "Updating…"
            : "Unavailable",
    },
    {
      icon: "imf_bz",
      label: "IMF Bz",
      value: bz != null && Number.isFinite(bz) ? formatBzDisplay(bz) : solarLoading ? "Updating…" : "Unavailable",
      valueColor: bz != null ? imfBzColor(bz) : undefined,
    },
    {
      icon: "imf_bt",
      label: "IMF Bt",
      value:
        bt != null && Number.isFinite(bt)
          ? `${bt.toFixed(1)} nT`
          : solarLoading
            ? "Updating…"
            : "Unavailable",
    },
  ];
  if (pdyn != null && Number.isFinite(pdyn)) {
    windDetailRows.push({
      icon: "dyn_pressure",
      label: "Dyn. pressure",
      value: `${pdyn.toFixed(1)} nPa`,
    });
  }

  const ionoNote =
    vtec == null
      ? indicesLoading
        ? "Loading live CORS VTEC…"
        : "No recent VTEC measurements · check Live Pipeline"
      : `ΔTEC / ROTI: reference baseline under development`;

  const activityLabel = sa?.activity_label?.trim() || null;
  const activityColor = sa?.activity_color?.trim() || "#eab308";
  const swpcAlertCount = Array.isArray(sa?.alerts) ? sa.alerts.length : null;
  const swpcAlertsReachable = Boolean(sa?.feed_status?.swpc_alerts?.reachable);
  const fluxLabel = formatGoesFluxDisplay(sa?.flux);

  const swObserved = formatObservedShort(sw?.updated_utc);
  const xrayFresh = flareMissing ? (solarLoading ? "DELAYED" : freshnessFromFeed(feeds.goes_xray, now, solarRefreshFailed)) : freshnessFromFeed(feeds.goes_xray, now, solarRefreshFailed);
  const plasmaFresh = wind == null ? (solarLoading || indicesLoading ? "DELAYED" : freshnessFromFeed(feeds.solar_wind_plasma, now, solarRefreshFailed)) : freshnessFromFeed(feeds.solar_wind_plasma, now, solarRefreshFailed);
  const magFresh = bz == null ? (solarLoading ? "DELAYED" : freshnessFromFeed(feeds.solar_wind_mag, now, solarRefreshFailed)) : freshnessFromFeed(feeds.solar_wind_mag, now, solarRefreshFailed);
  const indicesFresh: FeedFreshness = indicesLoading ? "DELAYED" : monitoringFreshness(sw?.updated_utc, now, Boolean(sw), Boolean(opts?.refreshFailed));
  const vtecFresh: FeedFreshness = vtec != null ? indicesFresh : indicesLoading ? "DELAYED" : "UNAVAILABLE";

  const donkiLive = sa?.donki_status === "live";
  const donkiFlares = Array.isArray(sa?.donki_flares) ? sa.donki_flares : [];
  const donkiCmes = Array.isArray(sa?.donki_cmes) ? sa.donki_cmes : [];
  const donkiStorms = Array.isArray(sa?.donki_storms) ? sa.donki_storms : [];
  const donkiDateRange =
    sa?.donki_date_start && sa?.donki_date_end
      ? `${sa.donki_date_start} – ${sa.donki_date_end}`
      : null;
  const donkiUnavailableNote =
    sa?.donki_note?.trim() ||
    (solarLoading ? "Loading NASA DONKI…" : "NASA DONKI feed is unavailable.");

  return [
    {
      key: "solar_activity",
      icon: "☀️",
      label: "Solar Activity",
      value: activityLabel ?? (solarLoading ? "Updating…" : "Unavailable"),
      note: "",
      valueColor: activityLabel ? activityColor : "#94a3b8",
      source: "NOAA SWPC",
      observedAt: formatObservedShort(sa?.updated),
      freshness: activityLabel
        ? solarLoading
          ? "DELAYED"
          : xrayFresh
        : solarLoading
          ? "DELAYED"
          : "UNAVAILABLE",
      detailRows: [
        {
          label: "Current Flare",
          value: flareClass,
          valueColor: flareColor(sa?.flare_class),
        },
        {
          label: "SWPC Alerts",
          value: swpcAlertsReachable
            ? String(swpcAlertCount ?? 0)
            : solarLoading
              ? "Updating…"
              : "Unavailable",
        },
      ],
    },
    {
      key: "solar_flare",
      icon: "☀️",
      label: "Solar Flare (GOES X-Ray)",
      value: flareClass,
      note: "",
      subtitle: fluxLabel ? `Flux: ${fluxLabel}` : flareMissing ? "Flux updating…" : null,
      valueColor: flareColor(sa?.flare_class),
      source: "NOAA SWPC GOES",
      observedAt: formatObservedShort(feeds.goes_xray?.timestamp) ?? formatObservedShort(sa?.updated),
      freshness: flareMissing ? (solarLoading ? "DELAYED" : "UNAVAILABLE") : xrayFresh,
      showFlareScale: true,
    },
    {
      key: "solar_wind",
      icon: "🌬️",
      label: "Solar Wind",
      value: formatSolarWindDisplay(wind, solarLoading || indicesLoading),
      note: "",
      subtitle: wind == null ? null : windInterpretation,
      valueColor: solarWindColor(wind),
      source: "NOAA SWPC RTSW",
      observedAt: formatObservedShort(feeds.solar_wind_plasma?.timestamp) ?? formatObservedShort(sa?.updated) ?? swObserved,
      freshness: wind == null ? (solarLoading || indicesLoading ? "DELAYED" : "UNAVAILABLE") : sa?.solar_wind?.speed != null ? plasmaFresh : indicesFresh,
      detailRows: windDetailRows,
    },
    {
      key: "imf_bz",
      icon: "🧲",
      label: "IMF Bz",
      value: bz == null ? (solarLoading ? "Updating…" : "Unavailable") : `${formatBzDisplay(bz)}${bzArrow}`,
      note: bzNote,
      valueColor: imfBzColor(bz),
      source: "NOAA SWPC RTSW",
      observedAt: formatObservedShort(feeds.solar_wind_mag?.timestamp) ?? formatObservedShort(sa?.updated),
      freshness: bz == null ? (solarLoading ? "DELAYED" : "UNAVAILABLE") : magFresh,
    },
    {
      key: "geomagnetic_storm",
      icon: "🌌",
      label: "Geomagnetic Storm",
      value: g.display,
      note: "",
      subtitle: formatKpEqualsDisplay(kp, indicesLoading),
      valueColor: g.color,
      source: "NOAA SWPC Kp → G-scale",
      observedAt: swObserved ? `Snapshot ${swObserved}` : null,
      freshness: kp == null ? (indicesLoading ? "DELAYED" : "UNAVAILABLE") : indicesFresh,
      showGScale: true,
      activeGCode: kp == null ? null : g.code,
      activeKpBand: kp == null ? null : g.bandId,
    },
    {
      key: "dst",
      icon: "🌡️",
      label: "Dst / SYM-H",
      value: formatDstDisplay(dst, indicesLoading),
      note: "Ring current · SYM-H when available",
      valueColor: dstColor(dst),
      source: "NOAA / Kyoto Dst",
      observedAt: swObserved ? `Snapshot ${swObserved}` : null,
      freshness: dst == null ? (indicesLoading ? "DELAYED" : "UNAVAILABLE") : indicesFresh,
    },
    {
      key: "zimbabwe_iono",
      icon: "🇿🇼",
      label: "Zimbabwe Ionosphere",
      value: vtec == null && !indicesLoading ? "No recent TEC" : formatVtecDisplay(vtec, indicesLoading),
      note: ionoNote,
      valueColor: vtecColor(vtec),
      source: "ZINGSA CORS live VTEC",
      observedAt: swObserved ? `Snapshot ${swObserved}` : null,
      freshness: vtecFresh,
      showTecScale: true,
      activeTecCode: vtec == null ? null : tecScaleFromVtec(vtec).code,
    },
    {
      key: "gnss_risk",
      icon: "🛰️",
      label: "Estimated GNSS Risk",
      value: sw?.gnss_risk ?? (indicesLoading ? "Updating…" : "Unavailable"),
      note: "Provisional · local impact not verified",
      valueColor: riskColor,
      source: "ZGIIS risk label",
      observedAt: swObserved ? `Snapshot ${swObserved}` : null,
      freshness: sw?.gnss_risk ? indicesFresh : "UNAVAILABLE",
    },
    {
      key: "stations",
      icon: "📡",
      label: "CORS Connected",
      value: stationsLabel,
      note: stationsNote,
      valueColor: "#168bd2",
      source: "Spider / NTRIP",
      observedAt: swObserved ? `Snapshot ${swObserved}` : null,
      freshness: stationsOnlineCount != null ? indicesFresh : "UNAVAILABLE",
    },
    {
      key: "donki_flares",
      icon: "",
      label: "Solar Flares",
      value: solarLoading && !sa ? "Updating…" : donkiLive ? String(donkiFlares.length) : "Unavailable",
      note: !donkiLive
        ? donkiUnavailableNote
        : donkiFlares.length === 0
          ? "No flare events in the selected 7-day window."
          : "Flare event(s) detected.",
      valueColor: donkiLive
        ? donkiFlareCountColor(donkiFlares.length, donkiFlares)
        : "#94a3b8",
      observedAt: donkiDateRange ? `FLR: ${donkiDateRange}` : null,
    },
    {
      key: "donki_cmes",
      icon: "",
      label: "Coronal Mass Ejections",
      value: solarLoading && !sa ? "Updating…" : donkiLive ? String(donkiCmes.length) : "Unavailable",
      note: !donkiLive
        ? donkiUnavailableNote
        : donkiCmes.length === 0
          ? "No CME events in the selected 7-day window."
          : "CME event(s) detected.",
      valueColor: donkiLive
        ? donkiCmeCountColor(donkiCmes.length, donkiCmes)
        : "#94a3b8",
      observedAt: donkiDateRange ? `CME event history · ${donkiDateRange}` : null,
    },
    {
      key: "donki_storms",
      icon: "",
      label: "Geomagnetic Storms",
      value: solarLoading && !sa ? "Updating…" : donkiLive ? String(donkiStorms.length) : "Unavailable",
      note: !donkiLive
        ? donkiUnavailableNote
        : donkiStorms.length === 0
          ? "No geomagnetic storm events in the selected 7-day window."
          : "Storm event(s) detected.",
      valueColor: donkiLive
        ? donkiStormCountColor(donkiStorms.length, donkiStorms)
        : "#94a3b8",
      observedAt: donkiDateRange ? `GST event history · ${donkiDateRange}` : null,
    },
  ];
}

/** Advanced indices moved out of the primary 8-card row. */
export function buildAdvancedIndexRows(sw: SpaceWeatherCurrent | null, solar?: SolarActivityFull | null) {
  const density = solar?.solar_wind?.density ?? null;
  const bt = solar?.solar_wind?.bt ?? null;
  const temp = solar?.solar_wind?.temperature ?? null;
  const pdyn = solar?.solar_wind?.dynamic_pressure ?? null;
  return [
    {
      key: "kp" as const,
      label: "Kp Index",
      value: formatKpDisplay(sw?.kp),
      note: "Planetary 0–9 (feeds G-scale)",
      valueColor: "#168bd2",
    },
    {
      key: "ap" as const,
      label: "Ap Index",
      value: formatApDisplay(sw?.ap),
      note: sw?.ap != null ? "Planetary amplitude" : "NOAA feed unavailable",
      valueColor: apColor(sw?.ap ?? null),
    },
    {
      key: "f107" as const,
      label: "F10.7 Solar Flux",
      value: formatF107Display(sw?.f107),
      note: "Solar flux units (SFU)",
      valueColor: sw?.f107 != null ? "#168bd2" : "#ffffff",
    },
    {
      key: "bt" as const,
      label: "IMF Bt",
      value: bt != null && Number.isFinite(bt) ? `${bt.toFixed(1)} nT` : "Updating…",
      note: "Total IMF magnitude",
      valueColor: "#f8fafc",
    },
    {
      key: "density" as const,
      label: "Solar-wind density",
      value: density != null && Number.isFinite(density) ? `${density.toFixed(1)} p/cm³` : "Updating…",
      note: "Proton density",
      valueColor: "#38bdf8",
    },
    {
      key: "pdyn" as const,
      label: "Dynamic pressure",
      value: pdyn != null && Number.isFinite(pdyn) ? `${pdyn.toFixed(1)} nPa` : "Updating…",
      note: "From density × speed²",
      valueColor: "#94a3b8",
    },
    {
      key: "temp" as const,
      label: "Solar-wind temperature",
      value: temp != null && Number.isFinite(temp) ? `${Math.round(temp).toLocaleString()} K` : "Updating…",
      note: "Proton temperature",
      valueColor: "#94a3b8",
    },
  ];
}

export function interpretMetric(
  sw: SpaceWeatherCurrent | null,
  key: MetricKey,
  opts?: MetricCardOptions,
): string {
  if (
    !sw &&
    key !== "solar_activity" &&
    key !== "solar_flare" &&
    key !== "imf_bz" &&
    key !== "solar_wind" &&
    key !== "donki_flares" &&
    key !== "donki_cmes" &&
    key !== "donki_storms"
  ) {
    return "Live data is unavailable. No interpretation can be issued.";
  }

  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const wind = sw?.plasma_speed ?? opts?.solar?.solar_wind?.speed ?? null;
  const online = sw?.stations_online;
  const total = sw?.stations_total;
  const sa = opts?.solar;
  const bz = sa?.solar_wind?.bz ?? null;
  const vtec = sw?.mean_vtec ?? opts?.liveMeanVtec ?? null;

  switch (key) {
    case "solar_activity": {
      const activity = sa?.activity_label?.trim();
      const fc = formatFlareClassDisplay(sa?.flare_class);
      const alertN = Array.isArray(sa?.alerts) ? sa.alerts.length : null;
      if (!activity) {
        return "Solar activity level is unavailable from the current NOAA feed.";
      }
      const flareNote = fc !== "Updating…" ? ` Current flare class is ${fc}.` : "";
      const alertNote =
        alertN == null
          ? ""
          : ` ${alertN} SWPC alert bulletin(s) are listed (issue time does not prove an alert is still active).`;
      return `Earth-facing level: ${activity}.${flareNote}${alertNote} State the class and whether any eruption is Earth-directed before writing a storm sentence. This card is not a G-scale rating.`;
    }

    case "solar_flare": {
      const fc = formatFlareClassDisplay(sa?.flare_class);
      const flux = formatGoesFluxDisplay(sa?.flux);
      if (fc === "N/A" || fc === "Updating…") {
        return "GOES X-ray class is unavailable. No flare interpretation is issued.";
      }
      const fluxNote = flux ? ` Long-band flux is ${flux}.` : "";
      return `GOES class ${fc}.${fluxNote} X-rays are the flare beat (about 8 minutes to Earth, sunlit HF). The following sentence has to say whether the event was eruptive and Earth-directed, glancing, or leaving the limb. The class itself is not a geomagnetic storm.`;
    }

    case "solar_wind": {
      if (wind === null) {
        return "No current solar-wind speed is available.";
      }
      const dens = sa?.solar_wind?.density;
      const temperature = sa?.solar_wind?.temperature;
      const imfBz = sa?.solar_wind?.bz;
      const imfBt = sa?.solar_wind?.bt;
      const parts: string[] = [];
      if (dens != null && Number.isFinite(dens)) {
        parts.push(`density ${dens.toFixed(1)} p/cm³`);
      }
      if (temperature != null && Number.isFinite(temperature)) {
        parts.push(`proton temperature ${Math.round(temperature).toLocaleString()} K`);
      }
      if (imfBz != null && Number.isFinite(imfBz)) {
        parts.push(`IMF Bz ${formatBzDisplay(imfBz)}`);
      }
      if (imfBt != null && Number.isFinite(imfBt)) {
        parts.push(`IMF Bt ${imfBt.toFixed(1)} nT`);
      }
      const plasmaNote = parts.length ? ` Accompanying fields: ${parts.join("; ")}.` : "";
      return `Solar wind ${Math.round(wind)} km/s (${solarWindInterpretation(wind).toLowerCase()}).${plasmaNote} Hold the storm sentence until Bz and Kp or Dst agree. A fast stream with northward Bz is written as active at most, not as a G-scale storm.`;
    }

    case "imf_bz": {
      if (bz === null) {
        return "IMF Bz is unavailable from the live RTSW feed.";
      }
      const south = formatSouthwardDuration(sa?.solar_wind?.southward_duration_minutes);
      const bt = sa?.solar_wind?.bt;
      const btNote =
        bt != null && Number.isFinite(bt) ? ` IMF Bt is ${bt.toFixed(1)} nT.` : "";
      const southExtra = south ? ` ${south}.` : "";
      if (bz < 0) {
        return `Bz ${formatBzDisplay(bz)}, southward.${southExtra}${btNote} A short negative spike is a fluctuation. Hours of southward Bz near −5 to −10 nT, with elevated speed, is the coupling that has produced G1–G2 in this cycle.`;
      }
      if (bz > 0) {
        return `IMF Bz is ${formatBzDisplay(bz)} (northward).${btNote} Coupling is usually weaker than during sustained southward Bz.`;
      }
      return "IMF Bz is near 0 nT.";
    }

    case "geomagnetic_storm": {
      const g = noaaGScaleFromKp(kp);
      if (kp === null) {
        return "Kp is unavailable, so the NOAA G-scale cannot be assigned.";
      }
      if (!g.isStorm) {
        if (kp >= 4) {
          return `${g.display} (Kp ${formatKpDisplay(kp)}). Active, and still below G1 (Kp ≥ 5). Write it as active, not as a geomagnetic storm. Global Kp does not establish local Zimbabwe impacts; check timestamped local TEC variability and receiver measurements.`;
        }
        return `${g.display} (Kp ${formatKpDisplay(kp)}). No NOAA G1–G5 geomagnetic storm is in progress.`;
      }
      return `${g.display} (Kp ${formatKpDisplay(kp)}). NOAA ${g.code} is a planetary storm level. Evaluate Zimbabwe effects with local ionospheric observations and measured receiver performance. A G1 or G2 watch alone is not a local outage.`;
    }

    case "dst":
      if (dst === null) {
        return "No current Dst measurement is available.";
      }
      {
        let level: string;
        if (dst > -20) level = "quiet ring-current conditions";
        else if (dst > -50) level = "weak disturbance";
        else if (dst > -100) level = "moderate storm-time depression";
        else if (dst > -200) level = "intense storm-time depression";
        else level = "severe storm-time depression";
        return `Dst ${formatDstDisplay(dst)}: ${level}. Quote it in nT beside Kp. Do not relabel it as a G-scale. A fall through −50 nT, with southward Bz, is the main-phase sentence.`;
      }

    case "zimbabwe_iono":
      if (vtec === null) {
        return "Live Zimbabwe network VTEC is not available yet. ΔTEC and ROTI remain unavailable until a validated quiet-time reference and sampling window are in place — values are never invented.";
      }
      {
        const level = tecScaleFromVtec(vtec);
        const context = tecTypicalContext(vtec);
        return `Network VTEC ${formatVtecDisplay(vtec)} — ${level.title} (${level.range} TECU). ${context} Separate the ordinary daytime EUV rise from a storm departure. ΔTEC and ROTI stay unpublished until a quiet-day reference is validated. Do not call this a disturbance from Kp alone.`;
      }

    case "gnss_risk": {
      const interpretations: Record<string, string> = {
        Low: "Routine GNSS, RTK and CORS operations can continue normally, pending local ionosphere confirmation.",
        Moderate: "Verify precision fixes and monitor Zimbabwe VTEC / CORS health.",
        High: "Expect possible positioning degradation; use dual-frequency data and validation. Confirm with local ionosphere metrics when available.",
        Critical: "GNSS positioning may be unreliable; postpone critical operations where possible and check local CORS/VTEC evidence.",
      };
      const risk = sw?.gnss_risk ?? "Unknown";
      return `Current GNSS risk label is ${risk} (provisional). ${interpretations[risk] ?? "Continue monitoring."} Local ΔTEC/ROTI/RTK rules will refine this later.`;
    }

    case "stations":
      if (online == null || !total) {
        return "No live CORS telemetry is available.";
      }
      {
        const availability = (online / total) * 100;
        let availLevel: string;
        if (availability >= 90) availLevel = "excellent network availability";
        else if (availability >= 70) availLevel = "good availability with some local coverage gaps";
        else if (availability >= 50) availLevel = "reduced availability that may affect regional corrections";
        else availLevel = "low availability with significant CORS coverage limitations";
        return `${online} of ${total} CORS stations are reported online (${availability.toFixed(0)}%), indicating ${availLevel}. Online ≠ TEC processing available.`;
      }

    case "donki_flares": {
      if (sa?.donki_status !== "live") {
        return sa?.donki_note?.trim() || "NASA DONKI flare feed is unavailable.";
      }
      const n = Array.isArray(sa.donki_flares) ? sa.donki_flares.length : 0;
      return n === 0
        ? "Zero cataloged flare events in the selected 7-day window — a calm eruptive period for this feed."
        : `${n} flare event(s) in the selected 7-day window. Check each event’s class (A–X) for strength; storm impact still depends on CME/solar-wind coupling.`;
    }

    case "donki_cmes": {
      if (sa?.donki_status !== "live") {
        return sa?.donki_note?.trim() || "NASA DONKI CME feed is unavailable.";
      }
      const n = Array.isArray(sa.donki_cmes) ? sa.donki_cmes.length : 0;
      return n === 0
        ? "Zero cataloged CME events in the selected 7-day window."
        : `${n} CME event(s) in the selected 7-day window. An apparent halo or catalogue association does not establish Earth arrival; use explicit model guidance.`;
    }

    case "donki_storms": {
      if (sa?.donki_status !== "live") {
        return sa?.donki_note?.trim() || "NASA DONKI geomagnetic storm feed is unavailable.";
      }
      const n = Array.isArray(sa.donki_storms) ? sa.donki_storms.length : 0;
      return n === 0
        ? "Zero geomagnetic storm events in the selected 7-day window — Earth’s magnetic field stayed quiet in this catalog."
        : `${n} geomagnetic storm event(s) in the selected 7-day window. Higher Kp during these events raises positioning error and RTK/PPP convergence risk.`;
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
  return "Very high (not automatically a storm)";
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
