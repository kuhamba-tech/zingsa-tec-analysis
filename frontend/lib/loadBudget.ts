/**
 * Device/network-aware scheduling for first paint.
 * Keeps critical metric fetches ahead of charts, maps, and secondary APIs.
 */

export type LoadProfile = {
  /** Narrow viewport or coarse pointer — treat as phone/tablet. */
  constrained: boolean;
  /** Navigator reports Save-Data or slow effective connection. */
  slowNetwork: boolean;
  /** Prefer smaller timeline payloads and longer poll intervals. */
  lightPayload: boolean;
  /** Poll interval for background refreshes (ms). */
  pollIntervalMs: number;
  /** Max points for /space-weather/timelines. */
  timelineMaxPoints: number;
};

function connectionHints(): { saveData: boolean; slow: boolean } {
  if (typeof navigator === "undefined") return { saveData: false, slow: false };
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  const effective = String(conn?.effectiveType || "").toLowerCase();
  const slow = effective === "slow-2g" || effective === "2g" || effective === "3g";
  return { saveData: Boolean(conn?.saveData), slow };
}

export function getLoadProfile(): LoadProfile {
  if (typeof window === "undefined") {
    return {
      constrained: false,
      slowNetwork: false,
      lightPayload: false,
      pollIntervalMs: 45_000,
      timelineMaxPoints: 168,
    };
  }
  const narrow =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches;
  const { saveData, slow } = connectionHints();
  const lightPayload = narrow || saveData || slow;
  return {
    constrained: narrow,
    slowNetwork: saveData || slow,
    lightPayload,
    pollIntervalMs: saveData || slow ? 90_000 : narrow ? 60_000 : 45_000,
    timelineMaxPoints: lightPayload ? 96 : 168,
  };
}

/** Run after the next paint (or ~timeoutMs if rAF unavailable). */
export function afterNextPaint(fn: () => void, timeoutMs = 48): () => void {
  if (typeof window === "undefined") {
    fn();
    return () => undefined;
  }
  let cancelled = false;
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;
  const run = () => {
    if (cancelled) return;
    fn();
  };
  const kick = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(() => run(), { timeout: timeoutMs });
    } else {
      timeoutHandle = window.setTimeout(run, timeoutMs) as unknown as number;
    }
  };
  const raf =
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => kick())
      : null;
  if (raf == null) kick();
  return () => {
    cancelled = true;
    if (raf != null) window.cancelAnimationFrame(raf);
    if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
    }
    if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
  };
}

/** Defer non-critical work; waits longer on constrained/slow clients. */
export function scheduleSecondary(fn: () => void, profile?: LoadProfile): () => void {
  const p = profile ?? getLoadProfile();
  const timeout = p.lightPayload ? 2200 : 900;
  return afterNextPaint(fn, timeout);
}

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}
