/**
 * Shared client API base + URL builder.
 * Used by api.ts, bootSpaceWeather, and the pre-React layout boot script
 * (logic mirrored in layout.tsx — keep behaviour identical).
 */

const GROUP_ROUTERS: [prefix: string, router: string][] = [
  ["/tec/", "/tec-router/"],
  ["/navigation-news", "/navigation-news-router/"],
  ["/cors/", "/cors-router/"],
  ["/space-weather/", "/space-weather-router/"],
  ["/processing/", "/processing-router/"],
  ["/live/", "/core-router/"],
  ["/forecast/", "/core-router/"],
  ["/reports/", "/core-router/"],
  ["/chat", "/core-router/"],
  ["/theory/", "/core-router/"],
  ["/gic/", "/core-router/"],
  ["/cosmic2/", "/core-router/"],
];

/** Resolve the browser API base (same rules for boot + api.ts). */
export function resolveClientApiBase(): string {
  if (typeof window === "undefined") {
    const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (configured) return configured;
    return "http://127.0.0.1:8000";
  }

  const { hostname, port, origin, protocol } = window.location;
  const safeHostname = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
  const hasNumericPort = typeof port === "string" && /^\d+$/.test(port);
  const safeOrigin = hasNumericPort ? `${protocol}//${safeHostname}:${port}` : `${protocol}//${safeHostname}`;
  const local =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "0.0.0.0";
  const vercelHost = hostname.includes("vercel.app") || hostname.includes("vercel.com");
  // Cursor Cloud Agent port forwards (p-<port>-pod-*.agent.cvm.dev) — use the
  // Next Route Handler proxy so authenticated document sessions keep working
  // when /backend rewrites are flaky through the ingress.
  const cursorCloudPreview =
    hostname.includes("agent.cvm.dev") ||
    hostname.endsWith(".cvm.dev") ||
    hostname.includes("cursorusercontent.com");

  if (cursorCloudPreview) {
    return `${origin}/api/zgiis`;
  }

  // Some port-forward / preview hosts expose a port like 0.13100. Treat that as invalid,
  // otherwise URLs become malformed (e.g. http://127.0.0.1:0.13100).
  if (!hasNumericPort && local) {
    return `${protocol}//127.0.0.1:8000`;
  }

  // Next dev / common frontend ports / Cursor port-forward previews — same-origin /backend.
  // Never fall through to /api on unknown tunnel hosts in development: that 404s and
  // leaves Live Metric stuck on Connecting / Updating….
  if (
    process.env.NODE_ENV === "development" ||
    port === "3000" ||
    port === "3001" ||
    port === "3100" ||
    port === "43128"
  ) {
    const devOrigin = hasNumericPort ? safeOrigin : `${protocol}//127.0.0.1:3100`;
    return `${devOrigin}/backend`;
  }
  if (local) {
    // Frontend served from uvicorn static export on :8000
    if (port === "8000") return safeOrigin;
    return `${protocol}//127.0.0.1:8000`;
  }
  // Non-Vercel remote previews still go through the Next /backend rewrite when present.
  if (!vercelHost) {
    return `${safeOrigin}/backend`;
  }
  // Vercel/static export — backend via /api (+ group routers).
  return `${safeOrigin}/api`;
}

/**
 * Build a full request URL for a backend path (e.g. `/space-weather/current`).
 * Applies Vercel group-router rewrite and strips trailing slashes for FastAPI.
 */
export function resolveClientApiUrl(path: string): string {
  const base = resolveClientApiBase().replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  let url = `${base}${normalized}`;

  if (base.endsWith("/api")) {
    for (const [prefix, router] of GROUP_ROUTERS) {
      if (normalized === prefix || normalized.startsWith(prefix)) {
        url = `${base}${router}?__zr=${encodeURIComponent(normalized)}`;
        break;
      }
    }
  }

  // FastAPI routes have no trailing slash — strip except bare base.
  const q = url.indexOf("?");
  const pathPart = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? "" : url.slice(q);
  if (
    pathPart.endsWith("/") &&
    pathPart !== `${base}/` &&
    pathPart !== base &&
    !pathPart.endsWith("-router/")
  ) {
    url = `${pathPart.replace(/\/+$/, "")}${query}`;
  }
  return url;
}

/** Tiny shared clock so boot + getSpaceWeather share “recently fetched”. */
let lastSpaceWeatherNetworkAt = 0;

export function noteSpaceWeatherNetworkOk(at = Date.now()): void {
  lastSpaceWeatherNetworkAt = at;
}

export function getSpaceWeatherNetworkAt(): number {
  return lastSpaceWeatherNetworkAt;
}

export function spaceWeatherFetchedRecently(maxAgeMs = 20_000): boolean {
  return Date.now() - lastSpaceWeatherNetworkAt < maxAgeMs;
}
