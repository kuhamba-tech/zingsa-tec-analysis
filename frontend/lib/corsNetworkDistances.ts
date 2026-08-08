import type { Station } from "@/lib/types";

export interface NetworkDistanceEdge {
  id: string;
  fromCode: string;
  toCode: string;
  fromName: string;
  toName: string;
  distanceKm: number;
  fromLon: number;
  fromLat: number;
  toLon: number;
  toLat: number;
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two WGS84 points (km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isReferenceCorsStation(station: Station): boolean {
  const code = station.code.toLowerCase().replace(/_$/, "");
  if (code === "hara") return true;
  const name = (station.name || "").toLowerCase();
  return name.includes("harare") && !name.includes("city");
}

function stationLabel(station: Station): string {
  return (station.name || station.code).trim() || station.code.toUpperCase();
}

/**
 * Build an undirected k-nearest-neighbour mesh of CORS baselines.
 * Matches the operational “network distances” view: nearby links with km labels.
 */
export function buildCorsNetworkEdges(stations: Station[], neighbors = 3): NetworkDistanceEdge[] {
  const usable = stations.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180,
  );
  if (usable.length < 2) return [];

  const edgeMap = new Map<string, NetworkDistanceEdge>();

  for (let i = 0; i < usable.length; i++) {
    const a = usable[i];
    const ranked = usable
      .map((b, j) => ({
        b,
        j,
        d: i === j ? Infinity : haversineKm(a.lat, a.lon, b.lat, b.lon),
      }))
      .filter((row) => Number.isFinite(row.d))
      .sort((x, y) => x.d - y.d)
      .slice(0, neighbors);

    for (const { b, d } of ranked) {
      const codes = [a.code.toLowerCase(), b.code.toLowerCase()].sort();
      const id = `${codes[0]}__${codes[1]}`;
      if (edgeMap.has(id)) continue;
      const fromFirst = a.code.toLowerCase() <= b.code.toLowerCase() ? a : b;
      const toSecond = fromFirst === a ? b : a;
      edgeMap.set(id, {
        id,
        fromCode: fromFirst.code,
        toCode: toSecond.code,
        fromName: stationLabel(fromFirst),
        toName: stationLabel(toSecond),
        distanceKm: Math.round(d * 10) / 10,
        fromLon: fromFirst.lon,
        fromLat: fromFirst.lat,
        toLon: toSecond.lon,
        toLat: toSecond.lat,
      });
    }
  }

  return [...edgeMap.values()].sort(
    (a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName),
  );
}

export function filterNetworkEdges(
  edges: NetworkDistanceEdge[],
  query: string,
): NetworkDistanceEdge[] {
  const q = query.trim().toLowerCase();
  if (!q) return edges;
  return edges.filter(
    (e) =>
      e.fromName.toLowerCase().includes(q) ||
      e.toName.toLowerCase().includes(q) ||
      e.fromCode.toLowerCase().includes(q) ||
      e.toCode.toLowerCase().includes(q),
  );
}

export function networkEdgesToCsv(edges: NetworkDistanceEdge[]): string {
  const header = "From Station,To Station,Distance (km),From Code,To Code";
  const rows = edges.map(
    (e) =>
      `"${e.fromName.replace(/"/g, '""')}","${e.toName.replace(/"/g, '""')}",${e.distanceKm.toFixed(1)},${e.fromCode},${e.toCode}`,
  );
  return [header, ...rows].join("\n");
}
