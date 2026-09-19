/** Thin-shell mapping and diurnal VTEC teaching models. */

export const EARTH_RADIUS_KM = 6371;
export const IONO_SHELL_KM = 350;

/** Thin-shell mapping factor M(E). STEC ≈ M(E) · VTEC. */
export function thinShellMappingFactor(
  elevationDeg: number,
  shellHeightKm = IONO_SHELL_KM,
  earthRadiusKm = EARTH_RADIUS_KM,
): number {
  const el = Math.max(1, Math.min(90, elevationDeg));
  const cosE = Math.cos((el * Math.PI) / 180);
  const ratio = (earthRadiusKm / (earthRadiusKm + shellHeightKm)) * cosE;
  const inside = 1 - ratio * ratio;
  if (inside <= 0) return Number.POSITIVE_INFINITY;
  return 1 / Math.sqrt(inside);
}

export function stecFromVtec(vtec: number, elevationDeg: number): number {
  return vtec * thinShellMappingFactor(elevationDeg);
}

export function vtecFromStec(stec: number, elevationDeg: number): number {
  const m = thinShellMappingFactor(elevationDeg);
  return m > 0 && Number.isFinite(m) ? stec / m : NaN;
}

/** Flat-layer approximation STEC ≈ VTEC / sin(E) — notebook reference curve. */
export function flatLayerStec(vtec: number, elevationDeg: number): number {
  const el = Math.max(1, Math.min(90, elevationDeg));
  return vtec / Math.sin((el * Math.PI) / 180);
}

/**
 * Illustrative daily VTEC curve (not measured RINEX).
 * Background + daytime Chapman-like bump peaking at peakHour UT.
 */
export function diurnalVtecModel(
  hours: number[],
  peakVtec: number,
  peakHourUt: number,
  backgroundVtec: number,
): number[] {
  const amplitude = Math.max(0, peakVtec - backgroundVtec);
  return hours.map((h) => {
    const dt = ((h - peakHourUt + 12) % 24) - 12;
    const daytime = Math.exp(-0.5 * (dt / 3.2) ** 2);
    return backgroundVtec + amplitude * daytime;
  });
}

export function hourOfDayUtc(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** Half-hour bins → percentile bands for diurnal distribution teaching. */
export function diurnalPercentiles(
  hours: number[],
  values: number[],
): {
  bins: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
} {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < hours.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v) || !Number.isFinite(hours[i])) continue;
    const bin = Math.round(hours[i] * 2) / 2;
    const arr = buckets.get(bin) ?? [];
    arr.push(v);
    buckets.set(bin, arr);
  }
  const bins = [...buckets.keys()].sort((a, b) => a - b);
  const quantile = (sorted: number[], q: number) => {
    if (!sorted.length) return NaN;
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  };
  const p10: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];
  for (const bin of bins) {
    const sorted = (buckets.get(bin) ?? []).slice().sort((a, b) => a - b);
    p10.push(quantile(sorted, 0.1));
    p25.push(quantile(sorted, 0.25));
    p50.push(quantile(sorted, 0.5));
    p75.push(quantile(sorted, 0.75));
    p90.push(quantile(sorted, 0.9));
  }
  return { bins, p10, p25, p50, p75, p90 };
}

export const EXERCISE_STEC_TECU = 60;
export const EXERCISE_ELEVATION_DEG = 30;
/** Correct VTEC for STEC=60 at 30° with 350 km shell ≈ 34.2 TECU. */
export const EXERCISE_CORRECT_VTEC = 34.2;
