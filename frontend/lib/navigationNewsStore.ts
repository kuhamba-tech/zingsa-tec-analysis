import type { NoaaKpForecastRow } from "@/lib/gnssAvailabilityForecast";
import type { GicStatusResponse, Station } from "@/lib/types";

/**
 * Shared Navigation News supplements so Home and Live Space Weather
 * render the same briefs from one fetch instead of racing separate GIC/Kp calls.
 */
export interface NavigationNewsSupplements {
  stations: Station[];
  gic: GicStatusResponse | null;
  kpRows: NoaaKpForecastRow[];
  fetchedAt: number;
}

const MAX_AGE_MS = 60_000;

let latest: NavigationNewsSupplements | null = null;
let inflight: Promise<NavigationNewsSupplements> | null = null;

export function peekNavigationNewsSupplements(): NavigationNewsSupplements | null {
  if (!latest) return null;
  if (Date.now() - latest.fetchedAt > MAX_AGE_MS) return null;
  return latest;
}

export function publishNavigationNewsSupplements(
  data: Omit<NavigationNewsSupplements, "fetchedAt">,
): NavigationNewsSupplements {
  latest = { ...data, fetchedAt: Date.now() };
  return latest;
}

/** Deduped fetch of stations + GIC + NOAA Kp forecast for Navigation News. */
export async function loadNavigationNewsSupplements(
  stationsHint?: Station[] | null,
): Promise<NavigationNewsSupplements> {
  const cached = peekNavigationNewsSupplements();
  if (cached) {
    if (stationsHint != null && stationsHint.length > 0 && cached.stations.length === 0) {
      return publishNavigationNewsSupplements({
        stations: stationsHint,
        gic: cached.gic,
        kpRows: cached.kpRows,
      });
    }
    return cached;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const { getGicStatus, getStations } = await import("@/lib/api");
    const { fetchNoaaKpForecast } = await import("@/lib/gnssAvailabilityForecast");
    const [stationsData, gicData, kpForecast] = await Promise.all([
      stationsHint != null
        ? Promise.resolve(stationsHint)
        : getStations(false).catch(() => [] as Station[]),
      getGicStatus().catch(() => null as GicStatusResponse | null),
      fetchNoaaKpForecast(),
    ]);
    return publishNavigationNewsSupplements({
      stations: stationsData,
      gic: gicData,
      kpRows: kpForecast,
    });
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
