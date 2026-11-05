import { haversineKm } from "@/lib/corsNetworkDistances";
import { corsRegistryStations } from "@/lib/corsStationCatalog";

/**
 * TelOne client-service shops published at https://www.telone.co.zw/shops
 * (fetched 2026-11-05). The test shop "PENTEST-17450" is omitted.
 *
 * Coordinates are the town or suburb named in that published address.
 * They are not a surveyed door pin.
 */
export interface TeloneCentre {
  id: string;
  name: string;
  town: string;
  address: string;
  lat: number;
  lon: number;
  /** Shop from the locator, or a data centre from TelOne's cloud-services sites. */
  kind?: "shop" | "data-centre";
}

export const TELONE_SHOPS_SOURCE = "https://www.telone.co.zw/shops";

/**
 * Data centres behind TelOne Data Centre & Cloud Services
 * (https://www.telone.co.zw/products/details/data-centre-cloud-services).
 * The product page does not list street addresses. These three are the sites
 * TelOne names in its own tenders and the public data-centre listing:
 * Harare (107 Union Avenue, now Kwame Nkrumah Avenue / Runhare House),
 * Mazowe Earth Station, and Bulawayo Main Exchange.
 * Pins are the published address or station area, not a surveyed door.
 */
export const TELONE_DATA_CENTRES_SOURCE =
  "https://www.telone.co.zw/products/details/data-centre-cloud-services";

