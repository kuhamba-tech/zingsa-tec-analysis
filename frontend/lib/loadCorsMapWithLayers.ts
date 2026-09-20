"use client";

/**
 * Resilient dynamic import for CorsMapWithLayers (leaflet / OpenLayers stack).
 * Retries transient webpack ChunkLoadError from HMR stale hashes.
 */

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const message = "message" in err ? String((err as { message?: string }).message) : "";
  return name === "ChunkLoadError" || /Loading chunk|ChunkLoadError/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type CorsMapMod = typeof import("@/components/maps/CorsMapWithLayers");

let cached: Promise<CorsMapMod> | null = null;

export function loadCorsMapWithLayers(): Promise<CorsMapMod> {
  if (cached) return cached;

  cached = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await import(
          /* webpackChunkName: "cors-map-with-layers" */
          "@/components/maps/CorsMapWithLayers"
        );
        return mod;
      } catch (err) {
        lastError = err;
        cached = null;
        await sleep(300 * (attempt + 1));
      }
    }
    cached = null;
    if (isChunkLoadError(lastError)) {
      try {
        const key = "zgiis:cors-map-chunk-reload";
        if (typeof window !== "undefined" && sessionStorage.getItem(key) !== "1") {
          sessionStorage.setItem(key, "1");
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })().catch((err) => {
    cached = null;
    throw err;
  });

  return cached;
}
