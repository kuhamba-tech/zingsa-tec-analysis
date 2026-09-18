import type { SpaceWeatherCurrent } from "@/lib/types";

// This module must never import `@/lib/api`. Webpack turns api.ts circular
// imports into `rememberSpaceWeather is not a function` at runtime.

const SPACE_WEATHER_CACHE_KEY = "zgiis:last-good:space-weather";

type Listener = (sw: SpaceWeatherCurrent) => void;

function isUsable(value: unknown): value is SpaceWeatherCurrent {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SpaceWeatherCurrent>;
  // kp can be 0 (quiet) — only reject missing fields.
  return data.kp != null && Number.isFinite(Number(data.kp)) && Boolean(data.updated_utc);
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

/** Publish a fresh space-weather snapshot to all subscribers + localStorage. */
export function publishSpaceWeather(sw: SpaceWeatherCurrent): SpaceWeatherCurrent {
  if (!isUsable(sw)) return sw;
  latest = sw;
  writePersisted(sw);
  listeners.forEach((fn) => fn(sw));
  return sw;
}

/** Read the last known snapshot (memory → localStorage). */
export function peekSpaceWeather(): SpaceWeatherCurrent | null {
  ensureSeeded();
  return latest;
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
