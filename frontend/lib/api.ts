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
  StationUptimeRow,
  TecHeatmapResponse,
  TecObservation,
  TecSummaryRow,
  TecHourlyRow,
  TecPlotSeries,
  VtecTheoryPayload,
  GeomagneticTheoryPayload,
  UnderstandingTecPayload,
} from "./types";

function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;
    const host =
      hostname === "[::1]" ? "127.0.0.1" : hostname;
    // Next.js dev (port 3000) — FastAPI is always on 8000 on the same machine.
    if (port === "3000" || port === "3001") {
      return `${protocol}//${host}:8000`;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }
    // Vercel/static export deploy — backend is exposed through /api.
    return `${window.location.origin}/api`;
  }
  return "http://localhost:8000";
}

const KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";
const FETCH_TIMEOUT_MS = 28_000;
const ANALYSIS_TIMEOUT_MS = 120_000;

function baseUrl(): string {
  return apiBase();
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
  const url = new URL(baseUrl() + path);
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
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return get<T>(path, params, timeoutMs);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(baseUrl() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(KEY ? { "X-API-Key": KEY } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`);
  return res.json();
}

// ── Space Weather ─────────────────────────────────────────────────────────────
export const getSpaceWeather = () =>
  getWithRetry<SpaceWeatherCurrent>("/space-weather/current", { _ts: Date.now() });
export const getSolarActivity = () => get<SolarActivityFull>("/space-weather/solar-activity");
export const getTimelines = () =>
  getWithRetry<SpaceWeatherTimelines>("/space-weather/timelines", { _ts: Date.now() });
export const refreshSpaceWeather = () =>
  fetch(baseUrl() + "/space-weather/refresh", { method: "POST", headers: KEY ? { "X-API-Key": KEY } : {} });
export const getSpaceWeatherLogStatus = () => get<SpaceWeatherLogStatus>("/space-weather/log/status");
export const getSpaceWeatherHistory = (hours = 168, resample?: string) =>
  get<SpaceWeatherHistoryResponse>("/space-weather/history", { hours, resample });
export const getSpaceWeatherCorrelations = (hours = 168, resample = "1h") =>
  get<SpaceWeatherCorrelationResponse>("/space-weather/correlations", { hours, resample });
export const getSpaceWeatherReport = (period: SpaceWeatherReportPeriod = "hourly") =>
  get<SpaceWeatherReport>("/space-weather/report", { period, _ts: Date.now() });
export const getEkfStatus = () => get<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
/** Retried EKF fetch — use on manual refresh only; avoid blocking the 60s poll. */
export const getEkfStatusWithRetry = () =>
  getWithRetry<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
export const getStormAlertStatus = () => get<StormAlertStatus>("/space-weather/storm-alerts/status");
export const getEkfAlertLog = (hours = 24) => get<EkfAlert[]>("/space-weather/ekf/alerts", { hours });
export const ackEkfAlert = (alertId: string) =>
  fetch(baseUrl() + `/space-weather/ekf/alerts/${alertId}/ack`, {
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
  fetch(baseUrl() + `/navigation-news/recipients/${recipientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(KEY ? { "X-API-Key": KEY } : {}) },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API PATCH /navigation-news/recipients → ${res.status}`);
    return res.json() as Promise<BroadcastRecipient>;
  });

export const deleteBroadcastRecipient = (recipientId: string) =>
  fetch(baseUrl() + `/navigation-news/recipients/${recipientId}`, {
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
    baseUrl() + `/navigation-news/broadcast/whatsapp/send?live=${live ? "true" : "false"}`,
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
  fetch(baseUrl() + "/navigation-news/broadcast/run", {
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
    const res = await fetch(baseUrl() + path, {
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
// A live refresh_ntrip=true probe of all 24 mountpoints from a Vercel
// serverless function genuinely takes ~45s (measured) -- well over the
// default 28s fetch timeout, so it was aborting (then retrying and
// aborting again) before ever completing, leaving the dashboard stuck on
// "Probing..." with a stale 0/24 reading. Give the live-probe call enough
// room; the default (archived-status) call keeps the normal fast timeout.
const NTRIP_LIVE_PROBE_TIMEOUT_MS = 90_000;

export const getStations = (refreshNtrip = false) =>
  getWithRetry<Station[]>(
    "/cors/stations",
    {
      _ts: Date.now(),
      ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
    },
    refreshNtrip ? NTRIP_LIVE_PROBE_TIMEOUT_MS : undefined,
  );
export const getStation = (code: string) => get<Station>(`/cors/stations/${code}`);
export const getCorsHealth = () => get<CorsHealth>("/cors/health");
export const getStationStatusLog = () => get<StationStatusLogStatus>("/cors/status/log");
export const getStationStatusEvents = (hours = 168, station?: string, event_type?: string) =>
  get<StationStatusEvent[]>("/cors/status/events", { hours, station, event_type });
export const getStationUptime = (hours = 168) => get<StationUptimeRow[]>("/cors/status/uptime", { hours });

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
  const res = await fetch(baseUrl() + "/processing/cmn", {
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
  const res = await fetchWithTimeout(baseUrl() + path, {
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
  const res = await fetchWithTimeout(baseUrl() + "/processing/rinex-convert", {
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

export const getSessionSummary = (id: string, mode: "daily" | "monthly" | "yearly" = "daily") =>
  get<TecSummaryRow[]>(`/processing/${id}/summary`, { mode });

export const getSessionHourly = (id: string) => get<TecHourlyRow[]>(`/processing/${id}/hourly`);

export const getSessionTecPlot = (id: string, raw = false) =>
  get<TecPlotSeries>(`/processing/${id}/tec-plot`, { raw: raw ? 1 : 0 });

export const getSessionBias = (id: string) => get<BiasRow[]>(`/processing/${id}/bias`);

export async function downloadSessionRaw(id: string): Promise<Blob> {
  const res = await fetch(baseUrl() + `/processing/${id}/raw`, {
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
export const getTecHeatmap = (hours = 6) => get<TecHeatmapResponse>("/tec/heatmap", { hours });
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
export const getLiveVtec = (hours = 2) => get<LiveObservation[]>("/live/vtec", { hours });
export const getLiveStations = () => get<StationLiveStatus[]>("/live/stations");
export const getLivePipelineStatus = () => get<LivePipelineStatus>("/live/pipeline-status");
export const getNtripStatus = (refresh = false, listen_sec = 4) =>
  getWithRetry<NtripProbeResponse>("/live/ntrip-status", {
    _ts: Date.now(),
    ...(refresh ? { refresh: "true" } : {}),
    listen_sec,
  });
export async function runNtripProbe(listen_sec = 6) {
  const url = new URL(baseUrl() + "/live/ntrip-probe");
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
export const sendChat = (messages: ChatMessage[], api_key?: string, station?: string) =>
  post<ChatResponse>("/chat", { messages, api_key, station });

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
  const res = await fetch(baseUrl() + "/gic/upload", {
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
  const url = new URL(baseUrl() + "/gic/report");
  url.searchParams.set("station_id", station_id);
  url.searchParams.set("period", period);
  url.searchParams.set("format", "csv");
  const res = await fetchWithTimeout(url.toString(), { headers: KEY ? { "X-API-Key": KEY } : {} });
  if (!res.ok) throw new Error(`API /gic/report → ${res.status}`);
  return res.blob();
}
