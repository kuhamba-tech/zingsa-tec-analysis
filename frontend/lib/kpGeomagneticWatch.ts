import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";
import {
  formatKpDisplay,
  KP_GEOMAGNETIC_SCALE,
  noaaGScaleFromKp,
  type KpGeomagneticBandId,
} from "@/lib/spaceWeatherMetrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Zimbabwe Kp watch. NOAA G1 begins at Kp 5. */
const WATCH_KP = 4;
const STORM_KP = 5;

export { KP_GEOMAGNETIC_SCALE };
export type { KpGeomagneticBandId };

export type KpEpisode = {
  kp: number;
  label: string;
  timeLabel: string;
};

export type KpGeomagneticWatch = {
  kp: number | null;
  band: KpGeomagneticBandId | null;
  bandLabel: string | null;
  observedLabel: string | null;
  counts: Record<KpGeomagneticBandId, number>;
  episodes: KpEpisode[];
  alert: string | null;
};

export function kpBandOf(kp: number | null | undefined): KpGeomagneticBandId | null {
  if (kp == null || !Number.isFinite(kp)) return null;
  const band = KP_GEOMAGNETIC_SCALE.find((item) => kp >= item.kpMin && kp < item.kpMaxExclusive);
  return band?.id ?? "extreme";
}

function formatUtc(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${day} ${hour}${minute} UTC`;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function emptyCounts(): Record<KpGeomagneticBandId, number> {
  return {
    quiet: 0,
    unsettled: 0,
    active: 0,
    minor: 0,
    moderate: 0,
    strong: 0,
    severe: 0,
    extreme: 0,
  };
}

function countBands(
  points: TimelinePoint[] | null | undefined,
  current: KpGeomagneticBandId | null,
): Record<KpGeomagneticBandId, number> {
  const counts = emptyCounts();
  const samples = (points ?? []).filter((point) => finite(point.v));
  if (!samples.length) {
    if (current) counts[current] = 1;
    return counts;
  }
  for (const point of samples) {
    const band = kpBandOf(point.v);
    if (band) counts[band] += 1;
  }
  return counts;
}

function watchEpisodes(points: TimelinePoint[] | null | undefined): KpEpisode[] {
  const samples = (points ?? [])
    .map((point) => ({ t: Date.parse(point.t), v: point.v }))
    .filter((point) => Number.isFinite(point.t) && finite(point.v))
    .sort((a, b) => a.t - b.t);
  const episodes: KpEpisode[] = [];
  let open: { kp: number; time: number } | null = null;
  const close = () => {
    if (!open) return;
    const label = formatUtc(open.time);
    if (label) episodes.push({ kp: open.kp, label: noaaGScaleFromKp(open.kp).display, timeLabel: label });
    open = null;
  };
  for (const sample of samples) {
    if (sample.v >= WATCH_KP) {
      if (!open || sample.v >= open.kp) open = { kp: sample.v, time: sample.t };
    } else {
      close();
    }
  }
  close();
  return episodes.slice(-6).reverse();
}

function alertSentence(kp: number): string {
  const value = formatKpDisplay(kp);
  const label = noaaGScaleFromKp(kp).display;
  if (kp >= STORM_KP) {
    return `Kp ${value} is ${label}, at or past the G1 line at Kp ${STORM_KP}.`;
  }
  return `Kp ${value} is ${label}, past the watch line at Kp ${WATCH_KP} and still below G1 at Kp ${STORM_KP}.`;
}

export function buildKpGeomagneticWatch(
  sw: SpaceWeatherCurrent | null,
  points?: TimelinePoint[] | null,
): KpGeomagneticWatch {
  const kp = finite(sw?.kp) ? sw.kp : null;
  const band = kpBandOf(kp);
  const scale = noaaGScaleFromKp(kp);
  return {
    kp,
    band,
    bandLabel: kp == null ? null : scale.display,
    observedLabel: formatUtc(sw?.updated_utc),
    counts: countBands(points, band),
    episodes: watchEpisodes(points),
    alert: kp != null && kp >= WATCH_KP ? alertSentence(kp) : null,
  };
}

export function kpGeomagneticGuideParagraphs(watch: KpGeomagneticWatch): string[] {
  const now = watch.kp != null && watch.bandLabel
    ? `The measured Kp is ${formatKpDisplay(watch.kp)}, class ${watch.bandLabel}${watch.observedLabel ? `, snapshot ${watch.observedLabel}` : ""}.`
    : "Kp is not in the current index snapshot.";
  return [
    now,
    "Kp is the three-hour planetary K index from NOAA SWPC. The words on this card are Quiet below 3, Unsettled from 3, Active from 4, Minor Storm at 5, then Moderate G2, Strong G3, Severe G4, and Extreme G5. The G0 mark on the card covers Quiet, Unsettled, and Active together.",
    "Unsettled is not a storm. The Zimbabwe watch starts at Kp 4, Active. A NOAA storm reading begins at G1, Kp 5. This scale is not the Dst index and it is not a flare class.",
    "G1 and above can move TEC over Zimbabwe enough to matter for GNSS. Read the same hours on TEC and S4 from the CORS network, and on Dst and IMF Bz. Kp 4 stays active until one of those local measurements moves.",
    "This monitor reports the measured Kp. It does not by itself mean a local GNSS outage.",
  ];
}
