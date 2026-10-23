/**
 * IGRF-14 centered-dipole geomagnetic latitude, degree 1, epoch 2025–2030.
 * Same coefficients as zgiis/processing/tec_climatology.py magnetic_latitude.
 * NOAA https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt
 *
 * This is the centered-dipole equator (magnetic latitude 0°). It is not the
 * dip equator and not a quasi-dipole or apex coordinate.
 */

const WGS84_E2 = 6.69437999014e-3;

export function igrf14Epoch(date = new Date()): number {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - start) / (end - start);
}

function gauss(epoch: number): { g10: number; g11: number; h11: number } | null {
  if (!(epoch >= 2025 && epoch <= 2030)) return null;
  const dt = epoch - 2025;
  return {
    g10: -29350 + 12.6 * dt,
    g11: -1410.3 + 10 * dt,
    h11: 4545.5 - 21.5 * dt,
  };
}

/** Centered-dipole geomagnetic latitude in degrees. Null outside 2025–2030. */
export function magneticLatitudeDeg(lat: number, lon: number, epoch: number): number | null {
  const g = gauss(epoch);
  if (!g || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const phi = Math.atan((1 - WGS84_E2) * Math.tan((lat * Math.PI) / 180));
  const lam = (lon * Math.PI) / 180;
  const dot = -(
    g.g11 * Math.cos(phi) * Math.cos(lam) +
    g.h11 * Math.cos(phi) * Math.sin(lam) +
    g.g10 * Math.sin(phi)
  );
  const mlat = Math.asin(dot / Math.hypot(g.g10, g.g11, g.h11));
  return Math.round(((mlat * 180) / Math.PI) * 10000) / 10000;
}

/** Geographic latitude where centered-dipole magnetic latitude is 0°. */
export function geomagneticEquatorLatDeg(lon: number, epoch: number): number | null {
  const g = gauss(epoch);
  if (!g || !Number.isFinite(lon)) return null;
  const lam = (lon * Math.PI) / 180;
  const tanPhi = -(g.g11 * Math.cos(lam) + g.h11 * Math.sin(lam)) / g.g10;
  const tanLat = tanPhi / (1 - WGS84_E2);
  return (Math.atan(tanLat) * 180) / Math.PI;
}

/** Equator polyline across Africa and the western Indian Ocean, west to east. */
export function geomagneticEquatorPath(
  epoch: number,
  lonStart = 8,
  lonEnd = 52,
  step = 0.5,
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  for (let lon = lonStart; lon <= lonEnd + 1e-9; lon += step) {
    const lat = geomagneticEquatorLatDeg(lon, epoch);
    if (lat != null) path.push([Math.round(lon * 10) / 10, lat]);
  }
  return path;
}
