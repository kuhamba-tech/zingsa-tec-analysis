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
  /** Extra delay before mounting heavy below-fold labs (ms). */
  heavyMountDelayMs: number;
  /** Skip warming heliospheric / timeline APIs on first paint. */
  deferSecondaryApis: boolean;
  /** Delay before fetching full station catalog (ms). */
  stationsDeferMs: number;
  /** Default shared timeline window for local/driver stacks (hours). */
  defaultRangeHours: 6 | 24 | 72;
  /** SQL resample minutes for live VTEC-by-station. */
  vtecResampleMinutes: number;
  /** Cap VTEC history hours on first local fetch. */
  vtecHoursCap: number;
  /** Max drawn points per LineChart series (stride-downsample above this). */
  chartMaxPoints: number;
  /** Chart.js draw animations — off on phones / slow links for snappier graphs. */
  chartAnimations: boolean;
};

function connectionHints(): { saveData: boolean; slow: boolean } {
  if (typeof navigator === "undefined") return { saveData: false, slow: false };
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
    }
  ).connection;
  const effective = String(conn?.effectiveType || "").toLowerCase();
  const slow =
    effective === "slow-2g" ||
    effective === "2g" ||
    effective === "3g" ||
    (typeof conn?.downlink === "number" && conn.downlink > 0 && conn.downlink < 1.2);
  return { saveData: Boolean(conn?.saveData), slow };
}

function isConstrainedViewport(): boolean {
  if (typeof window === "undefined") return false;
  const narrow =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return narrow || coarse;
}

/** SSR-safe profile — prefer light defaults so first HTML never assumes desktop fibre. */
export function getLoadProfile(): LoadProfile {
  if (typeof window === "undefined") {
    return {
      constrained: true,
      slowNetwork: false,
      lightPayload: true,
      pollIntervalMs: 90_000,
      timelineMaxPoints: 72,
      heavyMountDelayMs: 1200,
      deferSecondaryApis: true,
      stationsDeferMs: 1600,
      defaultRangeHours: 6,
      vtecResampleMinutes: 10,
      vtecHoursCap: 24,
      chartMaxPoints: 72,
      chartAnimations: false,
    };
  }
  const constrained = isConstrainedViewport();
  const { saveData, slow } = connectionHints();
  const lightPayload = constrained || saveData || slow;
  return {
    constrained,
    slowNetwork: saveData || slow,
    lightPayload,
    pollIntervalMs: saveData || slow ? 150_000 : constrained ? 100_000 : 45_000,
    timelineMaxPoints: saveData || slow ? 36 : constrained ? 48 : 120,
    heavyMountDelayMs: saveData || slow ? 2800 : constrained ? 1800 : 400,
    deferSecondaryApis: lightPayload,
    stationsDeferMs: saveData || slow ? 3200 : constrained ? 2000 : 300,
    defaultRangeHours: lightPayload ? 6 : 24,
    vtecResampleMinutes: saveData || slow ? 15 : constrained ? 10 : 2,
    vtecHoursCap: saveData || slow ? 12 : constrained ? 24 : 48,
    chartMaxPoints: saveData || slow ? 48 : constrained ? 72 : 160,
    // Animations cost a full extra paint pass per chart — keep off unless desktop fibre.
    chartAnimations: !lightPayload && !slow && !saveData,
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
  const timeout = p.slowNetwork ? 4000 : p.constrained ? 2400 : 800;
  return afterNextPaint(fn, timeout);
}

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}
