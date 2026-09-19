import type { SolarActivityFull } from "@/lib/types";

// Must never import `@/lib/api` (circular bundling risk).

const SOLAR_CACHE_KEY = "zgiis:last-good:solar-activity";

type Listener = (sa: SolarActivityFull) => void;

function isUsable(value: unknown): value is SolarActivityFull {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SolarActivityFull>;
  if (!data.updated || typeof data.updated !== "string") return false;
  // Accept live/partial/stale — reject hard unavailable without any plasma/xray context.
  if (data.mode === "unavailable" && !data.flare_class && !data.solar_wind) return false;
  return data.mode != null && data.mode !== "";
}

function readPersisted(): SolarActivityFull | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SOLAR_CACHE_KEY) ?? "null");
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePersisted(data: SolarActivityFull) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOLAR_CACHE_KEY, JSON.stringify(data));
  } catch {
    // private mode / quota
  }
}

let latest: SolarActivityFull | null = null;
const listeners = new Set<Listener>();

function ensureSeeded() {
  if (!latest) latest = readPersisted();
}

export function publishSolarActivity(sa: SolarActivityFull): SolarActivityFull {
  if (!isUsable(sa)) return sa;
  // Prefer keeping a previous good snapshot over caching hard-unavailable.
  if (sa.mode === "unavailable" && latest && latest.mode !== "unavailable") {
    return latest;
  }
  latest = sa;
  writePersisted(sa);
  listeners.forEach((fn) => fn(sa));
  return sa;
}

export function peekSolarActivity(): SolarActivityFull | null {
  ensureSeeded();
  return latest;
}

/** Subscribe without an immediate callback (for useSyncExternalStore). */
export function subscribeSolarActivityStore(onStoreChange: () => void): () => void {
  ensureSeeded();
  const listener: Listener = () => onStoreChange();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable client snapshot — store `latest` only (never window boot directly). */
export function getSolarActivityClientSnapshot(): SolarActivityFull | null {
  return peekSolarActivity();
}

/** Apply pre-React layout boot payload into the shared solar store. */
export function absorbInlineSolarBootPayload(): SolarActivityFull | null {
  if (typeof window === "undefined") return null;
  const boot = (window as Window & { __ZGIIS_SA_BOOT?: unknown }).__ZGIIS_SA_BOOT;
  if (isUsable(boot)) {
    return publishSolarActivity(boot);
  }
  return peekSolarActivity();
}

export function subscribeSolarActivity(fn: Listener): () => void {
  ensureSeeded();
  if (latest) fn(latest);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
