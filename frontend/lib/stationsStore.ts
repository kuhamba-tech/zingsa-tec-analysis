import type { Station } from "@/lib/types";

const STATIONS_CACHE_KEY = "zgiis:last-good:cors-stations";
const STATIONS_CACHE_META_KEY = "zgiis:last-good:cors-stations-meta";

/** Prefer a fresh Spider pull over a multi-minute browser snapshot. */
export const STATIONS_CACHE_MAX_AGE_MS = 90_000;

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

function readPersistedMeta(): { savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STATIONS_CACHE_META_KEY) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { savedAt?: unknown }).savedAt === "number"
    ) {
      return { savedAt: (parsed as { savedAt: number }).savedAt };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readPersisted(): Station[] | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STATIONS_CACHE_KEY) ?? "null");
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePersisted(stations: Station[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify(stations));
    window.localStorage.setItem(STATIONS_CACHE_META_KEY, JSON.stringify({ savedAt: Date.now() }));
  } catch {
    // private mode / quota — ignore
  }
}

let latest: Station[] | null = null;
let latestSavedAt = 0;
const listeners = new Set<Listener>();

function ensureSeeded() {
  if (!latest) {
    latest = readPersisted();
    latestSavedAt = readPersistedMeta()?.savedAt ?? 0;
  }
}

export function publishStations(stations: Station[]): Station[] {
  if (!isUsable(stations)) return stations;
  latest = stations;
  latestSavedAt = Date.now();
  writePersisted(stations);
  listeners.forEach((fn) => fn(stations));
  return stations;
}

export function peekStations(): Station[] {
  ensureSeeded();
  return latest ?? [];
}

/** True when the in-memory / localStorage snapshot is too old for Spider status. */
export function stationsCacheIsStale(maxAgeMs = STATIONS_CACHE_MAX_AGE_MS): boolean {
  ensureSeeded();
  if (!latest?.length) return true;
  if (!latestSavedAt) return true;
  return Date.now() - latestSavedAt > maxAgeMs;
}

export function subscribeStations(fn: Listener): () => void {
  ensureSeeded();
  if (latest) fn(latest);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
