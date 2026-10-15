"use client";

/**
 * Single shared LineChart (Chart.js) loader for Space Weather graphs.
 *
 * Without this, Heliospheric / Cause-Effect / Solar labs each emit a ~2MB
 * webpack chunk that re-downloads Chart.js over the Cursor CVM ingress.
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

type LineChartMod = typeof import("@/components/charts/LineChart");

let cached: Promise<LineChartMod> | null = null;

export function loadLineChart(): Promise<LineChartMod> {
  if (cached) return cached;

  cached = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await import(
          /* webpackChunkName: "line-chart" */
          "@/components/charts/LineChart"
        );
      } catch (err) {
        lastError = err;
        cached = null;
        await sleep(250 * (attempt + 1));
      }
    }
    cached = null;
    if (isChunkLoadError(lastError)) {
      try {
        const key = "zgiis:line-chart-chunk-reload";
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

/** Fire-and-forget prefetch so the first visible graph does not wait on Chart.js. */
export function prefetchLineChart(): void {
  void loadLineChart().catch(() => null);
}
