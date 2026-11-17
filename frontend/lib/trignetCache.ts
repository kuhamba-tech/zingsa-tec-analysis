import type { TrigNetResponse } from "./types";

const KEY = "zgiis-trignet-v1";

export function createTrigNetCache(persist = false) {
  let cached: { payload: TrigNetResponse; at: number } | null = null;
  let pending: Promise<TrigNetResponse> | null = null;
  function peek(): TrigNetResponse | null {
    if (!cached && persist && typeof window !== "undefined") {
      try {
        const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
        if (value && Number.isFinite(value.at) && Array.isArray(value.payload?.stations)) cached = value;
      } catch { /* Storage can be disabled or full. */ }
    }
    if (!cached) return null;
    const elapsed = Math.max(0, (Date.now() - cached.at) / 1000);
    if (elapsed > 86400) return null;
    const age = (cached.payload.collector_age_s ?? 0) + elapsed;
    return {
      ...cached.payload, collector_age_s: age,
      tec_ready: age > 180 ? 0 : cached.payload.tec_ready,
      gg_ready: age > 180 ? 0 : cached.payload.gg_ready,
      stations: cached.payload.stations.map(row => ({
        ...row,
        ...(age > 90 ? { connected: false, streaming: false } : {}),
        ...(age > 180 ? { vtec: null, vtec_time: null, gg_vtec: null, gg_time: null,
          gg_veq: null, raw_code_vtec: null, raw_code_vtec_time: null, samples: 0, gg_samples: 0 } : {}),
      })),
    };
  }
  function load(fetcher: () => Promise<TrigNetResponse>): Promise<TrigNetResponse> {
    if (pending) return pending;
    if (cached && Date.now() - cached.at < 5000) return Promise.resolve(peek()!);
    pending = fetcher().then(payload => {
      cached = { payload, at: Date.now() };
      if (persist && typeof window !== "undefined") {
        try { window.sessionStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* Optional cache. */ }
      }
      return payload;
    }).finally(() => { pending = null; });
    return pending;
  }
  return { peek, load };
}

export const trignetCache = createTrigNetCache(true);
