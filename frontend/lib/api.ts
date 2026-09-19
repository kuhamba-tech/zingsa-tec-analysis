import type {
  ArchiveMeta,
  AnomalyAnalysisResponse,
  AnomalyDay,
  AudienceId,
  BiasRow,
  CelestrakAnalysisResponse,
  ChatMessage,
  ChatResponse,
  CorsHealth,
  Cosmic2AnalysisResponse,
  DidbaseIonosondeResponse,
  DiurnalPoint,
  EkfAlert,
  EkfStatus,
  ForecastPoint,
  ForecastStatus,
  CnnGruTrainStatus,
  GicLiveModel,
  GicNetwork,
  GicReport,
  GicReportPeriod,
  GicSeriesResponse,
  GicStatusResponse,
  GicUploadResult,
  GfzKpAnalysisResponse,
  GuviOn2Response,
  WdcKyotoAnalysisResponse,
  IntermagnetAnalysisResponse,
  LiveObservation,
  LivePipelineStatus,
  LiveVtecHealth,
  LiveStationVtecSeries,
  TecMethodComparisonResponse,
  GlobalTecByStationResponse,
  NavigationNewsBriefApi,
  NavigationNewsBundleApi,
  NavigationNewsScheduleApi,
  BroadcastRecipient,
  BroadcastRecipientCreate,
  NavigationBroadcastOverview,
  NavigationBroadcastRunResult,
  NavigationBroadcastStatus,
  NavigationFacebookPostResult,
  NavigationFacebookStatus,
  NtripProbeResponse,
  OmniAnalysisResponse,
  PrnExplorerResponse,
  PrnConstellationPayload,
  PrnRow,
  ProcessingOptions,
  ProcessingSession,
  RinexConvertConfig,
  SeasonalRow,
  SolarActivityFull,
  SolarCycleIndicesResponse,
  HeliosphericMonitorResponse,
  SolarCycleRow,
  SpaceWeatherCurrent,
  SpaceWeatherCorrelationResponse,
  SpaceWeatherHistoryResponse,
  SpaceWeatherLogStatus,
  SpaceWeatherReport,
  SpaceWeatherReportPeriod,
  SpaceWeatherTimelines,
  StormAlertStatus,
  Station,
  StationLiveStatus,
  StationStatusEvent,
  StationStatusLogStatus,
  StationUptimeAnalysis,
  StationUptimeRow,
  StationUptimeTimelinePoint,
  RoverClientsSnapshot,
  TecHeatmapResponse,
  TecObservation,
  TecSummaryRow,
  TecHourlyRow,
  TecPlotSeries,
  VtecTheoryPayload,
  GeomagneticTheoryPayload,
  UnderstandingTecPayload,
} from "./types";
import { peekSpaceWeather, publishSpaceWeather } from "./spaceWeatherStore";
import { peekSolarActivity, publishSolarActivity } from "./solarActivityStore";
import { peekHeliosphericMonitor, rememberHeliosphericMonitor } from "./heliosphericStore";
import { peekStations, publishStations, purgeStaleStationsCache, stationsAreSpiderAuthoritative } from "./stationsStore";
import {
  getSpaceWeatherNetworkAt,
  noteSpaceWeatherNetworkOk,
  resolveClientApiBase,
  resolveClientApiUrl,
  spaceWeatherFetchedRecently,
} from "./clientApiBase";

function apiBase(): string {
  return resolveClientApiBase();
}

const KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";
const FETCH_TIMEOUT_MS = 18_000;
const ANALYSIS_TIMEOUT_MS = 120_000;
const SW_FAST_TIMEOUT_MS = 8_000;
/** Solar monitor hits NOAA + NASA DONKI; allow cold-start headroom + one retry. */
const SOLAR_TIMEOUT_MS = 55_000;
const HELIO_TIMEOUT_MS = 45_000;
const REPORT_TIMEOUT_MS = 60_000;
const LIVE_REFRESH_MIN_MS = 20_000;
/** Short gap before one retry — long delays hurt first paint on mobile. */
const RETRY_GAP_MS = 280;

let lastSolarNetworkAt = 0;
let lastHelioNetworkAt = 0;
let lastStationsNetworkAt = 0;

const inflightGets = new Map<string, Promise<unknown>>();

function dedupeGet<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightGets.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fn().finally(() => {
    inflightGets.delete(key);
  });
  inflightGets.set(key, pending);
  return pending;
}

export function getCachedSpaceWeather(): SpaceWeatherCurrent | null {
  return peekSpaceWeather();
}

export function rememberSpaceWeather(data: SpaceWeatherCurrent): SpaceWeatherCurrent {
  return publishSpaceWeather(data);
}

function baseUrl(): string {
  return apiBase();
}

/** Builds the full request URL for `path` (shared with boot via clientApiBase). */
function apiUrl(path: string): string {
  return resolveClientApiUrl(path);
}

