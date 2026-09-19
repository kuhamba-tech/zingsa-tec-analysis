"use client";

/**
 * Resilient dynamic import for CauseEffectTimelineStack.
 *
 * Webpack HMR can leave the browser holding a stale chunk hash
 * (`…CauseEffectTimelineStack_tsx-_04d70.js`). Retries usually recover;
 * persistent ChunkLoadError triggers one hard reload.
 */

const RELOAD_KEY = "zgiis:cause-effect-chunk-reload";

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

type CauseEffectMod = typeof import("@/components/spaceWeather/CauseEffectTimelineStack");

let cached: Promise<CauseEffectMod> | null = null;

export function loadCauseEffectTimelineStack(): Promise<CauseEffectMod> {
  if (cached) return cached;

  cached = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await import(
          /* webpackChunkName: "cause-effect-timelines" */
          "@/components/spaceWeather/CauseEffectTimelineStack"
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
        if (attempt < 2) {
          cached = null;
        }
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

/** Fire-and-forget prefetch that never surfaces ChunkLoadError to the UI overlay. */
export function prefetchCauseEffectTimelineStack(): void {
  void loadCauseEffectTimelineStack().catch(() => null);
}
