/**
 * Device/network-aware scheduling for first paint.
 * Keeps critical metric fetches ahead of charts, maps, and secondary APIs.
 * Desktop and mobile both start light — heavy work warms after paint / on tab use.
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
  /** Chart.js draw animations — off for snappier graphs on all devices. */
  chartAnimations: boolean;
};

/** Cursor Cloud Agent port-forward previews pay a large JS tax over the ingress. */
export function isCursorCloudPreview(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname || "";
  return (
    host.includes("agent.cvm.dev") ||
    host.endsWith(".cvm.dev") ||
    host.includes("cursorusercontent.com")
  );
}

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
      timelineMaxPoints: 40,
      heavyMountDelayMs: 0,
      deferSecondaryApis: false,
      stationsDeferMs: 350,
      defaultRangeHours: 6,
      vtecResampleMinutes: 10,
      vtecHoursCap: 12,
      chartMaxPoints: 48,
      chartAnimations: false,
    };
  }
  const constrained = isConstrainedViewport();
  const { saveData, slow } = connectionHints();
  const cursorPreview = isCursorCloudPreview();
  // Cursor CVM ingress + multi-MB webpack chunks: always start light even on
  // a wide desktop viewport so metric cards win over Chart.js / OpenLayers.
  const lightPayload = constrained || saveData || slow || cursorPreview;
  const slowNetwork = saveData || slow || cursorPreview;
  return {
    constrained: constrained || cursorPreview,
    slowNetwork,
    lightPayload,
    // Longer polls free bandwidth for interactive graph refreshes.
    pollIntervalMs: slowNetwork ? 240_000 : constrained ? 150_000 : 90_000,
    timelineMaxPoints: slowNetwork ? 28 : constrained ? 40 : 72,
    // Live Metric graphs mount without artificial delay — data is already warming.
    heavyMountDelayMs: 0,
    deferSecondaryApis: false,
    stationsDeferMs: cursorPreview ? 500 : slowNetwork ? 800 : constrained ? 450 : 150,
    defaultRangeHours: 6,
    vtecResampleMinutes: slowNetwork ? 15 : constrained ? 10 : 5,
    vtecHoursCap: slowNetwork ? 6 : constrained ? 12 : 18,
    chartMaxPoints: cursorPreview ? 40 : slowNetwork ? 36 : constrained ? 56 : 96,
    chartAnimations: false,
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
  // Run almost immediately after paint — graphs need JSON ASAP.
  const timeout = isCursorCloudPreview()
    ? 0
    : p.slowNetwork
      ? 600
      : p.constrained
        ? 200
        : 0;
  return afterNextPaint(fn, timeout);
}

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}
