import type {
  ArchiveMeta,
  AnomalyDay,
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
  LiveObservation,
  LivePipelineStatus,
  OmniAnalysisResponse,
  PrnRow,
  ProcessingOptions,
  ProcessingSession,
  SeasonalRow,
  SolarActivityFull,
  SolarCycleRow,
  SpaceWeatherCurrent,
  SpaceWeatherCorrelationResponse,
  SpaceWeatherHistoryResponse,
  SpaceWeatherLogStatus,
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
const FETCH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
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
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
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
export const getSpaceWeather = () => get<SpaceWeatherCurrent>("/space-weather/current", { _ts: Date.now() });
export const getSolarActivity = () => get<SolarActivityFull>("/space-weather/solar-activity");
export const getTimelines = () => get<SpaceWeatherTimelines>("/space-weather/timelines", { _ts: Date.now() });
export const refreshSpaceWeather = () =>
  fetch(BASE + "/space-weather/refresh", { method: "POST", headers: KEY ? { "X-API-Key": KEY } : {} });
export const getSpaceWeatherLogStatus = () => get<SpaceWeatherLogStatus>("/space-weather/log/status");
export const getSpaceWeatherHistory = (hours = 168, resample?: string) =>
  get<SpaceWeatherHistoryResponse>("/space-weather/history", { hours, resample });
export const getSpaceWeatherCorrelations = (hours = 168, resample = "1h") =>
  get<SpaceWeatherCorrelationResponse>("/space-weather/correlations", { hours, resample });
export const getEkfStatus = () => get<EkfStatus>("/space-weather/ekf", { _ts: Date.now() });
export const getEkfAlertLog = (hours = 24) => get<EkfAlert[]>("/space-weather/ekf/alerts", { hours });
export const ackEkfAlert = (alertId: string) =>
  fetch(BASE + `/space-weather/ekf/alerts/${alertId}/ack`, {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
  });

// ── CORS Network ──────────────────────────────────────────────────────────────
export const getStations = () => get<Station[]>("/cors/stations");
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
export const getPrn = (constellation?: string) => get<PrnRow[]>("/tec/prn", { constellation });

// ── Live ──────────────────────────────────────────────────────────────────────
export const getLiveVtec = (hours = 2) => get<LiveObservation[]>("/live/vtec", { hours });
export const getLiveStations = () => get<StationLiveStatus[]>("/live/stations");
export const getLivePipelineStatus = () => get<LivePipelineStatus>("/live/pipeline-status");

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
