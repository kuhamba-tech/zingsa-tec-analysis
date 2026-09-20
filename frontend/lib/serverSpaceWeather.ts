/**
 * Server-only bootstrap for space-weather metric cards.
 * Hits FastAPI directly (not the browser /backend proxy) so SSR HTML can
 * paint live values before client JS hydrates.
 *
 * Keep timeouts short so a slow solar feed cannot block first HTML.
 */
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";

const API =
  (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(
    /\/$/,
    "",
  );

async function getJson<T>(path: string, timeoutMs = 1800): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}_ts=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: process.env.NEXT_PUBLIC_API_KEY
        ? { "X-API-Key": process.env.NEXT_PUBLIC_API_KEY }
        : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type SpaceWeatherBootstrap = {
  sw: SpaceWeatherCurrent | null;
  sa: SolarActivityFull | null;
};

export async function fetchSpaceWeatherBootstrap(): Promise<SpaceWeatherBootstrap> {
  // Prefer /current for first paint; solar can arrive null and hydrate later.
  const swPromise = getJson<SpaceWeatherCurrent>("/space-weather/current", 1600);
  const saPromise = getJson<SolarActivityFull>("/space-weather/solar-activity", 1200);
  const [sw, sa] = await Promise.all([swPromise, saPromise]);
  return { sw, sa };
}
