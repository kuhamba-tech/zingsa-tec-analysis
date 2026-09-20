/**
 * Shared light params for GOPI vs Gg comparison — one cache key, fast first paint.
 * Mobile / Save-Data uses a smaller window so the API worker stays free.
 */

import { getLoadProfile } from "@/lib/loadBudget";

export const TEC_METHOD_CMP_HOURS = 4;
export const TEC_METHOD_CMP_LIMIT = 300;
export const TEC_METHOD_CMP_TIMEOUT_MS = 25_000;

export function getTecMethodCmpParams(): {
  hours: number;
  limit: number;
  timeoutMs: number;
} {
  if (typeof window === "undefined") {
    return {
      hours: TEC_METHOD_CMP_HOURS,
      limit: TEC_METHOD_CMP_LIMIT,
      timeoutMs: TEC_METHOD_CMP_TIMEOUT_MS,
    };
  }
  const profile = getLoadProfile();
  if (profile.slowNetwork) {
    return { hours: 3, limit: 150, timeoutMs: 18_000 };
  }
  if (profile.constrained) {
    return { hours: 3, limit: 200, timeoutMs: 20_000 };
  }
  return {
    hours: TEC_METHOD_CMP_HOURS,
    limit: TEC_METHOD_CMP_LIMIT,
    timeoutMs: TEC_METHOD_CMP_TIMEOUT_MS,
  };
}
