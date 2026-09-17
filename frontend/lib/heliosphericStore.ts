import type { HeliosphericMonitorResponse } from "@/lib/types";

const HELIO_CACHE_KEY = "zgiis:last-good:heliospheric-monitor";

function isUsable(value: unknown): value is HeliosphericMonitorResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<HeliosphericMonitorResponse>;
  const wind = data.solar_wind;
  return Boolean(wind && Array.isArray(wind.labels) && wind.labels.length > 0);
}

export function peekHeliosphericMonitor(): HeliosphericMonitorResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(HELIO_CACHE_KEY) ?? "null");
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberHeliosphericMonitor(data: HeliosphericMonitorResponse): HeliosphericMonitorResponse {
  if (typeof window === "undefined" || !isUsable(data)) return data;
  try {
    window.sessionStorage.setItem(HELIO_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
  return data;
}
