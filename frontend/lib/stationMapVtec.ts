/**
 * Resolve the G (GOPI) VTEC shown on the CORS map and site details.
 *
 * Prefer measured /tec/heatmap short-window VTEC over spiked station.current_tec
 * from /live/vtec-by-station latest samples, so marker labels match the heat
 * layer and the Live TEC footer range.
 */

import type { Station, TecHeatmapResponse } from "@/lib/types";
import { getLiveStationStatus } from "@/lib/liveStationStatus";

function stationKey(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/_+$/, "");
}

function isInterpolatedSource(source: string | null | undefined): boolean {
  return /estimate|interpolated|surface/i.test(source ?? "");
}

export function heatmapStationFor(
  station: Station,
  heatmap: TecHeatmapResponse | null | undefined,
) {
  const code = stationKey(station.code);
  return heatmap?.stations.find((s) => stationKey(s.code) === code) ?? null;
}

/**
 * True calculated GOPI VTEC for map markers / labels / site details.
 * Order matches the heat layer: measured NTRIP → surface estimate → card fallback.
 */
export function resolveStationMapVtec(
  station: Station,
  heatmap: TecHeatmapResponse | null | undefined,
): number | null {
  const heatStation = heatmapStationFor(station, heatmap);
  if (heatStation && /processed_archive/i.test(heatStation.source ?? "")) {
    return null;
  }

  // 1) Streaming measured live NTRIP (same values as heat colours + footer).
  const measuredLive =
    heatStation &&
    (heatStation.obs_count ?? 0) > 0 &&
    !isInterpolatedSource(heatStation.source);
  if (measuredLive) {
    const fromHeatmap = heatStation.vtec;
    if (typeof fromHeatmap === "number" && Number.isFinite(fromHeatmap) && fromHeatmap > 0) {
      return fromHeatmap;
    }
  }

  // 2) Non-streaming: interpolated live-surface VTEC when available.
  if (
    heatStation &&
    isInterpolatedSource(heatStation.source) &&
    typeof heatStation.vtec === "number" &&
    Number.isFinite(heatStation.vtec) &&
    heatStation.vtec > 0
  ) {
    return heatStation.vtec;
  }

  // 3) Fallback: station-card live decode (online sites only).
  const liveStatus = getLiveStationStatus(station);
  if (liveStatus === "offline" || liveStatus === "unavailable") return null;
  return typeof station.current_tec === "number" &&
    Number.isFinite(station.current_tec) &&
    station.current_tec > 0
    ? station.current_tec
    : null;
}