function friendlyFetchError(err: unknown, path: string): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error(
      `API ${path} timed out — ensure the FastAPI backend is running on port 8000 (run dev.ps1)`,
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("aborted") || msg.includes("AbortError")) {
    return new Error(
      `API ${path} timed out — ensure the FastAPI backend is running on port 8000 (run dev.ps1)`,
    );
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return new Error(`API ${path} unreachable — start the backend with dev.ps1`);
  }
  return err instanceof Error ? err : new Error(msg);
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    throw friendlyFetchError(err, url);
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  const url = new URL(apiUrl(path));
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }
  try {
    const res = await fetchWithTimeout(
      url.toString(),
      { headers: KEY ? { "X-API-Key": KEY } : {} },
      timeoutMs,
    );
    if (!res.ok) {
      throw new Error(`API ${path} → ${res.status} (${url.origin})`);
    }
    return res.json();
  } catch (err) {
    throw friendlyFetchError(err, path);
  }
}

/** GET with one retry — helps Vercel cold starts on the home page. */
export async function getWithRetry<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  try {
    return await get<T>(path, params, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Do not burn another full timeout on hard 4xx (except transient 408/429).
    if (/→\s*(401|403|404|405|410)\b/.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, RETRY_GAP_MS));
    return get<T>(path, params, timeoutMs);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(KEY ? { "X-API-Key": KEY } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`);
  return res.json();
}

// ── Space Weather ─────────────────────────────────────────────────────────────
function refreshSpaceWeatherNetwork(): Promise<SpaceWeatherCurrent> {
  return dedupeGet("space-weather/current", () => {
    const hasCache = Boolean(peekSpaceWeather());
    const timeoutMs = hasCache ? SW_FAST_TIMEOUT_MS : FETCH_TIMEOUT_MS;
    return getWithRetry<SpaceWeatherCurrent>(
      "/space-weather/current",
      { _ts: Date.now() },
      timeoutMs,
    )
      .then((data) => {
        noteSpaceWeatherNetworkOk();
        return publishSpaceWeather(data);
      })
      .catch((err) => {
        const cached = peekSpaceWeather();
        if (cached) return cached;
        throw err;
      });
  });
}

/** Instant last-good snapshot when available; network refresh stays in the background. */
export const getSpaceWeather = (requireNetwork = false) => {
  if (requireNetwork) {
    return dedupeGet("space-weather/current:verified", () =>
      getWithRetry<SpaceWeatherCurrent>("/space-weather/current", { _ts: Date.now() })
        .then((data) => {
          noteSpaceWeatherNetworkOk();
          return publishSpaceWeather(data);
        }),
    );
  }
  const cached = peekSpaceWeather();
  const recentlyFetched =
    spaceWeatherFetchedRecently(LIVE_REFRESH_MIN_MS) ||
    (cached != null && Date.now() - getSpaceWeatherNetworkAt() < LIVE_REFRESH_MIN_MS);
  if (cached && recentlyFetched) return Promise.resolve(cached);
  const pending = refreshSpaceWeatherNetwork();
  if (cached) {
    void pending;
    return Promise.resolve(cached);
  }
  return pending;
};
export const getSolarActivity = (forceRefresh = false, requireNetwork = false) => {
  const cached = peekSolarActivity();
  if (!forceRefresh && !requireNetwork && cached) {
    const recentlyFetched = Date.now() - lastSolarNetworkAt < LIVE_REFRESH_MIN_MS;
    if (recentlyFetched) return Promise.resolve(cached);
    const pending = dedupeGet("space-weather/solar-activity", () =>
      getWithRetry<SolarActivityFull>(
        "/space-weather/solar-activity",
        { _ts: Date.now() },
        SW_FAST_TIMEOUT_MS,
      )
        .then((data) => {
          lastSolarNetworkAt = Date.now();
          return publishSolarActivity(data);
        })
        .catch(() => cached),
    );
    void pending;
    return Promise.resolve(cached);
  }

  return dedupeGet(`space-weather/solar-activity${forceRefresh ? ":refresh" : ""}${requireNetwork ? ":verified" : ""}`, () =>
    getWithRetry<SolarActivityFull>(
      "/space-weather/solar-activity",
      { _ts: Date.now(), ...(forceRefresh ? { force_refresh: "true" } : {}) },
      forceRefresh ? SOLAR_TIMEOUT_MS : cached ? SW_FAST_TIMEOUT_MS : SOLAR_TIMEOUT_MS,
    )
      .then((data) => {
        lastSolarNetworkAt = Date.now();
        return publishSolarActivity(data);
      })
      .catch((err) => {
        if (requireNetwork) throw err;
        const fallback = peekSolarActivity();
        if (fallback) return fallback;
        throw err;
      }),
  );
};

export const getSolarCycleIndices = (startYear = 1965, forceRefresh = false) =>
  dedupeGet(`space-weather/solar-cycle-indices:${startYear}${forceRefresh ? ":refresh" : ""}`, () =>
    get<SolarCycleIndicesResponse>(
      "/space-weather/solar-cycle-indices",
      {
        start_year: startYear,
        _ts: Date.now(),
        ...(forceRefresh ? { force_refresh: "true" } : {}),
      },
      ANALYSIS_TIMEOUT_MS,
    ),
  );

export const getHeliosphericMonitor = (forceRefresh = false, requireNetwork = false) => {
  const cached = peekHeliosphericMonitor();
  if (!forceRefresh && !requireNetwork && cached) {
    const recentlyFetched = Date.now() - lastHelioNetworkAt < LIVE_REFRESH_MIN_MS;
    if (recentlyFetched) return Promise.resolve(cached);
    const pending = dedupeGet("space-weather/heliospheric-monitor", () =>
      get<HeliosphericMonitorResponse>(
        "/space-weather/heliospheric-monitor",
        { _ts: Date.now() },
        HELIO_TIMEOUT_MS,
      )
        .then((data) => {
          lastHelioNetworkAt = Date.now();
          return rememberHeliosphericMonitor(data);
        })
        .catch(() => cached),
    );
    void pending;
    return Promise.resolve(cached);
  }

  return dedupeGet(`space-weather/heliospheric-monitor${forceRefresh ? ":refresh" : ""}${requireNetwork ? ":verified" : ""}`, () =>
    get<HeliosphericMonitorResponse>(
      "/space-weather/heliospheric-monitor",
      {
        _ts: Date.now(),
        ...(forceRefresh ? { force_refresh: "true" } : {}),
      },
      HELIO_TIMEOUT_MS,
    )
      .then((data) => {
        lastHelioNetworkAt = Date.now();
        return rememberHeliosphericMonitor(data);
      })
      .catch((err) => {
        if (requireNetwork) throw err;
        const fallback = peekHeliosphericMonitor();
        if (fallback) return fallback;
        throw err;
      }),
  );
};
export const getTimelines = (maxPoints = 168) => {
  const capped = Math.max(24, Math.min(2000, Math.round(maxPoints)));
  return dedupeGet(`space-weather/timelines:${capped}`, () =>
    getWithRetry<SpaceWeatherTimelines>("/space-weather/timelines", {
      max_points: capped,
      _ts: Date.now(),
    }),
  );
};
export const refreshSpaceWeather = () =>
  fetch(apiUrl("/space-weather/refresh"), { method: "POST", headers: KEY ? { "X-API-Key": KEY } : {} });
export const getSpaceWeatherLogStatus = () => get<SpaceWeatherLogStatus>("/space-weather/log/status");
export const getSpaceWeatherHistory = (hours = 168, resample?: string) =>
  get<SpaceWeatherHistoryResponse>("/space-weather/history", { hours, resample });
export const getSpaceWeatherCorrelations = (hours = 168, resample = "1h") =>
  get<SpaceWeatherCorrelationResponse>("/space-weather/correlations", { hours, resample });
export const getSpaceWeatherReport = (period: SpaceWeatherReportPeriod = "hourly") =>
  getWithRetry<SpaceWeatherReport>(
    "/space-weather/report",
    { period, _ts: Date.now() },
    REPORT_TIMEOUT_MS,
  );
export const getEkfStatus = () => get<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
/** Retried EKF fetch — use on manual refresh only; avoid blocking the 60s poll. */
export const getEkfStatusWithRetry = () =>
  getWithRetry<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
export const getStormAlertStatus = () => get<StormAlertStatus>("/space-weather/storm-alerts/status");
export const getEkfAlertLog = (hours = 24) => get<EkfAlert[]>("/space-weather/ekf/alerts", { hours });
export const ackEkfAlert = (alertId: string) =>
  fetch(apiUrl(`/space-weather/ekf/alerts/${alertId}/ack`), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
  });

// ── Navigation News (broadcast agent) ───────────────────────────────────────────
export const getNavigationNews = (
  audience?: AudienceId,
  refreshNtrip = false,
  force = false,
) =>
  getWithRetry<NavigationNewsBundleApi>("/navigation-news", {
    _ts: Date.now(),
    ...(audience ? { audience } : {}),
    ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
    ...(force ? { force: "true" } : {}),
  });

export const getNavigationNewsSchedule = () =>
  getWithRetry<NavigationNewsScheduleApi>("/navigation-news/schedule", { _ts: Date.now() });

export const getNavigationNewsBrief = (audience: AudienceId, refreshNtrip = false, force = false) =>
  getWithRetry<NavigationNewsBriefApi>(`/navigation-news/briefs/${audience}`, {
    _ts: Date.now(),
    ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
    ...(force ? { force: "true" } : {}),
  });

export const getBroadcastRecipients = async (): Promise<BroadcastRecipient[]> => {
  const paths = ["/navigation-news/broadcast/overview", "/navigation-news/recipients", "/navigation-news/broadcast/recipients"];
  for (const path of paths) {
    try {
      if (path.endsWith("/overview")) {
        const overview = await get<NavigationBroadcastOverview>(path, { _ts: Date.now() });
        return overview.recipients;
      }
      return await get<BroadcastRecipient[]>(path, { _ts: Date.now() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("404")) throw e;
    }
  }
  throw new Error(`API /navigation-news/recipients → 404 (${baseUrl()}) — restart backend with dev.ps1`);
};

export const getBroadcastOverview = () =>
  getWithRetry<NavigationBroadcastOverview>("/navigation-news/broadcast/overview", { _ts: Date.now() });

export const createBroadcastRecipient = (body: BroadcastRecipientCreate) =>
  post<BroadcastRecipient>("/navigation-news/recipients", body);

export const updateBroadcastRecipient = (
  recipientId: string,
  body: Partial<BroadcastRecipientCreate> & { active?: boolean },
) =>
  fetch(apiUrl(`/navigation-news/recipients/${recipientId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(KEY ? { "X-API-Key": KEY } : {}) },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API PATCH /navigation-news/recipients → ${res.status}`);
    return res.json() as Promise<BroadcastRecipient>;
  });

export const deleteBroadcastRecipient = (recipientId: string) =>
  fetch(apiUrl(`/navigation-news/recipients/${recipientId}`), {
    method: "DELETE",
    headers: KEY ? { "X-API-Key": KEY } : {},
  }).then((res) => {
    if (!res.ok) throw new Error(`API DELETE /navigation-news/recipients → ${res.status}`);
  });

export const getNavigationBroadcastStatus = async (): Promise<NavigationBroadcastStatus> => {
  try {
    return await getWithRetry<NavigationBroadcastStatus>("/navigation-news/broadcast/status");
  } catch (primary) {
    try {
      const overview = await getWithRetry<NavigationBroadcastOverview>("/navigation-news/broadcast/overview");
      return overview.status;
    } catch {
      throw primary;
    }
  }
};

export const getNavigationFacebookStatus = async (): Promise<NavigationFacebookStatus> => {
  const paths = [
    "/navigation-news/facebook/status",
    "/navigation-news/broadcast/facebook/status",
  ];
  let lastError = "Facebook status unavailable";
  for (const path of paths) {
    try {
      return await getWithRetry<NavigationFacebookStatus>(path);
    } catch (e) {
      lastError = e instanceof Error ? e.message : lastError;
      if (!lastError.includes("404")) throw e;
    }
  }
  throw new Error(lastError);
};

export const sendNavigationWhatsApp = async (live = false): Promise<NavigationBroadcastRunResult> => {
  const res = await fetch(
    apiUrl(`/navigation-news/broadcast/whatsapp/send?live=${live ? "true" : "false"}`),
    {
      method: "POST",
      headers: KEY ? { "X-API-Key": KEY } : {},
    },
  );
  if (!res.ok) {
    const detail = res.status === 403
      ? "Broadcast admin key required for live sends — set BROADCAST_ADMIN_KEY on the server."
      : `API POST /navigation-news/broadcast/whatsapp/send → ${res.status}`;
    throw new Error(detail);
  }
  return res.json() as Promise<NavigationBroadcastRunResult>;
};

export const runNavigationBroadcast = () =>
  fetch(apiUrl("/navigation-news/broadcast/run"), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API POST /navigation-news/broadcast/run → ${res.status}`);
    return res.json();
  });

