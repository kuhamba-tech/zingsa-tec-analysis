import type { Station } from "@/lib/types";

const STATIONS_CACHE_KEY = "zgiis:last-good:cors-stations";
const STATIONS_CACHE_META_KEY = "zgiis:last-good:cors-stations-meta";

/** Spider status changes often — never treat a browser snapshot as live truth. */
export const STATIONS_CACHE_MAX_AGE_MS = 15_000;

type Listener = (stations: Station[]) => void;

function isUsable(value: unknown): value is Station[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof (row as Station).code === "string" &&
      (row as Station).code.length > 0,
  );
}

function clearPersisted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STATIONS_CACHE_KEY);
    window.localStorage.removeItem(STATIONS_CACHE_META_KEY);
  } catch {
    /* ignore */
  }
}

let latest: Station[] | null = null;
let latestSavedAt = 0;
const listeners = new Set<Listener>();

/** Drop any old localStorage catalog snapshots from previous deploys. */
export function purgeStaleStationsCache(): void {
  clearPersisted();
  latest = null;
  latestSavedAt = 0;
}

export function publishStations(stations: Station[]): Station[] {
  if (!isUsable(stations)) return stations;
  // Catalog/unknown must never become the shared "latest" snapshot.
  if (!stationsAreSpiderAuthoritative(stations)) {
    clearPersisted();
    return stations;
  }
  latest = stations;
  latestSavedAt = Date.now();
  clearPersisted();
  listeners.forEach((fn) => fn(stations));
  return stations;
}

export function peekStations(): Station[] {
  // Never seed from localStorage — open-after-idle must hit the live API.
  return latest ?? [];
}

/** Always stale unless we just received Spider rows in this page session. */
export function stationsCacheIsStale(maxAgeMs = STATIONS_CACHE_MAX_AGE_MS): boolean {
  if (!latest?.length) return true;
  if (!latestSavedAt) return true;
  if (!stationsAreSpiderAuthoritative(latest)) return true;
  return Date.now() - latestSavedAt > maxAgeMs;
}

/** Majority Spider Site Status — safe to show as live online/offline. */
export function stationsAreSpiderAuthoritative(stations: Station[]): boolean {
  if (!stations.length) return false;
  const spider = stations.filter((s) => s.status_source === "spider").length;
  return spider >= Math.ceil(stations.length / 2);
}

export function subscribeStations(fn: Listener): () => void {
  if (latest) fn(latest);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
