import type { Station, TecHeatmapResponse } from "@/lib/types";

/** Merge station-level live VTEC into an empty heat-map API response. */
export function mergeTecHeatmapWithStations(
  heatmap: TecHeatmapResponse | null,
  stations: Station[],
): TecHeatmapResponse | null {
  if (heatmap?.available && (heatmap.stations?.length ?? 0) > 0) {
    return heatmap;
  }

  const reporting = stations.filter(
    (s) => typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0,
  );
  if (reporting.length === 0) {
    return heatmap;
  }

  const heatmapStations = reporting.map((s) => ({
    code: s.code,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    vtec: s.current_tec as number,
    obs_count: 1,
  }));

  const tecValues = heatmapStations.map((s) => s.vtec);
  const heatPoints = heatmapStations.map((s) => ({
    lon: s.lon,
    lat: s.lat,
    vtec: s.vtec,
    weight: Math.max(0.05, Math.min(1, s.vtec / 200)),
    code: s.code,
  }));

  return {
    available: true,
    stations: heatmapStations,
    heat_points: heatPoints,
    grid: null,
    bounds: [25.5, -22.5, 33.5, -15.5],
    tec_min: Math.min(...tecValues),
    tec_max: Math.max(...tecValues),
    station_count: heatmapStations.length,
    updated_at: null,
    message:
      reporting.length === 1
        ? "1 connected CORS site reporting live VTEC from NTRIP decode."
        : `${reporting.length} connected CORS sites reporting live VTEC from NTRIP decode.`,
    data_quality: "stations_only",
    icao_mod_tecu: 125,
    icao_sev_tecu: 175,
  };
}
