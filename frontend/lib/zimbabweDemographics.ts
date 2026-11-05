import { haversineKm } from "@/lib/corsNetworkDistances";

/**
 * Provincial population from the ZIMSTAT 2022 Population and Housing Census
 * (Population Distribution by Province, published 23 January 2023).
 * National total 15,178,957.
 *
 * `lat` / `lon` is a planning centre inside the province so the bubble can be
 * drawn. It is not a census polygon centroid from a boundary file.
 */
export interface ProvincePopulation {
  id: string;
  name: string;
  population: number;
  households: number;
  lat: number;
  lon: number;
}

export const ZIMSTAT_CENSUS_SOURCE =
  "ZIMSTAT 2022 Population and Housing Census — provincial totals (23 Jan 2023)";

export const ZIMBABWE_CENSUS_2022_TOTAL = 15_178_957;

export const PROVINCE_POPULATION_2022: ProvincePopulation[] = [
  { id: "harare", name: "Harare", population: 2_427_231, households: 653_557, lat: -17.83, lon: 31.05 },
  { id: "bulawayo", name: "Bulawayo", population: 665_952, households: 178_716, lat: -20.15, lon: 28.58 },
  { id: "manicaland", name: "Manicaland", population: 2_037_703, households: 502_929, lat: -19.00, lon: 32.35 },
  { id: "mash-central", name: "Mashonaland Central", population: 1_384_891, households: 337_778, lat: -16.80, lon: 31.30 },
  { id: "mash-east", name: "Mashonaland East", population: 1_731_173, households: 452_666, lat: -18.20, lon: 31.75 },
  { id: "mash-west", name: "Mashonaland West", population: 1_893_584, households: 466_865, lat: -17.40, lon: 29.70 },
  { id: "mat-north", name: "Matabeleland North", population: 827_645, households: 199_426, lat: -18.60, lon: 27.40 },
  { id: "mat-south", name: "Matabeleland South", population: 760_345, households: 193_328, lat: -21.10, lon: 29.30 },
  { id: "midlands", name: "Midlands", population: 1_811_905, households: 440_244, lat: -19.25, lon: 29.85 },
  { id: "masvingo", name: "Masvingo", population: 1_638_528, households: 393_225, lat: -20.50, lon: 31.10 },
];

const MAX_PROVINCE_POPULATION = Math.max(...PROVINCE_POPULATION_2022.map((p) => p.population));

export function nearestProvince(
  lat: number,
  lon: number,
): { province: ProvincePopulation; km: number } | null {
  let best: { province: ProvincePopulation; km: number } | null = null;
  for (const province of PROVINCE_POPULATION_2022) {
    const km = haversineKm(lat, lon, province.lat, province.lon);
    if (!best || km < best.km) best = { province, km };
  }
  return best;
}

/** 0–1, Harare = 1. Used only to break ties toward more populated provinces. */
export function populationWeightAt(lat: number, lon: number): number {
  const hit = nearestProvince(lat, lon);
  if (!hit) return 0;
  return hit.province.population / MAX_PROVINCE_POPULATION;
}

export function formatPopulation(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} million`;
  return n.toLocaleString("en-ZW");
}
