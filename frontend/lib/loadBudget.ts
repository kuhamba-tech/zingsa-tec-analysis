/**
 * Device/network-aware scheduling for first paint.
 * Keeps critical metric fetches ahead of charts, maps, and secondary APIs.
 * Desktop and mobile both start light — heavy work warms after paint / on tab use.
 */

export type LoadProfile = {
  /** Phone, tablet, or a large-screen Android TV / leanback browser. */
  constrained: boolean;
  /** Android TV, Fire TV, or another 10-foot browser. Wide, but slow to parse JS. */
  tv: boolean;
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
  // Width only. A touchscreen laptop is still a laptop: coarse pointer must
  // not force the phone payload, poll interval, or deferred-lab button.
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

/**
 * Android TV, Fire TV, Google TV, and other leanback browsers.
 * The viewport is 1080p or 4K, so a width check treats them as desktops and
 * pulls Chart.js plus OpenLayers onto the first screen. The CPU is closer to a phone.
 */
export function isAndroidTvClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android TV|Google TV|Fire TV|BRAVIA|Leanback|\bAFT[A-Z0-9]+\b|SHIELD Android TV|MiBOX|Nexus Player/i.test(ua)) {
    return true;
  }
  if (typeof window.matchMedia !== "function") return false;
  // Remote-controlled large screen. Touchscreen laptops still report hover.
  return window.matchMedia("(min-width: 960px) and (pointer: coarse) and (hover: none)").matches;
}

/** SSR-safe profile — prefer light defaults so first HTML never assumes desktop fibre. */
export function getLoadProfile(): LoadProfile {
  if (typeof window === "undefined") {
    return {
      constrained: true,
      tv: false,
      slowNetwork: false,
      lightPayload: true,
      pollIntervalMs: 90_000,
      timelineMaxPoints: 48,
      heavyMountDelayMs: 400,
      deferSecondaryApis: true,
      stationsDeferMs: 600,
      defaultRangeHours: 6,
      vtecResampleMinutes: 10,
      vtecHoursCap: 18,
      chartMaxPoints: 64,
      chartAnimations: false,
    };
  }
  const constrained = isConstrainedViewport();
  const tv = isAndroidTvClient();
  const { saveData, slow } = connectionHints();
  const cursorPreview = isCursorCloudPreview();
  // Cursor CVM ingress + multi-MB webpack chunks: always start light even on
  // a wide desktop viewport so metric cards win over Chart.js / OpenLayers.
  // Android TV is wide too, but parsing those libraries stalls the first paint.
  const lightPayload = constrained || tv || saveData || slow || cursorPreview;
  const slowNetwork = saveData || slow || cursorPreview || tv;
  return {
    constrained: constrained || cursorPreview || tv,
    tv,
    slowNetwork,
    lightPayload,
    // Both desktop and mobile: longer polls reduce background contention.
    pollIntervalMs: slowNetwork ? 180_000 : constrained ? 120_000 : 60_000,
    timelineMaxPoints: tv ? 24 : slowNetwork ? 32 : constrained ? 48 : 96,
    // Cursor: short delay so shared Chart.js can prefetch, then graphs mount.
    heavyMountDelayMs: tv ? 1600 : cursorPreview ? 550 : slowNetwork ? 700 : constrained ? 280 : 80,
    // Always skip heliospheric/timeline warm on first paint — tabs warm on demand.
    deferSecondaryApis: true,
    // Station status is a live count, so it follows the metric cards closely.
    // The slower Gg comparison is scheduled separately and must not delay this.
    stationsDeferMs: tv ? 900 : cursorPreview ? 900 : slowNetwork ? 600 : constrained ? 220 : 60,
    // Short first window everywhere; users can expand to 24h / 3d.
    defaultRangeHours: 6,
    vtecResampleMinutes: slowNetwork ? 15 : constrained ? 10 : 5,
    vtecHoursCap: tv ? 6 : slowNetwork ? 12 : constrained ? 18 : 24,
    chartMaxPoints: tv ? 32 : cursorPreview ? 48 : slowNetwork ? 40 : constrained ? 64 : 120,
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
  // Cursor CVM: warm graph APIs sooner so charts are not starved after paint.
  const timeout = isCursorCloudPreview()
    ? 700
    : p.tv
      ? 5000
      : p.slowNetwork
        ? 4200
        : p.constrained
          ? 2600
          : 1100;
  return afterNextPaint(fn, timeout);
}

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}
