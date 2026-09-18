/**
 * Tiny cold-start warmer for space-weather metrics.
 * Intentionally avoids `@/lib/api` so layout can fetch before the heavy
 * api.ts chunk downloads.
 */
import { peekSpaceWeather, publishSpaceWeather } from "@/lib/spaceWeatherStore";
import type { SpaceWeatherCurrent } from "@/lib/types";

function bootApiBase(): string {
  if (typeof window === "undefined") return "";
  const { hostname, port, origin, protocol } = window.location;
  if (
    process.env.NODE_ENV === "development" ||
    port === "3000" ||
    port === "3001" ||
    port === "43128"
  ) {
    return `${origin}/backend`;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return `${protocol}//127.0.0.1:8000`;
  }
  return `${origin}/api`;
}

declare global {
  interface Window {
    __ZGIIS_SW_BOOT?: SpaceWeatherCurrent | null;
    __ZGIIS_SW_BOOT_PROMISE?: Promise<SpaceWeatherCurrent | null>;
  }
}

/** Apply any pre-React inline boot payload into the shared store. */
export function absorbInlineBootPayload(): SpaceWeatherCurrent | null {
  if (typeof window === "undefined") return null;
  const boot = window.__ZGIIS_SW_BOOT;
  if (boot && typeof boot === "object" && boot.kp != null) {
    return publishSpaceWeather(boot);
  }
  return peekSpaceWeather();
}

/**
 * Fire-and-forget fetch of `/space-weather/current`. Deduped per tab.
 * Returns cached/in-flight data when available.
 */
export function bootSpaceWeather(): Promise<SpaceWeatherCurrent | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  absorbInlineBootPayload();
  const cached = peekSpaceWeather();
  if (window.__ZGIIS_SW_BOOT_PROMISE) return window.__ZGIIS_SW_BOOT_PROMISE;

  const base = bootApiBase();
  if (!base) return Promise.resolve(cached);

  const pending = fetch(`${base}/space-weather/current?_ts=${Date.now()}`, {
    cache: "no-store",
    headers: process.env.NEXT_PUBLIC_API_KEY
      ? { "X-API-Key": process.env.NEXT_PUBLIC_API_KEY }
      : undefined,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`boot SW ${res.status}`);
      const data = (await res.json()) as SpaceWeatherCurrent;
      window.__ZGIIS_SW_BOOT = data;
      return publishSpaceWeather(data);
    })
    .catch(() => peekSpaceWeather())
    .finally(() => {
      /* keep promise for dedupe during this page life */
    });

  window.__ZGIIS_SW_BOOT_PROMISE = pending;
  return pending;
}