export const testNavigationFacebookPost = async (live = false): Promise<NavigationFacebookPostResult> => {
  const paths = [
    `/navigation-news/facebook/test-post?live=${live ? "true" : "false"}`,
    `/navigation-news/broadcast/facebook/test-post?live=${live ? "true" : "false"}`,
  ];
  let lastError = "Facebook test post failed";
  for (const path of paths) {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: KEY ? { "X-API-Key": KEY } : {},
    });
    if (res.ok) {
      return res.json() as Promise<NavigationFacebookPostResult>;
    }
    lastError = `API POST ${path.split("?")[0]} → ${res.status}`;
    if (res.status !== 404) break;
  }
  throw new Error(lastError);
};

// ── CORS Network ──────────────────────────────────────────────────────────────
// A live refresh_ntrip=true probe of all 25 mountpoints from a Vercel
// serverless function genuinely takes ~45s (measured) -- well over the
// default 28s fetch timeout, so it was aborting (then retrying and
// aborting again) before ever completing, leaving the dashboard stuck on
// "Probing..." with a stale 0/25 reading. Give the live-probe call enough
// room; the default (archived-status) call keeps the normal fast timeout.
const NTRIP_LIVE_PROBE_TIMEOUT_MS = 90_000;
/** Cached stations are SWR from Spider — keep this short so a hung API never stalls the UI. */
const SPIDER_STATIONS_TIMEOUT_MS = 12_000;

