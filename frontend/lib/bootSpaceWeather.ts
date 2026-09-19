/**
 * Tiny cold-start warmer for space-weather metrics.
 * Intentionally avoids `@/lib/api` so layout can fetch before the heavy
 * api.ts chunk downloads.
 */
import {
  noteSpaceWeatherNetworkOk,
  resolveClientApiUrl,
  spaceWeatherFetchedRecently,
} from "@/lib/clientApiBase";
import { peekSpaceWeather, publishSpaceWeather } from "@/lib/spaceWeatherStore";
import type { SpaceWeatherCurrent } from "@/lib/types";

const BOOT_TIMEOUT_MS = 5_000;

declare global {
  interface Window {
    __ZGIIS_SW_BOOT?: SpaceWeatherCurrent | null;
    __ZGIIS_SW_BOOT_PROMISE?: Promise<SpaceWeatherCurrent | null>;
  }
}

function isBootPayload(value: unknown): value is SpaceWeatherCurrent {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SpaceWeatherCurrent>;
  return (
    (data.kp != null && Number.isFinite(Number(data.kp))) ||
    (data.dst != null && Number.isFinite(Number(data.dst))) ||
    (typeof data.gnss_risk === "string" && data.gnss_risk.length > 0) ||
    (data.mean_vtec != null && Number.isFinite(Number(data.mean_vtec))) ||
    (data.stations_online != null && Number.isFinite(Number(data.stations_online)))
  );
}

/** Apply any pre-React inline boot payload into the shared store. */
export function absorbInlineBootPayload(): SpaceWeatherCurrent | null {
  if (typeof window === "undefined") return null;
  const boot = window.__ZGIIS_SW_BOOT;
  if (isBootPayload(boot)) {
    noteSpaceWeatherNetworkOk();
    return publishSpaceWeather(boot);
  }
  return peekSpaceWeather();
}

/**
 * Fire-and-forget fetch of `/space-weather/current`. Deduped per tab while
 * in flight; failed attempts clear the promise so a later call can retry.
 */
export function bootSpaceWeather(): Promise<SpaceWeatherCurrent | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  absorbInlineBootPayload();
  const cached = peekSpaceWeather();
  if (cached && spaceWeatherFetchedRecently()) return Promise.resolve(cached);
  if (window.__ZGIIS_SW_BOOT_PROMISE) return window.__ZGIIS_SW_BOOT_PROMISE;

  const url = resolveClientApiUrl("/space-weather/current");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), BOOT_TIMEOUT_MS);

  const pending = fetch(`${url}${url.includes("?") ? "&" : "?"}_ts=${Date.now()}`, {
    cache: "no-store",
    signal: controller.signal,
    headers: process.env.NEXT_PUBLIC_API_KEY
      ? { "X-API-Key": process.env.NEXT_PUBLIC_API_KEY }
      : undefined,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`boot SW ${res.status}`);
      const data = (await res.json()) as SpaceWeatherCurrent;
      if (!isBootPayload(data)) throw new Error("boot SW unusable payload");
      window.__ZGIIS_SW_BOOT = data;
      noteSpaceWeatherNetworkOk();
      return publishSpaceWeather(data);
    })
    .catch(() => peekSpaceWeather())
    .finally(() => {
      window.clearTimeout(timer);
      // Drop failed/null so a later call can retry; keep success via clock.
      if (!peekSpaceWeather()) {
        delete window.__ZGIIS_SW_BOOT_PROMISE;
      }
    });

  window.__ZGIIS_SW_BOOT_PROMISE = pending;
  return pending;
}
