/** Inverse-distance fill used for both GOPI and Gg station labels. */

export type LatLonSite = { code: string; lat: number; lon: number };

export function stationCodeKey(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/_+$/, "");
}

export type IdwFill = {
  values: Record<string, number>;
  interpolated: Record<string, true>;
};

/**
 * Keep each site's own measurement. Stations with no sample of that method
 * take an inverse-distance (power 2) estimate from the measured sites.
 * One measured site is copied to the rest, matching the GOPI heat-map surface.
 */
export function idwFillByStation(
  sites: LatLonSite[],
  measured: Record<string, number | null | undefined>,
): IdwFill {
  const values: Record<string, number> = {};
  const interpolated: Record<string, true> = {};
  const controls: Array<{ lat: number; lon: number; value: number }> = [];

  for (const site of sites) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const key = stationCodeKey(site.code);
    const value = measured[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    values[key] = value;
    controls.push({ lat: site.lat, lon: site.lon, value });
  }

  if (!controls.length) return { values, interpolated };

  for (const site of sites) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const key = stationCodeKey(site.code);
    if (values[key] != null) continue;

    if (controls.length === 1) {
      values[key] = controls[0].value;
      interpolated[key] = true;
      continue;
    }

    let nearest = Number.POSITIVE_INFINITY;
    let nearestValue = controls[0].value;
    let numerator = 0;
    let denominator = 0;
    for (const control of controls) {
      const distance = Math.hypot(control.lat - site.lat, control.lon - site.lon);
      if (distance < nearest) {
        nearest = distance;
        nearestValue = control.value;
      }
      if (distance <= 1e-9) {
        numerator = control.value;
        denominator = 1;
        nearest = 0;
        break;
      }
      const weight = 1 / Math.max(distance, 1e-6) ** 2;
      numerator += weight * control.value;
      denominator += weight;
    }

    const estimate = nearest <= 1e-9 || denominator <= 0 ? nearestValue : numerator / denominator;
    if (!Number.isFinite(estimate) || estimate <= 0) continue;
    values[key] = Math.round(estimate * 100) / 100;
    interpolated[key] = true;
  }

  return { values, interpolated };
}