export const TELONE_CENTRES: TeloneCentre[] = [
  {
    id: "harare-dc",
    name: "Harare Data Centre",
    town: "Harare",
    address: "Runhare House, 107 Kwame Nkrumah Avenue (107 Union Avenue)",
    lat: -17.8297,
    lon: 31.0522,
    kind: "data-centre",
  },
  {
    id: "mazowe-dc",
    name: "Mazowe Data Centre",
    town: "Mazowe",
    address: "Mazowe Earth Station",
    lat: -17.516,
    lon: 30.97,
    kind: "data-centre",
  },
  {
    id: "bulawayo-dc",
    name: "Bulawayo Data Centre",
    town: "Bulawayo",
    address: "Main Exchange, Cnr Leopold Takawira Avenue & Joshua Mqabuko Nkomo Street",
    lat: -20.156,
    lon: 28.583,
    kind: "data-centre",
  },
  { id: "runhare", name: "Head Office", town: "Harare", address: "Runhare House, 107 Kwame Nkrumah Avenue", lat: -17.8297, lon: 31.0522 },
  { id: "main-exchange", name: "Main Exchange", town: "Harare", address: "Cnr Samora Machel & 2nd Street Ext", lat: -17.8315, lon: 31.0455 },
  { id: "avondale", name: "Avondale", town: "Harare", address: "Avondale", lat: -17.8045, lon: 31.0368 },
  { id: "westgate", name: "Westgate", town: "Harare", address: "Westgate Shopping Mall", lat: -17.7782, lon: 30.9784 },
  { id: "borrowdale", name: "Borrowdale", town: "Harare", address: "Pomona", lat: -17.7608, lon: 31.0896 },
  { id: "post-office", name: "Post Office", town: "Harare", address: "Julius Nyerere Way", lat: -17.8292, lon: 31.0490 },
  { id: "hatfield", name: "Hatfield", town: "Harare", address: "Kilwinning Shopping Centre", lat: -17.8705, lon: 31.0795 },
  { id: "high-glen", name: "High Glen", town: "Harare", address: "34 High Glen Shopping Centre", lat: -17.8880, lon: 30.9820 },
  { id: "eastgate", name: "Eastgate", town: "Harare", address: "Shop 23, Eastgate", lat: -17.8310, lon: 31.0538 },
  { id: "braeside", name: "Braeside", town: "Harare", address: "Shop 16, BJ Southgate Mall", lat: -17.8455, lon: 31.0410 },
  { id: "chitungwiza", name: "Chitungwiza", town: "Chitungwiza", address: "Shop 6, Old Mutual Complex, Town Centre", lat: -18.0128, lon: 31.0756 },
  { id: "ruwa", name: "Ruwa", town: "Ruwa", address: "Shop 4, CIPF Building", lat: -17.8898, lon: 31.2446 },
  { id: "marondera", name: "Marondera", town: "Marondera", address: "Marondera Main Exchange", lat: -18.1853, lon: 31.5519 },
  { id: "bindura", name: "Bindura", town: "Bindura", address: "553 Thurlows Road", lat: -17.3019, lon: 31.3306 },
  { id: "chinhoyi", name: "Chinhoyi", town: "Chinhoyi", address: "Main Exchange, 2 Magamba Way", lat: -17.3616, lon: 30.1940 },
  { id: "karoi", name: "Karoi", town: "Karoi", address: "Karoi", lat: -16.8196, lon: 29.6925 },
  { id: "kariba", name: "Kariba", town: "Kariba", address: "Kariba", lat: -16.5167, lon: 28.8000 },
  { id: "kadoma", name: "Kadoma", town: "Kadoma", address: "Cnr Herbert Chitepo & Mukwati Street", lat: -18.3333, lon: 29.9150 },
  { id: "kwekwe", name: "Kwekwe", town: "Kwekwe", address: "Exchange Building, Cnr Gum Street & Gweru Road", lat: -18.9281, lon: 29.8149 },
  { id: "gweru", name: "Gweru", town: "Gweru", address: "Main Post Office Building, 7th Street", lat: -19.4550, lon: 29.8158 },
  { id: "zvishavane", name: "Zvishavane", town: "Zvishavane", address: "Exchange, 610 Kataza Road", lat: -20.3296, lon: 30.0665 },
  { id: "bulawayo", name: "Bulawayo", town: "Bulawayo", address: "Cnr Main Street & Leopold Takawira Street", lat: -20.1560, lon: 28.5830 },
  { id: "bellevue", name: "Bellevue", town: "Bulawayo", address: "Cnr Plumtree Road & Balfour Road", lat: -20.1780, lon: 28.5450 },
  { id: "hillside", name: "Hillside", town: "Bulawayo", address: "1 Burnside Road", lat: -20.1860, lon: 28.6180 },
  { id: "luveve", name: "Luveve", town: "Bulawayo", address: "Stand 8858, Old Luveve", lat: -20.1120, lon: 28.5280 },
  { id: "hwange", name: "Hwange", town: "Hwange", address: "9 Northill Road, Exchange Building", lat: -18.3645, lon: 26.4980 },
  { id: "victoria-falls", name: "Victoria Falls", town: "Victoria Falls", address: "255 Livingstone Way", lat: -17.9318, lon: 25.8307 },
  { id: "gwanda", name: "Gwanda", town: "Gwanda", address: "1st floor, CABS Building, Soudan Street", lat: -20.9360, lon: 29.0000 },
  { id: "beitbridge", name: "Beitbridge", town: "Beitbridge", address: "Sydney Smith Building, 54 Sabi Star Road", lat: -22.2167, lon: 30.0000 },
  { id: "masvingo", name: "Masvingo", town: "Masvingo", address: "Hughes Street", lat: -20.0744, lon: 30.8328 },
  { id: "chiredzi", name: "Chiredzi", town: "Chiredzi", address: "Exchange Building, 167A Chilonga Drive", lat: -21.0380, lon: 31.6660 },
  { id: "mutare", name: "Mutare", town: "Mutare", address: "5 Simon Mazorodze Road", lat: -18.9707, lon: 32.6709 },
  { id: "rusape", name: "Rusape", town: "Rusape", address: "55 Chingaira Street", lat: -18.5278, lon: 32.1284 },
  { id: "chipinge", name: "Chipinge", town: "Chipinge", address: "Stand 274, Chipinge Main Street", lat: -20.1950, lon: 32.6230 },
];

/** A CORS is already installed at this TelOne centre when one is within this distance. */
export const TELONE_CORS_COLOCATED_KM = 30;

function nearestCorsKm(lat: number, lon: number): number {
  let nearest = Infinity;
  for (const station of corsRegistryStations()) {
    const km = haversineKm(lat, lon, station.lat, station.lon);
    if (km < nearest) nearest = km;
  }
  return nearest;
}

/** True when a Zimbabwe CORS station is already installed at this TelOne centre. */
export function teloneCentreHasCors(centre: TeloneCentre): boolean {
  return nearestCorsKm(centre.lat, centre.lon) <= TELONE_CORS_COLOCATED_KM;
}

/** TelOne shops and data centres that do not already have a CORS station. */
export function teloneCentresWithoutCors(): TeloneCentre[] {
  return TELONE_CENTRES.filter((centre) => !teloneCentreHasCors(centre));
}

export function nearestTeloneCentre(
  lat: number,
  lon: number,
  centres: TeloneCentre[] = TELONE_CENTRES,
): { centre: TeloneCentre; km: number } | null {
  let best: { centre: TeloneCentre; km: number } | null = null;
  for (const centre of centres) {
    const km = haversineKm(lat, lon, centre.lat, centre.lon);
    if (!best || km < best.km) best = { centre, km };
  }
  return best;
}
