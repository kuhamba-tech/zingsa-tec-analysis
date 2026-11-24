import type { Station, TecHeatmapResponse } from "./types";
import { stationCodeKey } from "./idwSurface";
import { getLiveStationStatus } from "./liveStationStatus";
import { measuredLiveTec } from "./measuredLiveTec";

export function heatmapStationFor(station: Station, heatmap: TecHeatmapResponse | null | undefined) {
  const code = stationCodeKey(station.code);
  return heatmap?.stations.find(sample => stationCodeKey(sample.code) === code) ?? null;
}

export function stationTecValue(station: Station, heatmap: TecHeatmapResponse | null | undefined): number | null {
  if (getLiveStationStatus(station) !== "online") return null;
  const sample = heatmapStationFor(station, heatmap);
  if (sample && /processed_archive/i.test(sample.source ?? "")) return null;
  const measured = measuredLiveTec(sample);
  if (measured != null) return measured;
  const value = station.current_tec;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
