import type {
  ArchiveMeta,
  AnomalyDay,
  ChatMessage,
  ChatResponse,
  CorsHealth,
  DiurnalPoint,
  ForecastPoint,
  ForecastStatus,
  LiveObservation,
  LivePipelineStatus,
  PrnRow,
  ProcessingSession,
  SeasonalRow,
  SolarActivityFull,
  SolarCycleRow,
  SpaceWeatherCurrent,
  SpaceWeatherTimelines,
  Station,
  StationLiveStatus,
  TecObservation,
  TecSummaryRow,
  VtecTheoryPayload,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), {
    headers: KEY ? { "X-API-Key": KEY } : {},
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
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

// ── CORS Network ──────────────────────────────────────────────────────────────
export const getStations = () => get<Station[]>("/cors/stations");
export const getStation = (code: string) => get<Station>(`/cors/stations/${code}`);
export const getCorsHealth = () => get<CorsHealth>("/cors/health");

// ── Processing ────────────────────────────────────────────────────────────────
export async function uploadCmn(file: File): Promise<ProcessingSession> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(BASE + "/processing/cmn", {
    method: "POST",
    headers: KEY ? { "X-API-Key": KEY } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadRinex(obs: File[], nav: File[]): Promise<ProcessingSession> {
  const fd = new FormData();
  obs.forEach((f) => fd.append("obs", f));
  nav.forEach((f) => fd.append("nav", f));
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

// ── TEC Analysis ──────────────────────────────────────────────────────────────
export const getArchiveMeta = () => get<ArchiveMeta>("/tec/archive-meta");
export const getTimeSeries = (params?: { station?: string; start?: string; end?: string; limit?: number }) =>
  get<TecObservation[]>("/tec/time-series", params);
export const getAnomalies = (threshold_pct = 95, station?: string) =>
  get<AnomalyDay[]>("/tec/anomalies", { threshold_pct, station });
export const getDiurnal = () => get<DiurnalPoint[]>("/tec/diurnal");
export const getSeasonal = () => get<SeasonalRow[]>("/tec/seasonal");
export const getSolarCycle = () => get<SolarCycleRow[]>("/tec/solar-cycle");
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