function refreshStationsNetwork(refreshNtrip: boolean): Promise<Station[]> {
  return dedupeGet(`cors/stations:${refreshNtrip ? "live" : "cached"}`, () =>
    getWithRetry<Station[]>(
      "/cors/stations",
      {
        _ts: Date.now(),
        ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
      },
      refreshNtrip ? NTRIP_LIVE_PROBE_TIMEOUT_MS : SPIDER_STATIONS_TIMEOUT_MS,
    )
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) {
          const published = publishStations(rows);
          // Only treat Spider Site Status as a successful live fetch.
          if (stationsAreSpiderAuthoritative(published.length ? published : rows)) {
            lastStationsNetworkAt = Date.now();
          }
          return Array.isArray(published) && published.length > 0 ? published : rows;
        }
        // An empty live response must clear the last in-memory snapshot. Old
        // station rows are more dangerous than an explicit unavailable state.
        purgeStaleStationsCache();
        return rows;
      })
      .catch((err) => {
        // Keep last Spider-authoritative snapshot on transient network failure.
        const cached = peekStations();
        if (cached.length > 0 && stationsAreSpiderAuthoritative(cached)) {
          return cached;
        }
        purgeStaleStationsCache();
        throw err;
      }),
  );
}

/**
 * Instant in-memory Spider snapshot when available; network refresh stays in
 * the background. Never seeds from localStorage catalog greens/reds.
 */
