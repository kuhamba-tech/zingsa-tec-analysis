import { buildAiRecommendations, type AiRecommendationResult } from "./aiRecommendations";
import {
  buildGnssAvailabilityForecast,
  fetchNoaaKpForecast,
  type GnssAvailabilityForecast,
  type NoaaKpForecastRow,
} from "./gnssAvailabilityForecast";
import { buildGnssForecastBundle } from "./gnssForecastEngine";
import { formatIndicesUpdatedLabel } from "./spaceWeatherMetrics";
import { getGicStatus, getStations } from "./api";
import type { GicStatusResponse, SpaceWeatherCurrent, Station } from "./types";

export interface NavigationNewsBundle {
  recommendations: AiRecommendationResult["recommendations"];
  tone: AiRecommendationResult["tone"];
  availability: GnssAvailabilityForecast;
}

/** Synchronous build — uses the same `sw` snapshot as the metric cards. */
export function buildNavigationNewsSync(
  sw: SpaceWeatherCurrent | null,
  stations: Station[],
  gic: GicStatusResponse | null,
  kpRows: NoaaKpForecastRow[],
): NavigationNewsBundle | null {
  if (!sw && stations.length === 0) return null;

  const bundle = buildGnssForecastBundle(sw, stations);
  const result = buildAiRecommendations(bundle.forecasts, sw, gic, bundle.computedAt);
  const availability = buildGnssAvailabilityForecast(sw, bundle.forecasts, kpRows, result.tone);

  return {
    recommendations: result.recommendations,
    tone: result.tone,
    availability,
  };
}

/** Fetch CORS/GIC/Kp-forecast inputs, then build from the provided index snapshot. */
export async function buildNavigationNewsFromIndices(
  sw: SpaceWeatherCurrent | null,
  stations?: Station[] | null,
): Promise<NavigationNewsBundle | null> {
  const [stationsData, gic, kpRows] = await Promise.all([
    stations != null
      ? Promise.resolve(stations)
      : getStations(true).catch(() => [] as Station[]),
    getGicStatus().catch(() => null as GicStatusResponse | null),
    fetchNoaaKpForecast(),
  ]);

  return buildNavigationNewsSync(sw, stationsData, gic, kpRows);
}

export function hasIndicesForNews(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return (
    sw.kp != null ||
    sw.dst != null ||
    sw.f107 != null ||
    sw.plasma_speed != null ||
    sw.s4 != null ||
    sw.gnss_risk != null ||
    sw.stations_online != null
  );
}

export { formatIndicesUpdatedLabel };
