// ── Space Weather ─────────────────────────────────────────────────────────────
export interface SpaceWeatherCurrent {
  kp: number | null;
  kp_condition: string | null;
  kp_color: string | null;
  dst: number | null;
  f107: number | null;
  s4: number | null;
  gnss_risk: string | null;
  gnss_risk_color: string | null;
  stations_online: number | null;
  stations_total: number | null;
  plasma_speed: number | null;
  updated_utc: string | null;
}

export interface TimelinePoint { t: string; v: number | null; }

export interface SpaceWeatherTimelines {
  kp: TimelinePoint[];
  dst: TimelinePoint[];
  f107: TimelinePoint[];
  solar_wind: TimelinePoint[];
  s4: TimelinePoint[];
  gnss_risk: TimelinePoint[];
  stations_online: TimelinePoint[];
}

export interface SolarActivity {
  flare_count: number | null;
  cme_count: number | null;
  xray_low: number | null;
  xray_high: number | null;
  plasma_speed: number | null;
  radio_bursts: Record<string, unknown>[];
  active_regions: Record<string, unknown>[];
  cme_list: Record<string, unknown>[];
}

export interface SolarWindDetail {
  speed: number | null;
  density: number | null;
  temperature: number | null;
  bt: number | null;
  bz: number | null;
}

export interface SolarActivityFull {
  mode: string;
  updated: string;
  flare_class: string;
  flux: number | null;
  xray_series: number[];
  solar_wind: SolarWindDetail;
  alerts: Record<string, unknown>[];
  donki_flares: Record<string, unknown>[];
  donki_cmes: Record<string, unknown>[];
  donki_storms: Record<string, unknown>[];
  donki_date_start: string | null;
  donki_date_end: string | null;
  donki_status: string;
  donki_note: string;
  activity_label: string;
  activity_color: string;
  activity_gnss: string;
  api_routes: string[];
  error: string | null;
  active_regions: Record<string, unknown>[];
  cme_rows: Record<string, unknown>[];
  radio_burst_rows: Record<string, unknown>[];
}

// ── CORS Network ──────────────────────────────────────────────────────────────
export interface Station {
  code: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  constellations: string[];
  current_tec: number | null;
  height_m: number | null;
}

export interface CorsHealth {
  online: number;
  degraded: number;
  offline: number;
  total: number;
}

// ── Processing ────────────────────────────────────────────────────────────────
export interface ProcessingSession {
  session_id: string;
  status: string;
  message: string;
  rows: number;
}

export interface TecSummaryRow {
  date: string;
  mean_vtec: number | null;
  max_vtec: number | null;
  min_vtec: number | null;
  samples: number | null;
}

// ── TEC Analysis ──────────────────────────────────────────────────────────────
export interface ArchiveMeta {
  available: boolean;
  stations: string[];
  first_date: string | null;
  last_date: string | null;
  observations: number;
  source_files: number;
  total_rows: number;
}

export interface TecObservation {
  timestamp: string;
  station: string;
  vtec: number | null;
  stec: number | null;
  constellation: string | null;
  prn: string | null;
  elevation_deg: number | null;
}

export interface AnomalyDay {
  date: string;
  mean_vtec: number;
  anomaly: boolean;
  threshold: number;
}

export interface DiurnalPoint { hour: number; mean_vtec: number; std_vtec: number; }
export interface SeasonalRow { season: string; mean: number; max: number; min: number; std: number; }
export interface SolarCycleRow { year: number; mean_vtec: number; max_vtec: number; min_vtec: number; }
export interface PrnRow {
  prn: string;
  constellation: string;
  mean_vtec: number | null;
  max_vtec: number | null;
  mean_stec: number | null;
  mean_elevation: number | null;
  mean_qual: number | null;
  samples: number | null;
}

// ── Live ──────────────────────────────────────────────────────────────────────
export interface LiveObservation {
  time: string;
  station: string;
  vtec_tecu: number | null;
  stec_tecu: number | null;
  elevation_deg: number | null;
  constellation: string | null;
  prn: string | null;
}

export interface StationLiveStatus {
  code: string;
  name: string;
  lat: number;
  lon: number;
  latency_ms: number | null;
  msg_rate: number | null;
  stale: boolean;
  last_vtec: number | null;
}

// ── Forecast ──────────────────────────────────────────────────────────────────
export interface ForecastStatus {
  torch_ok: boolean;
  model_exists: boolean;
  forecast_h: number;
  seq_len: number;
  path: string | null;
}

export interface ForecastPoint {
  t: string;
  predicted_vtec: number;
  upper: number | null;
  lower: number | null;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface ChatResponse { reply: string; context_injected: boolean; }