export const getStations = (refreshNtrip = false) => {
  // Drop leftover localStorage catalog snapshots from older deploys (once per tab).
  if (typeof window !== "undefined" && !(window as Window & { __zgiisStationsPurged?: boolean }).__zgiisStationsPurged) {
    purgeStaleStationsCache();
    (window as Window & { __zgiisStationsPurged?: boolean }).__zgiisStationsPurged = true;
  }
  const cached = peekStations();
  const recentlyFetched = Date.now() - lastStationsNetworkAt < LIVE_REFRESH_MIN_MS;
  if (!refreshNtrip && cached.length > 0 && stationsAreSpiderAuthoritative(cached)) {
    if (recentlyFetched) return Promise.resolve(cached);
    const pending = refreshStationsNetwork(false);
    void pending;
    return Promise.resolve(cached);
  }
  return refreshStationsNetwork(refreshNtrip);
};
export const getStation = (code: string) => get<Station>(`/cors/stations/${code}`);
export const getCorsHealth = () => get<CorsHealth>("/cors/health");
export const getRoverClients = (refresh = false) =>
  get<RoverClientsSnapshot>("/cors/rover-clients", {
    ...(refresh ? { refresh: "true" } : {}),
    _ts: Date.now(),
  });
export const getStationStatusLog = () => get<StationStatusLogStatus>("/cors/status/log");
export const getStationStatusEvents = (hours = 168, station?: string, event_type?: string) =>
  get<StationStatusEvent[]>("/cors/status/events", { hours, station, event_type });
export const getStationUptime = (hours = 168, station?: string) =>
  get<StationUptimeRow[]>("/cors/status/uptime", { hours, station });
export const getStationUptimeTimeline = (
  hours = 168,
  station?: string,
  bucket_minutes?: number,
) =>
  get<StationUptimeTimelinePoint[]>("/cors/status/timeline", {
    hours,
    station,
    bucket_minutes,
  });
export const getStationUptimeAnalysis = (
  hours = 168,
  station?: string,
  bucket_minutes?: number,
) =>
  get<StationUptimeAnalysis>("/cors/status/analysis", {
    hours,
    station,
    bucket_minutes,
  });

// ── Processing ────────────────────────────────────────────────────────────────
function appendProcessingOptions(fd: FormData, opts?: ProcessingOptions) {
  if (!opts) return;
  if (opts.elevationMin !== undefined) fd.append("elevation_min", String(opts.elevationMin));
  if (opts.ippHeight !== undefined) fd.append("ipp_height", String(opts.ippHeight));
  if (opts.dcbFolder !== undefined) fd.append("dcb_folder", opts.dcbFolder);
  if (opts.stations !== undefined) fd.append("stations", opts.stations.join(","));
  if (opts.kpCsv !== undefined) fd.append("kp_csv", opts.kpCsv);
}

export async function uploadCmn(file: File, opts?: ProcessingOptions): Promise<ProcessingSession> {
  const fd = new FormData();
  fd.append("file", file);
  appendProcessingOptions(fd, opts);
  const res = await fetch(apiUrl("/processing/cmn"), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadRinex(obs: File[], nav: File[], opts?: ProcessingOptions): Promise<ProcessingSession> {
  const fd = new FormData();
  obs.forEach((f) => fd.append("obs", f));
  nav.forEach((f) => fd.append("nav", f));
  appendProcessingOptions(fd, opts);
  const path = "/processing/rinex";
  const res = await fetchWithTimeout(apiUrl(path), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  }, 120_000);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d) => d.msg ?? String(d)).join("; ");
    } catch {
      /* use raw text */
    }
    throw new Error(msg || `API ${path} -> ${res.status}`);
  }
  return res.json();
}

export async function convertRinex(files: File[], config: RinexConvertConfig): Promise<Blob> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  fd.append("config", JSON.stringify(config));
  const res = await fetchWithTimeout(apiUrl("/processing/rinex-convert"), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  }, 120_000);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d) => d.msg ?? String(d)).join("; ");
    } catch {
      /* use raw text */
    }
    throw new Error(msg || `RINEX convert failed (${res.status})`);
  }
  return res.blob();
}

