import { nearestTeloneCentre, teloneCentresWithoutCors } from "@/lib/teloneCentres";
import { nearestProvince, populationWeightAt } from "@/lib/zimbabweDemographics";

/**
 * 0–1 preference for a candidate CORS site.
 * Existing CORS stations are already at TelOne centres, so only TelOne sites
 * that do not yet have a CORS pull the score up. A more populated 2022
 * census province also scores higher.
 * Coverage gaps still dominate; this only steers among valid inland sites.
 */
export function corsSitingFactor(lat: number, lon: number): number {
  const telone = nearestTeloneCentre(lat, lon, teloneCentresWithoutCors());
  const km = telone?.km ?? 200;
  const teloneScore = km <= 40 ? 1 : km >= 160 ? 0 : (160 - km) / 120;
  return teloneScore * 0.55 + populationWeightAt(lat, lon) * 0.45;
}

export function corsSitingContext(lat: number, lon: number): {
  teloneName: string;
  teloneKm: number;
  province: string;
  population: number;
} | null {
  const telone = nearestTeloneCentre(lat, lon, teloneCentresWithoutCors());
  const province = nearestProvince(lat, lon);
  if (!telone || !province) return null;
  return {
    teloneName: telone.centre.name,
    teloneKm: Math.round(telone.km * 10) / 10,
    province: province.province.name,
    population: province.province.population,
  };
}
