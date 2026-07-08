/** ICAO Doc 10100 GNSS advisory thresholds (vertical TEC). */

export const TEC_SCALE_MIN = 0;
export const TEC_SCALE_MAX = 200;
export const ICAO_TEC_MOD = 125;
export const ICAO_TEC_SEV = 175;

export type IcaoTecLevel = "quiet" | "mod" | "sev";

export function icaoTecLevel(vtec: number | null | undefined): IcaoTecLevel {
  if (vtec == null || !Number.isFinite(vtec)) return "quiet";
  if (vtec >= ICAO_TEC_SEV) return "sev";
  if (vtec >= ICAO_TEC_MOD) return "mod";
  return "quiet";
}

export function icaoTecLabel(vtec: number | null | undefined): string {
  const level = icaoTecLevel(vtec);
  if (level === "sev") return `SEV — ≥${ICAO_TEC_SEV} TECU (ICAO Doc 10100)`;
  if (level === "mod") return `MOD — ≥${ICAO_TEC_MOD} TECU (ICAO Doc 10100)`;
  return "Below ICAO GNSS advisory thresholds";
}

export function icaoTecColor(vtec: number | null | undefined): string {
  const level = icaoTecLevel(vtec);
  if (level === "sev") return "#ef4444";
  if (level === "mod") return "#f97316";
  return "#00ff88";
}

export function icaoTecDistanceLabel(vtec: number | null | undefined): string | null {
  if (vtec == null || !Number.isFinite(vtec)) return null;
  if (vtec >= ICAO_TEC_SEV) return `${(vtec - ICAO_TEC_SEV).toFixed(1)} TECU above SEV threshold`;
  if (vtec >= ICAO_TEC_MOD) return `${(vtec - ICAO_TEC_MOD).toFixed(1)} TECU above MOD threshold`;
  return `${(ICAO_TEC_MOD - vtec).toFixed(1)} TECU below MOD threshold`;
}

export type HeatmapDataQuality = "none" | "regional_mean" | "stations_only" | "station" | "processed_archive";

export function inferHeatmapQuality(
  heatmap: {
    available: boolean;
    data_quality?: HeatmapDataQuality;
    stations: { code: string; obs_count?: number }[];
    grid?: unknown;
  } | null,
): HeatmapDataQuality {
  if (!heatmap?.available) return "none";
  if (heatmap.data_quality) return heatmap.data_quality;
  const codes = new Set(heatmap.stations.map((s) => s.code.toLowerCase()));
  const regional = new Set(["nw", "ne", "cent", "sw", "se"]);
  if (codes.size > 0 && [...codes].every((c) => regional.has(c))) return "regional_mean";
  if (heatmap.stations.length > 0 && heatmap.stations.every((s) => (s.obs_count ?? 0) === 0)) {
    return "regional_mean";
  }
  if (!heatmap.grid) return "stations_only";
  return "station";
}

export function heatmapQualityBanner(
  quality: HeatmapDataQuality | null | undefined,
  message: string | null | undefined,
): string | null {
  if (quality === "regional_mean") {
    return (
      message ??
      "Regional overview from national mean VTEC only — not per-station CORS measurements. Start the live pipeline for station-level TEC."
    );
  }
  if (quality === "stations_only") {
    return message ?? "Station VTEC available; interpolated grid could not be built — check that at least three stations report live data.";
  }
  if (quality === "processed_archive") {
    return message ?? "Showing calculated VTEC from processed RINEX/CMN files while live NTRIP VTEC is unavailable.";
  }
  if (quality === "none" && message) return message;
  return null;
}
