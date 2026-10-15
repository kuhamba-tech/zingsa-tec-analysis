"use client";

/**
 * Resilient dynamic import for GoesSolarXrayCard.
 *
 * Dev webpack + Cursor CVM port-forward can drop large chart chunks mid-fetch
 * (`ChunkLoadError`). Retries usually recover; persistent failures trigger one
 * hard reload so the browser picks up a fresh chunk hash.
 */

const RELOAD_KEY = "zgiis:goes-xray-chunk-reload";

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

function reloadOnce(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

type GoesMod = typeof import("@/components/spaceWeather/GoesSolarXrayCard");

let cached: Promise<GoesMod> | null = null;

export function loadGoesSolarXrayCard(): Promise<GoesMod> {
  if (cached) return cached;

  cached = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await import(
          /* webpackChunkName: "goes-solar-xray-card" */
          "@/components/spaceWeather/GoesSolarXrayCard"
        );
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* ignore */
        }
        return mod;
      } catch (err) {
        lastError = err;
        cached = null;
        await sleep(300 * (attempt + 1));
      }
    }
    cached = null;
    if (isChunkLoadError(lastError)) {
      reloadOnce();
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })().catch((err) => {
    cached = null;
    throw err;
  });

  return cached;
}
