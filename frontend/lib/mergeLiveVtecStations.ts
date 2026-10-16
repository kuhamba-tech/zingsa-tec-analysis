/**
 * Overlay latest live CORS VTEC onto the shared station catalog so Home,
 * Space Weather graphs, and the interactive CORS map colour the same sites.
 */

import type { LiveStationVtecSeries, Station } from "@/lib/types";

export function normalizeStationCode(code: string | null | undefined): string {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/_+$/, "");
}

/** Build station_code → latest VTEC (TECU) from /live/vtec-by-station. */
export function latestVtecByStation(
  series: LiveStationVtecSeries[] | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(series)) return out;
  for (const row of series) {
    const code = normalizeStationCode(row.station);
    if (!code) continue;
    let latest = row.latest_vtec;
    if (latest == null || !Number.isFinite(latest) || latest <= 0) {
      const pts = Array.isArray(row.points) ? row.points : [];
      for (let i = pts.length - 1; i >= 0; i -= 1) {
        const v = pts[i]?.vtec_tecu;
        if (v != null && Number.isFinite(v) && v > 0) {
          latest = v;
          break;
        }
      }
    }
    if (latest != null && Number.isFinite(latest) && latest > 0) {
      out.set(code, latest);
    }
  }
  return out;
}

/**
 * Copy catalog stations and apply live VTEC as current_tec so CorsMap uses the
 * same measured palette as Local Ionosphere / Live Metric graphs.
 */
export function mergeStationsWithLiveVtec(
  stations: Station[],
  series: LiveStationVtecSeries[] | null | undefined,
): Station[] {
  if (!stations.length) return stations;
  const live = latestVtecByStation(series);
  if (!live.size) return stations;
  return stations.map((station) => {
    const code = normalizeStationCode(station.code);
    const vtec = live.get(code);
    if (vtec == null) return station;
    return {
      ...station,
      current_tec: vtec,
      // CorsMap treats ntrip/msm as measured live VTEC (not grey placeholders).
      status_source: station.status_source === "spider" ? station.status_source : "ntrip",
      ntrip_verdict: station.ntrip_verdict ?? "msm_streaming",
    };
  });
}

export function countStationsWithLiveVtec(stations: Station[]): number {
  return stations.filter(
    (s) => s.current_tec != null && Number.isFinite(s.current_tec) && Number(s.current_tec) > 0,
  ).length;
}
