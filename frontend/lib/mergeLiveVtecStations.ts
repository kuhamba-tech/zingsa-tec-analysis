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

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function withinConsensus(value: number, ref: number): boolean {
  return Math.abs(value - ref) <= Math.max(12, 0.4 * ref);
}

/**
 * Trusted live VTEC for map/card colouring.
 *
 * Rejects single-epoch and multi-bin spike runs (e.g. CHIR/GSU ~130–200 TECU)
 * by anchoring the short window to the longer series mean when available.
 */
export function trustedLiveVtec(row: LiveStationVtecSeries): number | null {
  const seriesMean =
    row.mean_vtec != null && Number.isFinite(row.mean_vtec) && row.mean_vtec > 0
      ? row.mean_vtec
      : null;

  const pts = Array.isArray(row.points) ? row.points : [];
  const recent: number[] = [];
  for (let i = pts.length - 1; i >= 0 && recent.length < 8; i -= 1) {
    const v = pts[i]?.vtec_tecu;
    if (v != null && Number.isFinite(v) && v > 0) recent.push(v);
  }

  // Prefer recent samples that agree with the longer-window series mean.
  const anchored =
    seriesMean != null ? recent.filter((v) => withinConsensus(v, seriesMean)) : [...recent];

  const pool =
    anchored.length > 0 ? anchored : seriesMean != null ? [seriesMean] : recent;

  if (!pool.length) {
    const latest = row.latest_vtec;
    if (latest != null && Number.isFinite(latest) && latest > 0) {
      // Soft ceiling when we have no series context — matches backend memory gate.
      if (latest <= 55) return latest;
    }
    return null;
  }

  const consensus = median(pool);
  if (consensus == null || consensus <= 0) return null;

  let latest = row.latest_vtec;
  if ((latest == null || !Number.isFinite(latest) || latest <= 0) && recent.length) {
    latest = recent[0];
  }

  if (latest != null && Number.isFinite(latest) && latest > 0 && withinConsensus(latest, consensus)) {
    return latest;
  }
  return consensus;
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

/** Drop network outliers from a list of TECU samples (median-anchored). */
export function filterVtecNetworkOutliers(values: number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  const med = median(finite);
  if (med == null || finite.length < 3) return finite;
  const kept = finite.filter((v) => withinConsensus(v, med) || Math.abs(v - med) <= Math.max(28, med * 1.25));
  return kept.length >= Math.min(3, finite.length) ? kept : finite;
}
