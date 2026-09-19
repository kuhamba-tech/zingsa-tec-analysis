import type { SpaceWeatherCurrent } from "@/lib/types";

// This module must never import `@/lib/api`. Webpack turns api.ts circular
// imports into `rememberSpaceWeather is not a function` at runtime.

const SPACE_WEATHER_CACHE_KEY = "zgiis:last-good:space-weather:v3";

type Listener = (sw: SpaceWeatherCurrent) => void;

function hasFinite(value: unknown): boolean {
  return value != null && Number.isFinite(Number(value));
}

/** Accept any live snapshot with at least one usable index / count / stamp. */
function isUsable(value: unknown): value is SpaceWeatherCurrent {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SpaceWeatherCurrent>;
  // kp can be 0 (quiet) — Number.isFinite(0) is true.
  return (
    hasFinite(data.kp) ||
    hasFinite(data.dst) ||
    hasFinite(data.mean_vtec) ||
    hasFinite(data.stations_online) ||
    (typeof data.gnss_risk === "string" && data.gnss_risk.length > 0) ||
    Boolean(data.updated_utc)
  );
}

function readPersisted(): SpaceWeatherCurrent | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SPACE_WEATHER_CACHE_KEY) ?? "null");
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePersisted(data: SpaceWeatherCurrent) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPACE_WEATHER_CACHE_KEY, JSON.stringify(data));
  } catch {
    // private mode / quota — ignore
  }
}

let latest: SpaceWeatherCurrent | null = null;
const listeners = new Set<Listener>();

function ensureSeeded() {
  if (!latest) latest = readPersisted();
}

/** Null-safe merge so a later partial publish does not wipe EKF-filled fields. */
export function mergeSpaceWeatherPreferDefined(
  prev: SpaceWeatherCurrent | null,
  next: SpaceWeatherCurrent,
): SpaceWeatherCurrent {
  if (!prev) return next;
  const out = { ...prev } as SpaceWeatherCurrent;
  for (const key of Object.keys(next) as (keyof SpaceWeatherCurrent)[]) {
    const value = next[key];
    if (value === null || value === undefined) continue;
    // A flaky /current overlay of stations_online=0 (or empty VTEC) must not
    // erase a healthier SSR/boot snapshot — that is what painted CORS 0/25.
    if (
      (key === "stations_online" || key === "mean_vtec") &&
      typeof value === "number" &&
      Number(value) <= 0 &&
      typeof prev[key] === "number" &&
      Number(prev[key]) > 0
    ) {
      continue;
    }
    (out as unknown as Record<string, unknown>)[key as string] = value;
  }
  return out;
}

/** Publish a fresh space-weather snapshot to all subscribers + localStorage. */
export function publishSpaceWeather(sw: SpaceWeatherCurrent): SpaceWeatherCurrent {
  if (!isUsable(sw)) return sw;
  const merged = mergeSpaceWeatherPreferDefined(latest, sw);
  latest = merged;
  writePersisted(merged);
  listeners.forEach((fn) => fn(merged));
  return merged;
}

/** Read the last known snapshot (memory → localStorage). */
export function peekSpaceWeather(): SpaceWeatherCurrent | null {
  ensureSeeded();
  return latest;
}

/** Subscribe to store changes without an immediate callback (for useSyncExternalStore). */
export function subscribeSpaceWeatherStore(onStoreChange: () => void): () => void {
  ensureSeeded();
  const listener: Listener = () => onStoreChange();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Stable client snapshot for optional external-store readers.
 * Always returns the store `latest` reference (never window boot directly).
 */
export function getSpaceWeatherClientSnapshot(): SpaceWeatherCurrent | null {
  return peekSpaceWeather();
}

/** Subscribe to space-weather updates; returns an unsubscribe function. */
export function subscribeSpaceWeather(fn: Listener): () => void {
  ensureSeeded();
  if (latest) fn(latest);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
