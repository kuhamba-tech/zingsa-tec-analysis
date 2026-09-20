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

/** Shorter day stamp for axis ticks, e.g. `18 Sep`. */
export function formatUtcDayShort(ms: number): string {
  const d = new Date(snapUtcMinute(ms));
  return `${d.getUTCDate()} ${UTC_MONTHS[d.getUTCMonth()]}`;
}

/**
 * KNMI-style UTC labels: HH:mm on major ticks; calendar day only at 00:00 UTC
 * so multi-day axes stay readable (no repeated “16 Sep 2026” under every 6h tick).
 */
export function formatKnmiUtcTick(ms: number): string {
  return formatUtcAxisTick(ms, { majorHours: 6 });
}

export interface UtcAxisTickOptions {
  /** Label every N hours (1 for 6h window, 6 for 24h/72h). Default 6. */
  majorHours?: number;
  /**
   * When true, also stamp the day on the first major tick if the window has no
   * midnight (short 6h slices). Default false — day only at 00:00 UTC.
   * @deprecated Prefer midnight-only; kept for rare short-window call sites.
   */
  includeDate?: boolean;
  /** First major tick ms in the domain — used when includeDate and no midnight. */
  firstMajorMs?: number;
}

/**
 * Easy-to-follow UTC axis labels: `HH:mm`, with the day underneath only at
 * **00:00 UTC** (`18 Sep`) so day boundaries are clear without crowding.
 */
export function formatUtcAxisTick(ms: number, opts: UtcAxisTickOptions = {}): string {
  if (!Number.isFinite(ms)) return "";
  const majorHours = opts.majorHours ?? 6;
  const d = new Date(snapUtcMinute(ms));
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) return "";
  const hh = d.getUTCHours();
  if (hh % majorHours !== 0) return "";
  const time = `${String(hh).padStart(2, "0")}:00`;
  // Day stamp only at midnight — repeating the date every 6h made axes unreadable.
  if (hh === 0) {
    return `${time}\n${formatUtcDayShort(ms)}`;
  }
  // Short windows with no midnight: stamp the day once on the first major tick.
  if (opts.includeDate && opts.firstMajorMs != null && ms === opts.firstMajorMs) {
    return `${time}\n${formatUtcDayShort(ms)}`;
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
 * Standard numeric UTC axis props for LineChart — matches Live NOAA Kp Timeline.
 * Calendar day appears only under 00:00 UTC ticks so multi-day charts stay legible.
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
  // Day label at 00:00 only. Short windows with no midnight get one date on the first major tick.
  let midnightInRange = false;
  {
    let t = startOfUtcDay(domain.min);
    if (t < domain.min) t += 24 * ONE_H_MS;
    midnightInRange = t <= domain.max;
  }
  const firstMajorMs = Math.ceil(domain.min / majorMs) * majorMs;
  const includeDate = opts.includeDate ?? (!midnightInRange && (crossesUtcDay || rangeHours < 12));
  return {
    xMin: domain.min,
    xMax: domain.max,
    xStepSize: ONE_H_MS,
    xMajorStepMs: majorMs,
    formatXTick: (ms: number) =>
      formatUtcAxisTick(ms, {
        majorHours,
        includeDate,
        firstMajorMs: includeDate ? firstMajorMs : undefined,
      }),
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
