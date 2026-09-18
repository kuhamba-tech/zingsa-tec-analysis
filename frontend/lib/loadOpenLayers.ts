import type { OpenLayersApi } from "@/lib/openlayers";

let cached: Promise<OpenLayersApi> | null = null;

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const message = "message" in err ? String((err as { message?: string }).message) : "";
  return name === "ChunkLoadError" || /Loading chunk|ChunkLoadError/i.test(message);
}

/**
 * Dynamically load the consolidated OpenLayers module with retries.
 * One webpack async chunk for `@/lib/openlayers` beats 10+ racing `ol/*` chunks.
 */
export function loadOpenLayers(): Promise<OpenLayersApi> {
  if (!cached) {
    cached = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await import("@/lib/openlayers");
        } catch (err) {
          lastError = err;
          if (!isChunkLoadError(err) && attempt === 0) {
            // Non-chunk errors still get one retry after a short pause.
          }
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    })().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
