import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Zimbabwe ring-current watch. A storm reading begins at −50 nT. */
const WATCH_NT = -30;
const STORM_NT = -50;
const INTENSE_NT = -100;
const SEVERE_NT = -200;

export const DST_BANDS = [
  { id: "quiet", label: "Quiet", desc: ">−20", color: "#00ff88" },
  { id: "weak", label: "Weak", desc: "≤−20", color: "#eab308" },
  { id: "storm", label: "Storm", desc: "≤−50", color: "#f97316" },
  { id: "intense", label: "Intense", desc: "≤−100", color: "#ef4444" },
  { id: "severe", label: "Severe", desc: "≤−200", color: "#a855f7" },
] as const;

export type DstBandId = (typeof DST_BANDS)[number]["id"];

export type DstEpisode = {
  dst: number;
  label: string;
  timeLabel: string;
};

export type DstWatch = {
  dst: number | null;
  band: DstBandId | null;
  bandLabel: string | null;
  observedLabel: string | null;
  counts: Record<DstBandId, number>;
  episodes: DstEpisode[];
  alert: string | null;
};

export function dstBandOf(dst: number | null | undefined): DstBandId | null {
  if (dst == null || !Number.isFinite(dst)) return null;
  if (dst > -20) return "quiet";
  if (dst > STORM_NT) return "weak";
  if (dst > INTENSE_NT) return "storm";
  if (dst > SEVERE_NT) return "intense";
  return "severe";
}

export function dstBandLabel(band: DstBandId | null): string | null {
  return DST_BANDS.find((item) => item.id === band)?.label ?? null;
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

export function formatDstNt(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded}`;
}

function episodeLabel(dst: number): string {
  if (dst <= SEVERE_NT) return "Severe";
  if (dst <= INTENSE_NT) return "Intense";
  if (dst <= STORM_NT) return "Storm";
  return "Watch";
}

function countBands(points: TimelinePoint[] | null | undefined, current: DstBandId | null): Record<DstBandId, number> {
  const counts: Record<DstBandId, number> = {
    quiet: 0,
    weak: 0,
    storm: 0,
    intense: 0,
    severe: 0,
  };
  const samples = (points ?? []).filter((point) => finite(point.v));
  if (!samples.length) {
    if (current) counts[current] = 1;
    return counts;
  }
  for (const point of samples) {
    const band = dstBandOf(point.v);
    if (band) counts[band] += 1;
  }
  return counts;
}

function watchEpisodes(points: TimelinePoint[] | null | undefined): DstEpisode[] {
  const samples = (points ?? [])
    .map((point) => ({ t: Date.parse(point.t), v: point.v }))
    .filter((point): point is { t: number; v: number } => Number.isFinite(point.t) && finite(point.v))
    .sort((a, b) => a.t - b.t);
  const episodes: DstEpisode[] = [];
  let open: { dst: number; time: number } | null = null;
  const close = () => {
    if (!open) return;
    const label = formatUtc(open.time);
    if (label) episodes.push({ dst: open.dst, label: episodeLabel(open.dst), timeLabel: label });
    open = null;
  };
  for (const sample of samples) {
    if (sample.v <= WATCH_NT) {
      if (!open || sample.v <= open.dst) open = { dst: sample.v, time: sample.t };
    } else {
      close();
    }
  }
  close();
  return episodes.slice(-6).reverse();
}

function alertSentence(dst: number): string {
  const value = formatDstNt(dst);
  if (dst <= SEVERE_NT) {
    return `Dst ${value} nT is at or past the severe line at ${SEVERE_NT} nT.`;
  }
  if (dst <= INTENSE_NT) {
    return `Dst ${value} nT is at or past the intense line at ${INTENSE_NT} nT.`;
  }
  if (dst <= STORM_NT) {
    return `Dst ${value} nT is at or past the storm line at ${STORM_NT} nT.`;
  }
  return `Dst ${value} nT is past the watch line at ${WATCH_NT} nT and still short of the storm line at ${STORM_NT} nT.`;
}

export function buildDstWatch(
  sw: SpaceWeatherCurrent | null,
  points?: TimelinePoint[] | null,
): DstWatch {
  const dst = finite(sw?.dst) ? sw.dst : null;
  const band = dstBandOf(dst);
  return {
    dst,
    band,
    bandLabel: dstBandLabel(band),
    observedLabel: formatUtc(sw?.updated_utc),
    counts: countBands(points, band),
    episodes: watchEpisodes(points),
    alert: dst != null && dst <= WATCH_NT ? alertSentence(dst) : null,
  };
}

export function dstGuideParagraphs(watch: DstWatch): string[] {
  const now = watch.dst != null && watch.bandLabel
    ? `The measured Dst is ${formatDstNt(watch.dst)} nT, class ${watch.bandLabel}${watch.observedLabel ? `, snapshot ${watch.observedLabel}` : ""}.`
    : "Dst is not in the current index snapshot.";
  return [
    now,
    "Dst is the disturbance storm time index. It measures the ring current, the westward current around Earth that grows during a geomagnetic storm. The value on this card is the Kyoto hourly index published by NOAA SWPC. A more negative number is a stronger ring current. SYM-H is the minute-by-minute cousin of the same current when that product is in the feed.",
    "The classes are Quiet above −20 nT, Weak from −20 nT, Storm from −50 nT, Intense from −100 nT, and Severe from −200 nT. The Zimbabwe watch starts at −30 nT. A storm reading begins at −50 nT. Dst is quoted in nT beside Kp. It is not a NOAA G-scale.",
    "A fall through −50 nT, with southward IMF Bz, is the main-phase sentence. Recovery is the slower return toward zero. Kp can rise in the same hours, and the two indices should be read together.",
    "Over Zimbabwe the check after that depression is a change in TEC or S4 on the CORS network. This monitor reports the measured index. It does not by itself mean a local GNSS outage.",
  ];
}
