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

/** Thin-shell IPP geographic coordinates from receiver + look angles. */
export function ionosphericPiercePoint(
  recvLatDeg: number,
  recvLonDeg: number,
  elevationDeg: number,
  azimuthDeg: number,
  shellHeightKm = IONO_SHELL_KM,
  earthRadiusKm = EARTH_RADIUS_KM,
): { lat: number; lon: number } | null {
  const el = Math.max(1, Math.min(89.9, elevationDeg));
  const az = ((azimuthDeg % 360) + 360) % 360;
  const E = (el * Math.PI) / 180;
  const A = (az * Math.PI) / 180;
  const phiU = (recvLatDeg * Math.PI) / 180;
  const lamU = (recvLonDeg * Math.PI) / 180;
  const ratio = earthRadiusKm / (earthRadiusKm + shellHeightKm);
  // Standard: ψ_pp = π/2 − E − arcsin((RE/(RE+h)) cos E)
  const psiPp = Math.PI / 2 - E - Math.asin(Math.min(1, Math.max(-1, ratio * Math.cos(E))));
  const sinPhiPp = Math.sin(phiU) * Math.cos(psiPp) + Math.cos(phiU) * Math.sin(psiPp) * Math.cos(A);
  const phiPp = Math.asin(Math.min(1, Math.max(-1, sinPhiPp)));
  const dLam = Math.asin(
    Math.min(1, Math.max(-1, (Math.sin(psiPp) * Math.sin(A)) / Math.max(1e-9, Math.cos(phiPp)))),
  );
  const lamPp = lamU + dLam;
  const lat = (phiPp * 180) / Math.PI;
  let lon = (lamPp * 180) / Math.PI;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
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

/**
 * Full-day (0–24 UT) diurnal fan chart grid — matches notebook Step 5 style.
 * Missing half-hour bins are null so the axis stays 0…24.
 */
export function diurnalPercentilesFullDay(
  hours: number[],
  values: number[],
  opts?: { maxVtec?: number },
): {
  hours: number[];
  p10: (number | null)[];
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  p90: (number | null)[];
} {
  const maxVtec = opts?.maxVtec ?? 80;
  const filteredHours: number[] = [];
  const filteredVals: number[] = [];
  for (let i = 0; i < hours.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v) || v <= 0 || v > maxVtec) continue;
    if (!Number.isFinite(hours[i])) continue;
    filteredHours.push(hours[i]);
    filteredVals.push(v);
  }
  const raw = diurnalPercentiles(filteredHours, filteredVals);
  const byBin = new Map<number, number>();
  // index into raw arrays
  const idx = new Map(raw.bins.map((b, i) => [b, i]));
  const hoursOut = Array.from({ length: 49 }, (_, i) => i * 0.5); // 0 … 24
  const pick = (arr: number[], bin: number) => {
    const i = idx.get(bin);
    if (i == null) return null;
    const v = arr[i];
    return Number.isFinite(v) ? v : null;
  };
  return {
    hours: hoursOut,
    p10: hoursOut.map((h) => pick(raw.p10, h)),
    p25: hoursOut.map((h) => pick(raw.p25, h)),
    p50: hoursOut.map((h) => pick(raw.p50, h)),
    p75: hoursOut.map((h) => pick(raw.p75, h)),
    p90: hoursOut.map((h) => pick(raw.p90, h)),
  };
}

export const EXERCISE_STEC_TECU = 60;
export const EXERCISE_ELEVATION_DEG = 30;
/** Correct VTEC for STEC=60 at 30° with 350 km shell ≈ 34.2 TECU. */
export const EXERCISE_CORRECT_VTEC = 34.2;
