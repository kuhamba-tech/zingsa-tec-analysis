import type {
  ArchiveMeta,
  AnomalyDay,
  AudienceId,
  BiasRow,
  CelestrakAnalysisResponse,
  ChatMessage,
  ChatResponse,
  CorsHealth,
  DiurnalPoint,
  EkfAlert,
  EkfStatus,
  ForecastPoint,
  ForecastStatus,
  GicLiveModel,
  GicNetwork,
  GicReport,
  GicReportPeriod,
  GicSeriesResponse,
  GicStatusResponse,
  GicUploadResult,
  GfzKpAnalysisResponse,
  IntermagnetAnalysisResponse,
  LiveObservation,
  LivePipelineStatus,
  NavigationNewsBriefApi,
  NavigationNewsBundleApi,
  NavigationNewsScheduleApi,
  NtripProbeResponse,
  OmniAnalysisResponse,
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
  Station,
  StationLiveStatus,
  StationStatusEvent,
  StationStatusLogStatus,
  StationUptimeRow,
  TecObservation,
  TecSummaryRow,
  TecHourlyRow,
  TecPlotSeries,
  VtecTheoryPayload,
} from "./types";

function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8000";
}

const BASE = apiBase();
const KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";
const FETCH_TIMEOUT_MS = 28_000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetchWithTimeout(url.toString(), {
    headers: KEY ? { "X-API-Key": KEY } : {},
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

/** GET with one retry — helps Vercel cold starts on the home page. */
export async function getWithRetry<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  try {
    return await get<T>(path, params);
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return get<T>(path, params);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(BASE + path, {
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
export const getTimelines = () => get<SpaceWeatherTimelines>("/space-weather/timelines", { _ts: Date.now() });
export const refreshSpaceWeather = () =>
  fetch(BASE + "/space-weather/refresh", { method: "POST", headers: KEY ? { "X-API-Key": KEY } : {} });
export const getSpaceWeatherLogStatus = () => get<SpaceWeatherLogStatus>("/space-weather/log/status");
export const getSpaceWeatherHistory = (hours = 168, resample?: string) =>
  get<SpaceWeatherHistoryResponse>("/space-weather/history", { hours, resample });
export const getSpaceWeatherCorrelations = (hours = 168, resample = "1h") =>
  get<SpaceWeatherCorrelationResponse>("/space-weather/correlations", { hours, resample });
export const getSpaceWeatherReport = (period: SpaceWeatherReportPeriod = "hourly") =>
  get<SpaceWeatherReport>("/space-weather/report", { period, _ts: Date.now() });
export const getEkfStatus = () => getWithRetry<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
export const getEkfAlertLog = (hours = 24) => get<EkfAlert[]>("/space-weather/ekf/alerts", { hours });
export const ackEkfAlert = (alertId: string) =>
  fetch(BASE + `/space-weather/ekf/alerts/${alertId}/ack`, {
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

// ── CORS Network ──────────────────────────────────────────────────────────────
export const getStations = (refreshNtrip = false) =>
  getWithRetry<Station[]>("/cors/stations", {
    _ts: Date.now(),
    ...(refreshNtrip ? { refresh_ntrip: "true" } : {}),
  });
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
  const res = await fetch(BASE + "/processing/cmn", {
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
  const res = await fetch(BASE + "/processing/rinex", {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function convertRinex(files: File[], config: RinexConvertConfig): Promise<Blob> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  fd.append("config", JSON.stringify(config));
  const res = await fetchWithTimeout(BASE + "/processing/rinex-convert", {
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
  const res = await fetch(BASE + `/processing/${id}/raw`, {
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
  get<AnomalyDay[]>("/tec/anomalies", { threshold_pct, station });
export const getDiurnal = () => get<DiurnalPoint[]>("/tec/diurnal");
export const getSeasonal = () => get<SeasonalRow[]>("/tec/seasonal");
export const getSolarCycle = () => get<SolarCycleRow[]>("/tec/solar-cycle");
export const getOmniAnalysis = (start: string, end: string, station?: string) =>
  get<OmniAnalysisResponse>("/tec/omni-analysis", { start, end, station, _ts: Date.now() });
export const getCelestrakAnalysis = (start: string, end: string, station?: string) =>
  get<CelestrakAnalysisResponse>("/tec/celestrak-analysis", { start, end, station, _ts: Date.now() });
export const getGfzKpAnalysis = (start: string, end: string, station?: string) =>
  get<GfzKpAnalysisResponse>("/tec/gfz-kp-analysis", { start, end, station, _ts: Date.now() });
export const getIntermagnetAnalysis = (start: string, end: string, observatory: string, station?: string) =>
  get<IntermagnetAnalysisResponse>("/tec/intermagnet-analysis", { start, end, observatory, station, _ts: Date.now() });
export const getPrn = (constellation?: string) => get<PrnRow[]>("/tec/prn", { constellation });

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
  const url = new URL(BASE + "/live/ntrip-probe");
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
export const getStatisticalForecast = (horizon_days = 30) =>
  get<ForecastPoint[]>("/forecast/statistical", { horizon_days });
export const getCnnGruForecast = () => get<ForecastPoint[]>("/forecast/cnn-gru");

// ── Theory ────────────────────────────────────────────────────────────────────
export const getVtecTheory = () => get<VtecTheoryPayload>("/theory/vtec");

// ── Chat ──────────────────────────────────────────────────────────────────────
export const sendChat = (messages: ChatMessage[], api_key?: string) =>
  post<ChatResponse>("/chat", { messages, api_key });

// ── GIC Monitor ───────────────────────────────────────────────────────────────
export const getGicNetwork = () => get<GicNetwork>("/gic/network");
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
  const res = await fetch(BASE + "/gic/upload", {
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
  const url = new URL(BASE + "/gic/report");
  url.searchParams.set("station_id", station_id);
  url.searchParams.set("period", period);
  url.searchParams.set("format", "csv");
  const res = await fetchWithTimeout(url.toString(), { headers: KEY ? { "X-API-Key": KEY } : {} });
  if (!res.ok) throw new Error(`API /gic/report → ${res.status}`);
  return res.blob();
}
