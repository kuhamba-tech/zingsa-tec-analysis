/**
 * Conservative Zimbabwe land outline as [lon, lat] ring (closed).
 * Deliberately inset from the real border so GA CORS proposals never
 * land in Zambia, Botswana, South Africa, or Mozambique.
 *
 * Critical: Victoria Falls ZW is south of the Zambezi; Livingstone ZM
 * (north bank) must stay outside this polygon.
 */
export const ZIMBABWE_POLYGON: ReadonlyArray<readonly [number, number]> = [
  // West / Victoria Falls — stay on the Zimbabwe (south-east) side of the Zambezi
  [25.55, -18.25],
  [25.80, -18.00], // Vic Falls ZW town corridor (south of Livingstone ZM)
  [26.15, -17.65],
  [26.70, -16.95],
  [27.40, -16.25],
  [28.20, -15.95],
  [29.00, -15.80],
  [29.80, -15.80],
  [30.50, -15.95],
  // North-east → eastern highlands (include Mutare, exclude Chimoio MZ)
  [31.20, -16.35],
  [31.80, -17.00],
  [32.30, -17.70],
  [32.70, -18.40],
  [32.75, -18.95], // Mutare corridor
  [32.65, -19.60],
  [32.40, -20.30],
  [32.10, -20.90],
  // South-east → Limpopo (keep north of South Africa)
  [31.50, -21.40],
  [30.80, -21.85],
  [30.20, -22.05],
  [29.70, -22.05],
  [29.20, -21.85],
  // South-west → Botswana (east of Francistown / Plumtree crossing)
  [28.50, -21.35],
  [28.00, -20.85],
  [27.70, -20.25],
  [27.30, -19.65],
  [26.80, -19.10],
  [26.30, -18.55],
  [25.60, -18.20],
];

export const ZIMBABWE_BOUNDS = {
  minLat: -22.20,
  maxLat: -15.70,
  minLon: 25.50,
  maxLon: 32.90,
} as const;

/** ~15 km inland buffer so candidates are not placed on/over the border. */
const INLAND_BUFFER_DEG = 0.14;

/** Known foreign towns near the border that the simplified ring must never accept. */
const FOREIGN_EXCLUSIONS: ReadonlyArray<{ lat: number; lon: number; radiusDeg: number }> = [
  { lat: -17.80, lon: 25.88, radiusDeg: 0.12 }, // Livingstone, Zambia (north of Vic Falls)
  { lat: -21.17, lon: 27.51, radiusDeg: 0.35 }, // Francistown, Botswana
  { lat: -22.35, lon: 30.05, radiusDeg: 0.25 }, // Musina / Messina, South Africa
  { lat: -19.12, lon: 33.48, radiusDeg: 0.45 }, // Chimoio, Mozambique
  { lat: -16.16, lon: 33.59, radiusDeg: 0.45 }, // Tete, Mozambique
  { lat: -15.39, lon: 28.32, radiusDeg: 0.40 }, // Lusaka approach / Zambian plateau
];

function nearForeignTown(lat: number, lon: number): boolean {
  for (const ex of FOREIGN_EXCLUSIONS) {
    const dLat = lat - ex.lat;
    const dLon = lon - ex.lon;
    if (dLat * dLat + dLon * dLon <= ex.radiusDeg * ex.radiusDeg) return true;
  }
  return false;
}

