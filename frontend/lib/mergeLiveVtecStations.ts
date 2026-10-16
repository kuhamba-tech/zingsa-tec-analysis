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

/**
 * Trusted live VTEC for map/card colouring: short-window consensus beats a
 * single spiked latest sample (CENT/GOKW ~90+ TECU while heat stayed ~20–40).
 */
export function trustedLiveVtec(row: LiveStationVtecSeries): number | null {
  const pts = Array.isArray(row.points) ? row.points : [];
  const recent: number[] = [];
  for (let i = pts.length - 1; i >= 0 && recent.length < 5; i -= 1) {
    const v = pts[i]?.vtec_tecu;
    if (v != null && Number.isFinite(v) && v > 0) recent.push(v);
  }
  // Median resists one bad latest bin better than mean.
  const shortConsensus =
    recent.length > 0
      ? [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)]
      : null;

  let latest = row.latest_vtec;
  if ((latest == null || !Number.isFinite(latest) || latest <= 0) && recent.length) {
    latest = recent[0];
  }

  if (latest != null && Number.isFinite(latest) && latest > 0) {
    // Reject single-epoch spikes that disagree with the short-window consensus.
    if (
      shortConsensus != null &&
      Math.abs(latest - shortConsensus) > Math.max(12, 0.4 * shortConsensus)
    ) {
      return shortConsensus;
    }
    return latest;
  }

  if (shortConsensus != null && shortConsensus > 0) return shortConsensus;

  const seriesMean = row.mean_vtec;
  if (seriesMean != null && Number.isFinite(seriesMean) && seriesMean > 0) {
    return seriesMean;
  }
  return null;
}

/** Build station_code → trusted live VTEC (TECU) from /live/vtec-by-station. */
export function latestVtecByStation(
  series: LiveStationVtecSeries[] | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(series)) return out;
  for (const row of series) {
    const code = normalizeStationCode(row.station);
    if (!code) continue;
    const vtec = trustedLiveVtec(row);
    if (vtec != null) out.set(code, vtec);
  }
  return out;
}

/**
 * Copy catalog stations and apply trusted live VTEC as current_tec (spike-filtered)
 * so Hybrid colouring stays aligned with short-window NTRIP decode. TEC Heat Map
 * marker G labels prefer /tec/heatmap measured VTEC via resolveStationMapVtec.
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
