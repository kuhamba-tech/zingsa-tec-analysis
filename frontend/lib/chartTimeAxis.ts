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

/**
 * KNMI-style UTC labels for Live Metric Timelines (24–72h windows):
 * text labels only at 00:00 / 06:00 / 12:00 / 18:00.
 */
export function formatKnmiUtcTick(ms: number): string {
  return formatUtcAxisTick(ms, { majorHours: 6 });
}

export interface UtcAxisTickOptions {
  /** Label every N hours (1 for 6h window, 6 for 24h/72h). Default 6. */
  majorHours?: number;
  /** Include MM-DD before HH:mm (useful for multi-day windows). */
  includeDate?: boolean;
}

/**
 * Easy-to-follow UTC axis labels like Live NOAA Kp Timeline: `HH:mm`
 * (and optionally `MM-DD HH:mm` on multi-day charts).
 */
export function formatUtcAxisTick(ms: number, opts: UtcAxisTickOptions = {}): string {
  if (!Number.isFinite(ms)) return "";
  const majorHours = opts.majorHours ?? 6;
  const d = new Date(snapUtcMinute(ms));
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) return "";
  const hh = d.getUTCHours();
  if (hh % majorHours !== 0) return "";
  const time = `${String(hh).padStart(2, "0")}:00`;
  if (!opts.includeDate) return time;
  const md = d.toISOString().slice(5, 10);
  return `${md} ${time}`;
}

/** Floor/ceil a live window onto major-tick boundaries so HH:mm labels appear. */
export function alignTimeDomain(
  minMs: number,
  maxMs: number,
  majorMs: number = SIX_H_MS,
): { min: number; max: number } {
  const pad = ONE_H_MS;
  return {
    min: Math.floor((minMs - pad) / majorMs) * majorMs,
    max: Math.ceil((maxMs + pad) / majorMs) * majorMs,
  };
}

/**
 * Standard numeric UTC axis props for LineChart — matches Live NOAA Kp Timeline.
 */
export function utcTimeAxisProps(
  domain: { min: number; max: number } | null,
  opts: { rangeHours?: number; majorHours?: number } = {},
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
  const includeDate = rangeHours > 36;
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
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
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