export type RinexArchiveStatus = {
  archive_root: string | null;
  archive_exists: boolean;
  url_template_configured: boolean;
  brdc_nav: boolean;
  message: string | null;
  stations?: Array<{ code: string; name: string; mountpoint: string }>;
};

export type RinexArchiveAvailability = {
  ok: boolean;
  message: string | null;
  archive_configured: boolean;
  url_configured: boolean;
  brdc_nav_available: boolean;
  coverage_pct?: number;
  period_days?: number;
  station_rows?: Array<{
    code: string;
    name: string;
    mountpoint: string;
    days_available: number;
    days_requested: number;
    obs_files: number;
    availability_pct: number;
  }>;
  files?: unknown[];
};

export const getRinexArchiveStatus = () => get<RinexArchiveStatus>("/processing/rinex-archive/status");

export const getRinexArchiveAvailability = (opts: {
  stations: string[];
  start: string;
  end: string;
  includeNav?: boolean;
}) =>
  get<RinexArchiveAvailability>("/processing/rinex-archive/availability", {
    stations: opts.stations.join(","),
    start: opts.start,
    end: opts.end,
    include_nav: opts.includeNav === false ? "false" : "true",
  });

export async function downloadRinexArchive(body: {
  stations: string[];
  start: string;
  end: string;
  include_nav?: boolean;
  include_brdc_nav?: boolean;
}): Promise<Blob> {
  const res = await fetchWithTimeout(
    apiUrl("/processing/rinex-archive/download"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(KEY ? { "X-API-Key": KEY } : {}),
      },
      body: JSON.stringify({
        stations: body.stations,
        start: body.start,
        end: body.end,
        include_nav: body.include_nav ?? true,
        include_brdc_nav: body.include_brdc_nav ?? true,
      }),
    },
    180_000,
  );
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: string };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* raw */
    }
    throw new Error(msg || `RINEX download failed (${res.status})`);
  }
  return res.blob();
}

export const getSessionStatus = (id: string) => get<ProcessingSession>(`/processing/${id}/status`);

export const getSessionSummary = (id: string, mode: "daily" | "monthly" | "yearly" = "daily") =>
  get<TecSummaryRow[]>(`/processing/${id}/summary`, { mode });

export const getSessionHourly = (id: string) => get<TecHourlyRow[]>(`/processing/${id}/hourly`);

export const getSessionTecPlot = (id: string, raw = false) =>
  get<TecPlotSeries>(`/processing/${id}/tec-plot`, { raw: raw ? 1 : 0 });

export const getSessionBias = (id: string) => get<BiasRow[]>(`/processing/${id}/bias`);

export async function downloadSessionRaw(id: string): Promise<Blob> {
  const res = await fetch(apiUrl(`/processing/${id}/raw`), {
    headers: KEY ? { "X-API-Key": KEY } : {},
  });
  if (!res.ok) throw new Error(`API /processing/${id}/raw → ${res.status}`);
  return res.blob();
}

// ── TEC Analysis ──────────────────────────────────────────────────────────────
export const getArchiveMeta = () => get<ArchiveMeta>("/tec/archive-meta");
export const getTimeSeries = (params?: { station?: string; start?: string; end?: string; limit?: number }) =>
  get<TecObservation[]>("/tec/time-series", params);
export const getAnomalies = (threshold_pct = 95, station?: string) =>
  get<AnomalyDay[]>("/tec/anomalies", { threshold_pct, station }, ANALYSIS_TIMEOUT_MS);
export const getAnomalyAnalysis = (threshold_pct = 95, station?: string) =>
  get<AnomalyAnalysisResponse>("/tec/anomaly-analysis", { threshold_pct, station }, ANALYSIS_TIMEOUT_MS);
/** Live NTRIP heat-map sampling can take ~30–55s on Vercel when the ingest DB is empty. */
const TEC_HEATMAP_TIMEOUT_MS = 90_000;

function rejectArchiveHeatmap(payload: TecHeatmapResponse): TecHeatmapResponse {
  const hasArchiveSource = (payload.stations ?? []).some((s) =>
    /processed_archive/i.test(s.source ?? ""),
  );
  const archiveQuality = payload.data_quality === "processed_archive";
  if (!archiveQuality && !hasArchiveSource) return payload;
  return {
    ...payload,
    available: false,
    stations: [],
    heat_points: [],
    grid: null,
    tec_min: null,
    tec_max: null,
    station_count: 0,
    data_quality: "none",
    message:
      "Live TEC heat map ignores processed RINEX/CMN archive values. Waiting for live NTRIP VTEC.",
  };
}

export const getTecHeatmap = async (hours = 0.05, refreshNtrip = false) => {
  // Cap client lookback; backend also clamps to ~3 minutes so TEC never looks cached.
  const liveHours = Math.min(Math.max(hours, 0.02), 0.05);
  const payload = await get<TecHeatmapResponse>(
    "/tec/heatmap",
    {
      hours: liveHours,
      _ts: Date.now(),
      ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
    },
    refreshNtrip ? TEC_HEATMAP_TIMEOUT_MS : Math.max(FETCH_TIMEOUT_MS, 45_000),
  );
  return rejectArchiveHeatmap(payload);
};

