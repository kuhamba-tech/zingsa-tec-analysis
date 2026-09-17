/** Shared UTC chart-axis helpers so Live Metric Timelines match Cause→Effect panels. */

export const ONE_H_MS = 60 * 60 * 1000;
export const SIX_H_MS = 6 * ONE_H_MS;
/** Align Live NOAA Kp/Dst cards with the heliospheric ~3-day window. */
export const LIVE_METRIC_WINDOW_MS = 72 * ONE_H_MS;

/**
 * KNMI-style UTC labels:
 * - Text labels only at 00:00 / 06:00 / 12:00 / 18:00
 * Hourly ticks still exist via stepSize=1h; unlabeled hours return "".
 */
export function formatKnmiUtcTick(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) return "";
  const hh = d.getUTCHours();
  if (hh % 6 !== 0) return "";
  return `${String(hh).padStart(2, "0")}:00`;
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
  const pad = ONE_H_MS;
  return {
    min: Math.floor((min - pad) / SIX_H_MS) * SIX_H_MS,
    max: Math.ceil((max + pad) / SIX_H_MS) * SIX_H_MS,
  };
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
