import type { Station, TecHeatmapResponse } from "@/lib/types";
import { getLiveStationStatus } from "@/lib/liveStationStatus";

function stationKey(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/_+$/, "");
}

function isInterpolatedSource(source: string | null | undefined): boolean {
  return /estimate|interpolated|surface/i.test(source ?? "");
}

function isArchiveHeatmap(heatmap: TecHeatmapResponse | null | undefined): boolean {
  if (!heatmap) return false;
  if (heatmap.data_quality === "processed_archive") return true;
  const stations = heatmap.stations ?? [];
  return stations.some((s) => /processed_archive/i.test(s.source ?? ""));
}

/** Merge station-level live VTEC into an empty heat-map API response. */
export function mergeTecHeatmapWithStations(
  heatmap: TecHeatmapResponse | null,
  stations: Station[],
): TecHeatmapResponse | null {
  // Never paint stale RINEX/CMN archive VTEC on the live TEC heat map.
  const liveHeatmap = isArchiveHeatmap(heatmap)
    ? {
        ...heatmap!,
        available: false,
        stations: [],
        heat_points: [],
        grid: null,
        tec_min: null,
        tec_max: null,
        station_count: 0,
        data_quality: "none" as const,
        message:
          "Live TEC heat map ignores processed RINEX/CMN archive values. Waiting for live NTRIP VTEC.",
      }
    : heatmap;

  if (liveHeatmap?.available && (liveHeatmap.stations?.length ?? 0) > 0) {
    const stationStatusByCode = new Map(
      stations.map((s) => [stationKey(s.code), getLiveStationStatus(s)]),
    );
    const isOfflineStation = (code: string | null | undefined) => {
      if (!code) return false;
      const status = stationStatusByCode.get(stationKey(code));
      return status === "offline" || status === "unavailable";
    };
    const heatmapStations = liveHeatmap.stations.map((s) => {
      if (!isOfflineStation(s.code)) return s;
      return {
        ...s,
        obs_count: 0,
        source: isInterpolatedSource(s.source) ? s.source : "interpolated_offline",
      };
    });
    const values = heatmapStations.map((s) => s.vtec).filter((v) => Number.isFinite(v));
    return {
      ...liveHeatmap,
      stations: heatmapStations,
      heat_points: liveHeatmap.heat_points,
      tec_min: values.length > 0 ? Math.min(...values) : liveHeatmap.tec_min,
      tec_max: values.length > 0 ? Math.max(...values) : liveHeatmap.tec_max,
      message: liveHeatmap.message
        ? `${liveHeatmap.message} Offline/unavailable stations retain interpolated TEC estimates where the grid is available.`
        : "Offline/unavailable stations retain interpolated TEC estimates where the grid is available.",
    };
  }

  const reporting = stations.filter(
    (s) => typeof s.current_tec === "number" && Number.isFinite(s.current_tec) && s.current_tec > 0,
  );
  if (reporting.length === 0) {
    return liveHeatmap;
  }

  const heatmapStations = reporting.map((s) => ({
    code: s.code,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    vtec: s.current_tec as number,
    obs_count: 1,
    source: "live",
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
