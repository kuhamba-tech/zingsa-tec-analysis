/**
 * IGRF-14 dip latitude for 2025–2030.
 * tan(μ) = (1/2) tan(I). Same synthesis as zgiis/space_weather/igrf14.py.
 * Oryema et al. (2015) place the equatorial ionization anomaly trough on the
 * magnetic equator and the crests near ±15° of that latitude.
 */

import { IGRF14_2025 } from "@/lib/igrf14Coeffs2025";

const REF_KM = 6371.2;
const WGS_A = 6378.137;
const WGS_B = 6356.7523142;
const NMAX = 13;
export const EIA_CREST_DIP_DEG = 15;

type Coeff = { value: number; secular: number };

const COEFFICIENTS = new Map<string, Coeff>();
for (const [kind, degree, order, value, secular] of IGRF14_2025) {
  COEFFICIENTS.set(`${kind}:${degree}:${order}`, { value, secular });
}

function coefficient(kind: "g" | "h", degree: number, order: number, epoch: number): number | null {
  if (!(epoch >= 2025 && epoch <= 2030)) return null;
  const row = COEFFICIENTS.get(`${kind}:${degree}:${order}`);
  if (!row) return null;
  return row.value + row.secular * (epoch - 2025);
}

function geocentric(latDeg: number, altKm: number): [number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const radiusCurv = (WGS_A * WGS_A) / Math.hypot(WGS_A * cosLat, WGS_B * sinLat);
  const rho = (radiusCurv + altKm) * cosLat;
  const vertical = (radiusCurv * (WGS_B / WGS_A) ** 2 + altKm) * sinLat;
  return [Math.hypot(rho, vertical), Math.atan2(vertical, rho)];
}

function factorialRatio(degree: number, order: number): number {
  let value = 1;
  for (let step = degree - order + 1; step <= degree + order; step += 1) value /= step;
  return Math.sqrt(value);
}

function schmidt(colatitude: number): { values: number[][]; deriv: number[][] } {
  const cosine = Math.cos(colatitude);
  let sine = Math.sin(colatitude);
  if (Math.abs(sine) < 1e-12) sine = Math.sign(sine || 1) * 1e-12;
  const values = Array.from({ length: NMAX + 1 }, () => Array(NMAX + 1).fill(0));
  const deriv = Array.from({ length: NMAX + 1 }, () => Array(NMAX + 1).fill(0));
  values[0][0] = 1;
  for (let degree = 1; degree <= NMAX; degree += 1) {
    values[degree][degree] = (2 * degree - 1) * sine * values[degree - 1][degree - 1];
    deriv[degree][degree] =
      (2 * degree - 1) * (sine * deriv[degree - 1][degree - 1] + cosine * values[degree - 1][degree - 1]);
    values[degree][degree - 1] = (2 * degree - 1) * cosine * values[degree - 1][degree - 1];
    deriv[degree][degree - 1] =
      (2 * degree - 1) * (cosine * deriv[degree - 1][degree - 1] - sine * values[degree - 1][degree - 1]);
    for (let order = 0; order < degree - 1; order += 1) {
      const previous = degree >= 2 ? values[degree - 2][order] : 0;
      const previousD = degree >= 2 ? deriv[degree - 2][order] : 0;
      const scale = degree - order;
      values[degree][order] =
        ((2 * degree - 1) * cosine * values[degree - 1][order] - (degree + order - 1) * previous) / scale;
      deriv[degree][order] =
        ((2 * degree - 1) * (cosine * deriv[degree - 1][order] - sine * values[degree - 1][order]) -
          (degree + order - 1) * previousD) /
        scale;
    }
  }
  for (let degree = 0; degree <= NMAX; degree += 1) {
    for (let order = 0; order <= degree; order += 1) {
      let factor = factorialRatio(degree, order);
      if (order > 0) factor *= Math.SQRT2;
      values[degree][order] *= factor;
      deriv[degree][order] *= factor;
    }
  }
  return { values, deriv };
}

/** North, east and down field in nT. Null outside 2025–2030. */
export function fieldGeodetic(
  latDeg: number,
  lonDeg: number,
  epoch: number,
  altKm = 0,
): [number, number, number] | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  const [radius, geocentricLat] = geocentric(latDeg, altKm);
  const colatitude = Math.PI / 2 - geocentricLat;
  const { values, deriv } = schmidt(colatitude);
  let radial = 0;
  let theta = 0;
  let phi = 0;
  const longitude = (lonDeg * Math.PI) / 180;
  const sine = Math.sin(colatitude);
  for (let degree = 1; degree <= NMAX; degree += 1) {
    const ratio = (REF_KM / radius) ** (degree + 2);
    for (let order = 0; order <= degree; order += 1) {
      const gNm = coefficient("g", degree, order, epoch);
      const hNm = order === 0 ? 0 : coefficient("h", degree, order, epoch);
      if (gNm == null || hNm == null) return null;
      const cosineM = Math.cos(order * longitude);
      const sineM = Math.sin(order * longitude);
      const scalar = gNm * cosineM + hNm * sineM;
      radial += (degree + 1) * ratio * scalar * values[degree][order];
      theta -= ratio * scalar * deriv[degree][order];
      if (order > 0) {
        phi += (ratio * order * (gNm * sineM - hNm * cosineM) * values[degree][order]) / sine;
      }
    }
  }
  const delta = (latDeg * Math.PI) / 180 - geocentricLat;
  const north = -theta * Math.cos(delta) - radial * Math.sin(delta);
  const east = phi;
  const down = theta * Math.sin(delta) - radial * Math.cos(delta);
  return [north, east, down];
}

