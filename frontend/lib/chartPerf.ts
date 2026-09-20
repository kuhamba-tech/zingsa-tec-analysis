/**
 * Shared chart performance helpers — keep Space Weather graphs light on first paint.
 */

import { getLoadProfile, type LoadProfile } from "@/lib/loadBudget";

/** Stride-downsample aligned label + series arrays (keeps first/last points). */
export function downsampleAligned<T>(
  labels: T[],
  seriesList: ((number | null)[])[],
  maxPoints: number,
): { labels: T[]; seriesList: ((number | null)[])[] } {
  const n = labels.length;
  if (n <= maxPoints || maxPoints < 8) {
    return { labels, seriesList };
  }
  const step = Math.ceil(n / maxPoints);
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return {
    labels: idx.map((i) => labels[i]),
    seriesList: seriesList.map((s) => idx.map((i) => (i < s.length ? s[i] : null))),
  };
}

/** Stride-downsample parallel numeric arrays (e.g. epochMs + values). */
export function downsampleIndexes(length: number, maxPoints: number): number[] {
  if (length <= maxPoints || maxPoints < 8) {
    return Array.from({ length }, (_, i) => i);
  }
  const step = Math.ceil(length / maxPoints);
  const idx: number[] = [];
  for (let i = 0; i < length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== length - 1) idx.push(length - 1);
  return idx;
}

export function chartRenderBudget(profile?: LoadProfile) {
  const p = profile ?? getLoadProfile();
  return {
    maxPoints: p.chartMaxPoints,
    /** Chart.js accepts `false` or an AnimationSpec — never a bare `true`. */
    animation: (p.chartAnimations ? { duration: 280 } : false) as false | { duration: number },
    pointRadius: p.lightPayload ? 0 : 2,
    tension: p.lightPayload ? 0.15 : 0.3,
  };
}
