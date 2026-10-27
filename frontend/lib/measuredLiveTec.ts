export type LiveTecSample = {
  vtec: number | null | undefined;
  source?: string | null;
  obs_count?: number | null;
};

const MEASURED_LIVE_SOURCES = new Set(["live", "live_ntrip"]);

export function measuredLiveTec(sample: LiveTecSample | null | undefined): number | null {
  if (!sample || !MEASURED_LIVE_SOURCES.has((sample.source ?? "").toLowerCase())) return null;
  if (typeof sample.obs_count !== "number" || sample.obs_count <= 0) return null;
  return typeof sample.vtec === "number" && Number.isFinite(sample.vtec) && sample.vtec > 0
    ? sample.vtec
    : null;
}