export function dipLatitudeDeg(latDeg: number, lonDeg: number, epoch: number, altKm = 0): number | null {
  const field = fieldGeodetic(latDeg, lonDeg, epoch, altKm);
  if (!field) return null;
  const [north, east, down] = field;
  const inclination = Math.atan2(down, Math.hypot(north, east));
  return (Math.atan(0.5 * Math.tan(inclination)) * 180) / Math.PI;
}

function latitudeForDip(lonDeg: number, targetDeg: number, epoch: number): number | null {
  let low = -60;
  let high = 60;
  for (let step = 0; step < 18; step += 1) {
    const mid = 0.5 * (low + high);
    const dip = dipLatitudeDeg(mid, lonDeg, epoch);
    if (dip == null) return null;
    if (dip < targetDeg) low = mid;
    else high = mid;
  }
  return 0.5 * (low + high);
}

export type AnomalyPaths = {
  trough: Array<[number, number]>;
  northern_crest: Array<[number, number]>;
  southern_crest: Array<[number, number]>;
};

const pathCache = new Map<string, AnomalyPaths>();

/** Dip equator and ±15° crests. Defaults trace the whole Earth. */
export function anomalyPaths(epoch: number, lonStart = -180, lonEnd = 180, step = 2): AnomalyPaths | null {
  const cacheKey = `${epoch.toFixed(3)}:${lonStart}:${lonEnd}:${step}`;
  const cached = pathCache.get(cacheKey);
  if (cached) return cached;
  const paths: AnomalyPaths = { trough: [], northern_crest: [], southern_crest: [] };
  const targets: Array<[keyof AnomalyPaths, number]> = [
    ["trough", 0],
    ["northern_crest", EIA_CREST_DIP_DEG],
    ["southern_crest", -EIA_CREST_DIP_DEG],
  ];
  for (let lon = lonStart; lon <= lonEnd + 1e-9; lon += step) {
    for (const [name, target] of targets) {
      const lat = latitudeForDip(lon, target, epoch);
      if (lat == null) return null;
      paths[name].push([Math.round(lon * 10) / 10, lat]);
    }
  }
  pathCache.set(cacheKey, paths);
  return paths;
}

export type AnomalyReading = {
  /** Rabiu: equatorial ±0–20°, mid-latitude ±20–60°, high-latitude ±60–90°. */
  belt: "equatorial" | "mid-latitude" | "high-latitude";
  /** Short label for the station table. */
  region: string;
  /** One complete sentence for the marker card. */
  detail: string;
};

/**
 * Place a dip latitude in Rabiu's equatorial ionosphere.
 * Crests of the Appleton anomaly sit near ±17–20°; the map draws ±15° as the crest guide.
 */
export function anomalyReading(dipLat: number): AnomalyReading {
  const distance = Math.abs(dipLat);
  const hemisphere = dipLat < 0 ? "southern" : "northern";
  const poleward = polewardOfSouthernCrestDeg(dipLat);
  const belt: AnomalyReading["belt"] =
    distance <= 20 ? "equatorial" : distance <= 60 ? "mid-latitude" : "high-latitude";
  let region: string;
  if (distance <= 3) region = "Dip equator (electrojet)";
  else if (distance <= 5) region = "Anomaly trough";
  else if (distance < 10) region = `Between trough and ${hemisphere} crest`;
  else if (distance <= 20) region = `${hemisphere === "southern" ? "Southern" : "Northern"} crest belt`;
  else region = `Poleward of the ${hemisphere} crest`;

  const crest =
    poleward > 0.25
      ? `${poleward.toFixed(1)}° poleward of the southern crest (−15° dip)`
      : poleward < -0.25
        ? `${Math.abs(poleward).toFixed(1)}° equatorward of the southern crest (−15° dip)`
        : "on the southern crest (−15° dip)";
  const rabiu =
    belt === "equatorial"
      ? "Rabiu places this in the equatorial ionosphere, about ±0–20° magnetic latitude. The Appleton anomaly is a trough on the dip equator and two crests near ±17–20°, built by the daytime plasma fountain."
      : belt === "mid-latitude"
        ? "Rabiu places magnetic latitudes beyond about ±20° in the mid-latitude ionosphere (±20–60°). This station is outside the equatorial belt, so it does not sit on the Appleton anomaly crest."
        : "Rabiu places magnetic latitudes beyond about ±60° in the high-latitude ionosphere.";
  const ionolab =
    belt === "mid-latitude"
      ? "IONOLAB calls the midlatitude ionosphere the most stable of the polar, midlatitude and equatorial regions."
      : belt === "equatorial"
        ? "IONOLAB treats the equatorial ionosphere as distinct from that more stable midlatitude region. Daytime electron density peaks in the F layer, which splits into F1 and F2."
        : "IONOLAB treats the high-latitude (polar) ionosphere as separate from the more stable midlatitude region.";
  return { belt, region, detail: `${crest}. ${rabiu} ${ionolab}` };
}

/** Where a station sits in the equatorial ionization anomaly. */
export function eiaRegion(dipLat: number): string {
  return anomalyReading(dipLat).region;
}

/** Degrees poleward of the southern crest. Positive means further south than −15°. */
export function polewardOfSouthernCrestDeg(dipLat: number): number {
  return -EIA_CREST_DIP_DEG - dipLat;
}