/** DLR 1h Global TEC forecast PNG (same asset the FastAPI proxy serves). */
export const DLR_GLOBAL_TEC_FORECAST_PNG =
  "https://data.impc.dlr.de/tec-forecast/" +
  "DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL/latest/" +
  "DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL_latest_I.png";

/** Object URL / direct URL for DLR's latest 1h global TEC forecast.
 * Prefer the FastAPI no-store proxy; if the API is busy (NTRIP/SQLite), fall
 * back to the DLR URL with a cache-buster so the Global TEC tab still renders.
 * Caller must revoke blob: object URLs.
 */
export async function fetchGlobalTecForecastObjectUrl(): Promise<string> {
  const bust = String(Date.now());
  const url = new URL(apiUrl("/tec/global-forecast-image"));
  url.searchParams.set("t", bust);
  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        cache: "no-store",
        headers: KEY ? { "X-API-Key": KEY } : {},
      },
      12_000,
    );
    if (!res.ok) {
      throw new Error(`Global TEC forecast failed (${res.status})`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    // <img> can load the DLR URL directly without CORS; keeps the layer usable
    // when localhost:8000 is saturated by live NTRIP ingest.
    return `${DLR_GLOBAL_TEC_FORECAST_PNG}?t=${bust}`;
  }
}

/** Sample + log DLR Global TEC at each CORS site; return time series for chart overlay. */
export const getGlobalVtecByStation = (hours = 6) =>
  get<GlobalTecByStationResponse>(
    "/tec/global-vtec-by-station",
    { hours, _ts: Date.now() },
    Math.max(FETCH_TIMEOUT_MS, 55_000),
  );

export const getDiurnal = (station?: string) => get<DiurnalPoint[]>("/tec/diurnal", { station });
export const getSeasonal = (station?: string) => get<SeasonalRow[]>("/tec/seasonal", { station });
export const getSolarCycle = (station?: string) => get<SolarCycleRow[]>("/tec/solar-cycle", { station });
export const getOmniAnalysis = (start: string, end: string, station?: string) =>
  get<OmniAnalysisResponse>("/tec/omni-analysis", { start, end, station, _ts: Date.now() }, ANALYSIS_TIMEOUT_MS);
export const getCelestrakAnalysis = (start: string, end: string, station?: string) =>
  get<CelestrakAnalysisResponse>("/tec/celestrak-analysis", { start, end, station, _ts: Date.now() }, ANALYSIS_TIMEOUT_MS);
export const getGfzKpAnalysis = (start: string, end: string, station?: string) =>
  get<GfzKpAnalysisResponse>("/tec/gfz-kp-analysis", { start, end, station, _ts: Date.now() }, ANALYSIS_TIMEOUT_MS);
export const getWdcKyotoAnalysis = (start: string, end: string, station?: string) =>
  get<WdcKyotoAnalysisResponse>("/tec/wdc-kyoto-analysis", { start, end, station, _ts: Date.now() }, ANALYSIS_TIMEOUT_MS);
export const getIntermagnetAnalysis = (start: string, end: string, observatory: string, station?: string) =>
  get<IntermagnetAnalysisResponse>(
    "/tec/intermagnet-analysis",
    { start, end, observatory, station, _ts: Date.now() },
    ANALYSIS_TIMEOUT_MS,
  );
export const getDidbaseIonosonde = (station: string, year?: number) =>
  get<DidbaseIonosondeResponse>("/tec/ionosonde-didbase", { station, year, _ts: Date.now() });
export const getGuviOn2 = (start?: string, end?: string) =>
  get<GuviOn2Response>("/tec/guvi-on2", { start, end, _ts: Date.now() });
export const getCosmic2Analysis = (start: string, end: string) =>
  get<Cosmic2AnalysisResponse>("/tec/cosmic2-analysis", { start, end, _ts: Date.now() }, ANALYSIS_TIMEOUT_MS);
export const getPrn = (params?: {
  constellation?: string;
  station?: string;
  hours?: number;
  elev_min?: number;
}) => get<PrnRow[]>("/tec/prn", params);

export type PrnExplorerParams = {
  constellation?: string;
  station?: string;
  start?: string;
  end?: string;
  hours?: number;
  elev_min?: number;
  prns?: string;
  limit?: number;
};

export const getPrnExplorer = (params?: PrnExplorerParams) =>
  get<PrnExplorerResponse>("/tec/prn/explorer", params);

export const getPrnConstellations = () =>
  get<PrnConstellationPayload>("/theory/prn-constellations");

// ── Live ──────────────────────────────────────────────────────────────────────
export const getLiveVtec = (
  hours = 2,
  station?: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  limit = 2500,
) =>
  get<LiveObservation[]>(
    "/live/vtec",
    { hours, station, limit, _ts: Date.now() },
    timeoutMs,
  );
