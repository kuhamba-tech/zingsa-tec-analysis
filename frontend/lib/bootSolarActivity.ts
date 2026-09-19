/**
 * Lightweight solar-activity warmer — avoids pulling in api.ts before paint.
 */
import { resolveClientApiUrl } from "@/lib/clientApiBase";
import { absorbInlineSolarBootPayload, peekSolarActivity, publishSolarActivity } from "@/lib/solarActivityStore";
import type { SolarActivityFull } from "@/lib/types";

const BOOT_TIMEOUT_MS = 10_000;

declare global {
  interface Window {
    __ZGIIS_SA_BOOT?: SolarActivityFull | null;
    __ZGIIS_SA_BOOT_PROMISE?: Promise<SolarActivityFull | null>;
  }
}

function isBootPayload(value: unknown): value is SolarActivityFull {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SolarActivityFull>;
  if (!data.updated || typeof data.updated !== "string") return false;
  if (data.mode === "unavailable" && !data.flare_class && !data.solar_wind) return false;
  return data.mode != null && data.mode !== "";
}

export function bootSolarActivity(): Promise<SolarActivityFull | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  absorbInlineSolarBootPayload();
  const cached = peekSolarActivity();
  if (cached) return Promise.resolve(cached);
  if (window.__ZGIIS_SA_BOOT_PROMISE) return window.__ZGIIS_SA_BOOT_PROMISE;

  const url = resolveClientApiUrl("/space-weather/solar-activity");
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
      if (!res.ok) throw new Error(`boot SA ${res.status}`);
      const data = (await res.json()) as SolarActivityFull;
      if (!isBootPayload(data)) throw new Error("boot SA unusable payload");
      window.__ZGIIS_SA_BOOT = data;
      return publishSolarActivity(data);
    })
    .catch(() => peekSolarActivity())
    .finally(() => {
      window.clearTimeout(timer);
      if (!peekSolarActivity()) {
        delete window.__ZGIIS_SA_BOOT_PROMISE;
      }
    });

  window.__ZGIIS_SA_BOOT_PROMISE = pending;
  return pending;
}
