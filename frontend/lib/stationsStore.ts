import type { Station } from "@/lib/types";

const STATIONS_CACHE_KEY = "zgiis:last-good:cors-stations";

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
  } catch {
    // private mode / quota — ignore
  }
}

let latest: Station[] | null = null;
const listeners = new Set<Listener>();

function ensureSeeded() {
  if (!latest) latest = readPersisted();
}

export function publishStations(stations: Station[]): Station[] {
  if (!isUsable(stations)) return stations;
  latest = stations;
  writePersisted(stations);
  listeners.forEach((fn) => fn(stations));
  return stations;
}

export function peekStations(): Station[] {
  ensureSeeded();
  return latest ?? [];
}

export function subscribeStations(fn: Listener): () => void {
  ensureSeeded();
  if (latest) fn(latest);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
