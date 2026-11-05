import type { Station } from "@/lib/types";

/**
 * Registry coordinates for the Zimbabwe CORS map.
 * Status is unknown until Spider/NTRIP arrives — these rows only give the
 * map somewhere to plot while /cors/stations is still loading.
 * Coordinates match zgiis/cors/stations.py (CORS_FILES/corszingsa.xlsx).
 */
const REGISTRY: Array<[code: string, name: string, lat: number, lon: number]> = [
  ["muto", "Mutoko", -17.40452552, 32.21956895],
  ["mata", "Mataga", -20.84527778, 30.19333333],
  ["muta", "Mutare", -18.97829762, 32.67722325],
  ["bula", "Bulawayo", -20.16531328, 28.64114319],
  ["gwer", "Gweru", -19.51195226, 29.84053989],
  ["hacy", "Harare City", -17.825166, 31.033511],
  ["masv", "Masvingo", -20.08775776, 30.83149252],
  ["hara", "Harare", -17.78140871, 31.04856188],
  ["zinh", "ZINGSA HQ", -17.78483089, 31.05063364],
  ["lupa", "Lupane", -18.94696921, 27.76074133],
  ["cent", "Centenary", -16.73144103, 31.11882966],
  ["karo", "Karoi", -16.81896637, 29.68364577],
  ["kwek", "Kwekwe", -18.93450249, 29.80392498],
  ["gokw", "Gokwe", -18.21248449, 28.932072],
  ["gsu", "GSU", -20.43602472, 29.27481487],
  ["chir", "Chiredzi", -21.04512914, 31.6686449],
  ["chim", "Chimanimani", -19.80266433, 32.87045111],
  ["chiv", "Chivhu", -19.01795928, 30.89528957],
  ["kari", "Kariba", -16.51946232, 28.79036193],
  ["tsho", "Tsholotsho", -19.77047206, 27.7608916],
  ["vicf", "Victoria Falls", -17.92673716, 25.84053994],
  ["gutu", "Gutu", -19.646095, 31.14708901],
  ["beit", "Beitbridge", -22.21018295, 29.99524904],
  ["bing", "Binga", -17.6250928, 27.33817181],
  ["nkay", "Nkayi", -18.98635139, 28.83723889],
];

export function corsRegistryStations(): Station[] {
  return REGISTRY.map(([code, name, lat, lon]) => ({
    code,
    name,
    lat,
    lon,
    status: "unknown",
    status_source: "unknown",
    constellations: ["GPS"],
    current_tec: null,
    height_m: null,
    site_status_label: "Awaiting Spider Site Status",
  }));
}
