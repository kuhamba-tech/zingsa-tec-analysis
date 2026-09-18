/** Shared UTC chart-axis helpers so Live Metric Timelines match Cause→Effect panels. */

export const ONE_H_MS = 60 * 60 * 1000;
export const SIX_H_MS = 6 * ONE_H_MS;
/** Align Live NOAA Kp/Dst cards with the heliospheric ~3-day window. */
export const LIVE_METRIC_WINDOW_MS = 72 * ONE_H_MS;

/** Snap an epoch to the nearest whole UTC minute (avoids blank tick labels). */
export function snapUtcMinute(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  return Math.round(ms / 60_000) * 60_000;
}

const UTC_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Human-readable UTC calendar day, e.g. `18 Sep 2026`. */
export function formatUtcDayLabel(ms: number): string {
  const d = new Date(snapUtcMinute(ms));
  return `${d.getUTCDate()} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * KNMI-style UTC labels for Live Metric Timelines (24–72h windows):
 * text labels only at 00:00 / 06:00 / 12:00 / 18:00, with calendar day.
 */
export function formatKnmiUtcTick(ms: number): string {
  return formatUtcAxisTick(ms, { majorHours: 6, includeDate: true });
}

export interface UtcAxisTickOptions {
  /** Label every N hours (1 for 6h window, 6 for 24h/72h). Default 6. */
  majorHours?: number;
  /** Include the calendar day under HH:mm on major ticks (not only midnight). */
  includeDate?: boolean;
}

/**
 * Easy-to-follow UTC axis labels: `HH:mm` with the day underneath as
 * `18 Sep 2026` (never opaque `09-18`).
 */
export function formatUtcAxisTick(ms: number, opts: UtcAxisTickOptions = {}): string {
  if (!Number.isFinite(ms)) return "";
  const majorHours = opts.majorHours ?? 6;
  const d = new Date(snapUtcMinute(ms));
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) return "";
  const hh = d.getUTCHours();
  if (hh % majorHours !== 0) return "";
  const time = `${String(hh).padStart(2, "0")}:00`;
  // Midnight always carries the day; multi-day axes also stamp other majors.
  if (hh === 0 || opts.includeDate) {
    return `${time}\n${formatUtcDayLabel(ms)}`;
  }
  return time;
}

/** UTC midnight (00:00:00.000) of the calendar day containing `ms`. */
export function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Floor/ceil a live window so HH:mm labels appear.
 * For ≥6h major steps (24h / 3-day charts): leftmost tick is always **00:00 UTC**
 * of the day containing `minMs` — same as Live NOAA Kp Timeline (not 12:50 / 12:00).
 * Short 6h windows snap to whole-hour boundaries instead.
 */
export function alignTimeDomain(
  minMs: number,
  maxMs: number,
  majorMs: number = SIX_H_MS,
): { min: number; max: number } {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return { min: minMs, max: maxMs };
  }
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);

  if (majorMs >= SIX_H_MS) {
    const min = startOfUtcDay(lo);
    let max = startOfUtcDay(hi);
    if (hi > max) max += 24 * ONE_H_MS; // next 00:00 UTC after hi
    if (max <= min) max = min + 24 * ONE_H_MS;
    return { min, max };
  }

  // 6h (hourly) windows: whole hours only — never :50 mid-hour starts.
  return {
    min: Math.floor(lo / majorMs) * majorMs,
    max: Math.ceil(hi / majorMs) * majorMs || minMs + majorMs,
  };
}

/**
 * Standard numeric UTC axis props for LineChart — matches Live NOAA Kp Timeline,
 * with the calendar day (`18 Sep 2026`) under HH:mm whenever the window spans
 * a day or more.
 */
export function utcTimeAxisProps(
  domain: { min: number; max: number } | null,
  opts: { rangeHours?: number; majorHours?: number; includeDate?: boolean } = {},
): {
  xMin?: number;
  xMax?: number;
  xStepSize?: number;
  xMajorStepMs?: number;
  formatXTick?: (ms: number) => string;
  xLabel?: string;
} {
  if (!domain) return {};
  const rangeHours = opts.rangeHours ?? (domain.max - domain.min) / ONE_H_MS;
  const majorHours =
    opts.majorHours ?? (rangeHours <= 8 ? 1 : rangeHours <= 36 ? 6 : 6);
  const majorMs = majorHours * ONE_H_MS;
  const crossesUtcDay =
    startOfUtcDay(domain.min) !== startOfUtcDay(Math.max(domain.min, domain.max - 1));
  // On long windows only midnight gets the day (via formatUtcAxisTick) to avoid
  // crowding; on ~24h windows stamp every major tick so the day is obvious.
  const includeDate =
    opts.includeDate ??
    ((rangeHours >= 12 && rangeHours <= 36) || (rangeHours < 12 && crossesUtcDay));
  return {
    xMin: domain.min,
    xMax: domain.max,
    xStepSize: ONE_H_MS,
    xMajorStepMs: majorMs,
    formatXTick: (ms: number) => formatUtcAxisTick(ms, { majorHours, includeDate }),
    xLabel: "UTC",
  };
}

export function parseTimelineEpoch(t: string): number | null {
  const ms = Date.parse(t.endsWith("Z") || t.includes("+") || /-\d{2}:\d{2}$/.test(t) ? t : `${t}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function sharedTimeDomain(epochLists: number[][]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const epochs of epochLists) {
    for (const ms of epochs) {
      if (!Number.isFinite(ms)) continue;
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  // Single sample (or identical timestamps) — still provide a UTC day axis so
  // Live Metric Timelines do not show "feed unavailable".
  if (max <= min) {
    return alignTimeDomain(min - ONE_H_MS, max + ONE_H_MS, SIX_H_MS);
  }
  return alignTimeDomain(min, max, SIX_H_MS);
}

export type ChronologicalPoint = { t: string; v: number | null; ms: number };

/** Sort oldest→newest and optionally keep only the newest `windowMs`. */
export function chronologicalPoints(
  points: { t: string; v: number | null }[],
  windowMs: number | null = LIVE_METRIC_WINDOW_MS,
): ChronologicalPoint[] {
  const parsed: ChronologicalPoint[] = [];
  for (const p of points) {
    const ms = parseTimelineEpoch(p.t);
    if (ms == null) continue;
    const v = p.v == null || !Number.isFinite(p.v) ? null : p.v;
    parsed.push({ t: p.t, v, ms });
  }
  parsed.sort((a, b) => a.ms - b.ms);
  if (!windowMs || parsed.length === 0) return parsed;
  const latest = parsed[parsed.length - 1].ms;
  const start = latest - windowMs;
  return parsed.filter((p) => p.ms >= start);
}

/** Build epoch list from API epoch_ms or ISO times (heliospheric panels). */
export function seriesEpochsFromApi(
  labels: string[],
  epochMs?: (number | null)[],
  times?: string[],
): number[] | null {
  if (epochMs && epochMs.length === labels.length && epochMs.some((v) => v != null)) {
    const out = epochMs.map((v) => (v != null && Number.isFinite(v) ? v : NaN));
    return out.every((v) => Number.isFinite(v)) ? out : null;
  }
  if (times && times.length === labels.length) {
    const out = times.map((t) => parseTimelineEpoch(t));
    if (out.every((v) => v != null)) return out as number[];
  }
  // Last resort: try parsing label strings as ISO times.
  const fromLabels = labels.map((t) => parseTimelineEpoch(t));
  if (fromLabels.every((v) => v != null)) return fromLabels as number[];
  return null;
}