export const getTecMethodComparison = (
  hours = 6,
  station?: string,
  limit = 1500,
  timeoutMs = 45_000,
) =>
  dedupeGet(
    `live/tec-method-comparison:${hours}:${station ?? ""}:${limit}`,
    () =>
      get<TecMethodComparisonResponse>(
        "/live/tec-method-comparison",
        { hours, station, limit, _ts: Date.now() },
        timeoutMs,
      ),
  );
export const getLiveVtecByStation = (hours = 6, resampleMinutes = 2, timeoutMs?: number) =>
  get<LiveStationVtecSeries[]>(
    "/live/vtec-by-station",
    { hours, resample_minutes: resampleMinutes, _ts: Date.now() },
    // Endpoint is usually fast; allow an override for teaching/slow environments.
    timeoutMs ?? (hours >= 24 ? 20_000 : hours >= 12 ? 15_000 : Math.max(FETCH_TIMEOUT_MS, 12_000)),
  );
export const getLiveStations = () => get<StationLiveStatus[]>("/live/stations");
export const getLivePipelineStatus = () => get<LivePipelineStatus>("/live/pipeline-status");
export const getLiveVtecHealth = () =>
  get<LiveVtecHealth>("/live/vtec-health", { _ts: Date.now() });
export const getNtripStatus = (refresh = false, listen_sec = 4) =>
  getWithRetry<NtripProbeResponse>("/live/ntrip-status", {
    _ts: Date.now(),
    ...(refresh ? { refresh: "true" } : {}),
    listen_sec,
  });
export async function runNtripProbe(listen_sec = 6) {
  const url = new URL(apiUrl("/live/ntrip-probe"));
  url.searchParams.set("listen_sec", String(listen_sec));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: KEY ? { "X-API-Key": KEY } : {},
    });
    if (!res.ok) throw new Error(`API /live/ntrip-probe → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Forecast ──────────────────────────────────────────────────────────────────
export const getForecastStatus = () => get<ForecastStatus>("/forecast/status");
export const getCnnGruTrainStatus = () => get<CnnGruTrainStatus>("/forecast/train/status");
export const trainCnnGruModel = () => post<{ status: string }>("/forecast/train", {});
export const getStatisticalForecast = (horizon_days = 30) =>
  get<ForecastPoint[]>("/forecast/statistical", { horizon_days });
export const getCnnGruForecast = () => get<ForecastPoint[]>("/forecast/cnn-gru");

// ── Theory ────────────────────────────────────────────────────────────────────
export const getVtecTheory = () => get<VtecTheoryPayload>("/theory/vtec");
export const getGeomagneticTheory = () => get<GeomagneticTheoryPayload>("/theory/geomagnetic");
export const getUnderstandingTec = async (): Promise<UnderstandingTecPayload> => {
  try {
    return await get<UnderstandingTecPayload>("/theory/understanding-tec", undefined, 4_000);
  } catch {
    const res = await fetch("/data/understanding-tec.json", { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        "Could not load Understanding TEC — run dev.ps1 to restart the FastAPI backend on port 8000.",
      );
    }
    return res.json();
  }
};

// ── Chat ──────────────────────────────────────────────────────────────────────
export const sendChat = (messages: ChatMessage[], station?: string) =>
  post<ChatResponse>("/chat", { messages, station });

// ── GIC Monitor ───────────────────────────────────────────────────────────────
export const getGicNetwork = () => getWithRetry<GicNetwork>("/gic/network", { _ts: Date.now() });
export const getGicStatus = () => get<GicStatusResponse>("/gic/status", { _ts: Date.now() });
export const getGicSeries = (station_id: string, hours = 24, resample?: string) =>
  get<GicSeriesResponse>("/gic/series", { station_id, hours, resample, _ts: Date.now() });
export const getGicReport = (station_id: string, period: GicReportPeriod) =>
  get<GicReport>("/gic/report", { station_id, period, _ts: Date.now() });
export const getGicLiveModel = (hours = 24) =>
  get<GicLiveModel>("/gic/live-model", { hours, _ts: Date.now() });

export async function uploadGicFile(file: File, stationId: string): Promise<GicUploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("station_id", stationId);
  const res = await fetch(apiUrl("/gic/upload"), {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { detail?: string };
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* use raw text */
    }
    throw new Error(msg || `GIC upload failed (${res.status})`);
  }
  return res.json();
}

export async function downloadGicReportCsv(station_id: string, period: GicReportPeriod): Promise<Blob> {
  const url = new URL(apiUrl("/gic/report"));
  url.searchParams.set("station_id", station_id);
  url.searchParams.set("period", period);
  url.searchParams.set("format", "csv");
  const res = await fetchWithTimeout(url.toString(), { headers: KEY ? { "X-API-Key": KEY } : {} });
  if (!res.ok) throw new Error(`API /gic/report → ${res.status}`);
  return res.blob();
}
