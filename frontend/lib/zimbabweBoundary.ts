/**
 * Simplified Zimbabwe land outline as [lon, lat] ring (closed).
 * Used so GA CORS proposals never land outside national territory.
 */
export const ZIMBABWE_POLYGON: ReadonlyArray<readonly [number, number]> = [
  // West / Zambezi (Victoria Falls → Kariba flank → northern tip)
  [25.26, -17.83],
  [25.30, -17.20],
  [25.55, -16.52],
  [26.50, -15.85],
  [28.30, -15.61],
  [29.45, -15.61],
  [30.40, -15.70],
  // North-east → eastern highlands
  [31.20, -16.00],
  [32.00, -16.50],
  [32.85, -17.30],
  [33.04, -17.90],
  [32.90, -18.70],
  [32.75, -19.55],
  [32.65, -20.35],
  // South-east → Limpopo / Beitbridge (keep north of SA border towns)
  [32.40, -21.10],
  [31.80, -21.70],
  [31.15, -22.20],
  [30.40, -22.28],
  [29.90, -22.25], // Beitbridge ZW
  [29.20, -22.10],
  // South-west → Botswana border (east of Francistown)
  [28.40, -21.70],
  [27.95, -21.10],
  [27.80, -20.50], // Plumtree approach
  [27.00, -19.85],
  [26.40, -19.10],
  [25.90, -18.40],
  [25.26, -17.83],
];

export const ZIMBABWE_BOUNDS = {
  minLat: -22.35,
  maxLat: -15.55,
  minLon: 25.15,
  maxLon: 33.10,
} as const;

/** ~8 km inland buffer so candidates are not placed on/over the border. */
const INLAND_BUFFER_DEG = 0.08;

function pointInPolygon(lat: number, lon: number): boolean {
  if (
    lat < ZIMBABWE_BOUNDS.minLat ||
    lat > ZIMBABWE_BOUNDS.maxLat ||
    lon < ZIMBABWE_BOUNDS.minLon ||
    lon > ZIMBABWE_BOUNDS.maxLon
  ) {
    return false;
  }

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
 * True when the point and a small cross around it are inside Zimbabwe.
 * Rejects border-hugging / cross-border placements for proposed CORS sites.
 */
export function isValidProposedCorsSite(lat: number, lon: number): boolean {
  if (!pointInPolygon(lat, lon)) return false;
  const b = INLAND_BUFFER_DEG;
  return (
    pointInPolygon(lat + b, lon) &&
    pointInPolygon(lat - b, lon) &&
    pointInPolygon(lat, lon + b) &&
    pointInPolygon(lat, lon - b)
  );
}