function pointInPolygon(lat: number, lon: number): boolean {
  if (
    lat < ZIMBABWE_BOUNDS.minLat ||
    lat > ZIMBABWE_BOUNDS.maxLat ||
    lon < ZIMBABWE_BOUNDS.minLon ||
    lon > ZIMBABWE_BOUNDS.maxLon
  ) {
    return false;
  }
  if (nearForeignTown(lat, lon)) return false;

  // Hard cut: north of Vic Falls gorge at western longitudes is Zambia.
  if (lon < 26.15 && lat > -17.90) return false;

  const ring = ZIMBABWE_POLYGON;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True only for points inside the Zimbabwe land polygon. */
export function isInsideZimbabwe(lat: number, lon: number): boolean {
  return pointInPolygon(lat, lon);
}

/**
 * True when the point and a neighbourhood around it are inside Zimbabwe.
 * Rejects border-hugging / cross-border placements for proposed CORS sites.
 */
export function isValidProposedCorsSite(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!pointInPolygon(lat, lon)) return false;

  const b = INLAND_BUFFER_DEG;
  const d = b * 0.7;
  const neighbourhood: Array<[number, number]> = [
    [lat + b, lon],
    [lat - b, lon],
    [lat, lon + b],
    [lat, lon - b],
    [lat + d, lon + d],
    [lat + d, lon - d],
    [lat - d, lon + d],
    [lat - d, lon - d],
  ];
  return neighbourhood.every(([y, x]) => pointInPolygon(y, x));
}

/**
 * Country outline for map clipping, [lon, lat].
 * Natural Earth 110m. Keep this ring identical to zgiis/maps/zimbabwe_land.py.
 */
export const ZIMBABWE_LAND: ReadonlyArray<readonly [number, number]> = [
  [31.19141, -22.25151],
  [30.65987, -22.15157],
  [30.32288, -22.27161],
  [29.83904, -22.10222],
  [29.43219, -22.09131],
  [28.79466, -21.63945],
  [28.02137, -21.48598],
  [27.72723, -20.8518],
  [27.72475, -20.49906],
  [27.29651, -20.39152],
  [26.16479, -19.29309],
  [25.85039, -18.71441],
  [25.64916, -18.53603],
  [25.26423, -17.73654],
  [26.38194, -17.84604],
  [26.70677, -17.96123],
  [27.04443, -17.93803],
  [27.59824, -17.29083],
  [28.46791, -16.4684],
  [28.82587, -16.38975],
  [28.94746, -16.04305],
  [29.51683, -15.64468],
  [30.27426, -15.50779],
  [30.33896, -15.88084],
  [31.17306, -15.86094],
  [31.6365, -16.07199],
  [31.85204, -16.31942],
  [32.32824, -16.39207],
  [32.84764, -16.7134],
  [32.84986, -17.97906],
  [32.65489, -18.67209],
  [32.61199, -19.41938],
  [32.77271, -19.71559],
  [32.65974, -20.30429],
  [32.50869, -20.39529],
  [32.24499, -21.11649],
];

function landContains(lon: number, lat: number): boolean {
  const ring = ZIMBABWE_LAND;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsCross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const orient = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/** True when the degree cell [latSouth, latSouth+step) × [lonWest, lonWest+step) meets Zimbabwe. */
export function cellIntersectsZimbabwe(latSouth: number, lonWest: number, step = 1): boolean {
  const latNorth = latSouth + step;
  const lonEast = lonWest + step;
  for (const dy of [0.2, 0.5, 0.8]) {
    for (const dx of [0.2, 0.5, 0.8]) {
      if (landContains(lonWest + dx * step, latSouth + dy * step)) return true;
    }
  }
  for (const [lon, lat] of ZIMBABWE_LAND) {
    if (lonWest <= lon && lon <= lonEast && latSouth <= lat && lat <= latNorth) return true;
  }
  const rect: Array<readonly [number, number]> = [
    [lonWest, latSouth],
    [lonEast, latSouth],
    [lonEast, latNorth],
    [lonWest, latNorth],
  ];
  for (let i = 0; i < ZIMBABWE_LAND.length; i += 1) {
    const a = ZIMBABWE_LAND[i];
    const b = ZIMBABWE_LAND[(i + 1) % ZIMBABWE_LAND.length];
    for (let j = 0; j < 4; j += 1) {
      if (segmentsCross(a, b, rect[j], rect[(j + 1) % 4])) return true;
    }
  }
  return false;
}
