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

export interface SpaceWeatherLogStatus {
  logging: boolean;
  interval_sec: number;
  record_count: number;
  latest_time: string | null;
  db_backend: string;
}

// ── Extended Kalman Filter (EKF) ────────────────────────────────────────────
export interface EkfPoint {
  t: string;
  observed: number | null;
  predicted: number | null;
  error: number | null;
  confidence: number | null;
}

export interface EkfSeries {
  parameter: string;
  points: EkfPoint[];
}

export interface EkfAlert {
  alert_id: string;
  timestamp: string;
  parameter: string;
  parameter_label: string;
  observed_value: number | null;
  ekf_predicted_value: number | null;
  prediction_error: number | null;
  threshold: number | null;
  severity: "Low" | "Moderate" | "High" | "Severe";
  related_indicators: string[];
  alert_message: string;
  acknowledged_status: boolean;
}

export interface EkfStatus {
  series: Record<string, EkfSeries>;
  alerts: EkfAlert[];
  banner: string | null;
}

export interface SpaceWeatherHistoryRow {
  time: string;
  kp: number | null;
  kp_condition: string | null;
  dst: number | null;
  f107: number | null;
  plasma_speed: number | null;
  s4: number | null;
  gnss_risk: string | null;
  gnss_risk_score: number | null;
  stations_online: number | null;
  stations_total: number | null;
  mean_vtec: number | null;
}

export interface SpaceWeatherHistoryResponse {
  hours: number;
  resample: string | null;
  count: number;
  rows: SpaceWeatherHistoryRow[];
}

export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
}

export interface SpaceWeatherCorrelationResponse {
  hours: number;
  resample: string;
  sample_count: number;
  from_time: string | null;
  to_time: string | null;
  matrix: Record<string, Record<string, number | null>>;
  pairs: CorrelationPair[];
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
  status_source?: "ntrip" | "catalog" | "unknown";
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

export interface StationStatusLogStatus {
  logging: boolean;
  poll_interval_sec: number;
  api_reachable: boolean;
  event_count: number;
  snapshot_count: number;
  tracked_stations: number;
  db_backend: string;
}

export interface StationStatusEvent {
  time: string;
  station_code: string | null;
  status: string;
  previous_status: string | null;
  event_type: string;
  online_count: number | null;
  degraded_count: number | null;
  offline_count: number | null;
  unknown_count: number | null;
  api_reachable: boolean;
  message: string | null;
  source: string | null;
}

export interface StationUptimeRow {
  station_code: string;
  station_name: string;
  samples: number;
  online_pct: number;
  degraded_pct: number;
  offline_pct: number;
  unknown_pct: number;
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
  daytime_mean_vtec?: number | null;
  samples: number | null;
  storm_flag?: boolean | null;
  kp_index?: number | null;
}

export interface TecHourlyRow {
  ut_hour: number;
  mean_vtec: number | null;
  max_vtec: number | null;
  min_vtec: number | null;
  days_used: number | null;
}

export interface BiasRow {
  station: string;
  mean_stec: number | null;
  mean_vtec: number | null;
  dcb_folder: string;
}

export interface ProcessingOptions {
  elevationMin?: number;
  ippHeight?: number;
  dcbFolder?: string;
  stations?: string[];
  kpCsv?: string;
}

export interface TecPlotPoint {
  x: number | null;
  y: number | null;
}

export interface TecPlotDataset {
  label: string;
  points: TecPlotPoint[];
}

export interface TecPlotSeries {
  datasets: TecPlotDataset[];
  mean: TecPlotPoint[];
  xlabel: string;
  ylabel: string;
  y_min: number;
  y_max: number;
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

export interface OmniDailyPoint {
  date: string;
  ssn: number | null;
  kp: number | null;
  kp_mean: number | null;
  dst: number | null;
  f107: number | null;
  storm_flag: boolean;
  storm_class: string;
  mean_vtec: number | null;
}

export interface OmniStormDay {
  date: string;
  kp: number | null;
  dst: number | null;
  f107: number | null;
  ssn: number | null;
  storm_class: string;
  mean_vtec: number | null;
}

export interface OmniAnalysisResponse {
  source: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  storm_days: number;
  max_kp: number | null;
  min_dst: number | null;
  mean_f107: number | null;
  mean_vtec_storm: number | null;
  mean_vtec_quiet: number | null;
  series: OmniDailyPoint[];
  storms: OmniStormDay[];
  fetched_at: string | null;
}
export interface CelestrakDailyPoint {
  date: string;
  ssn: number | null;
  kp: number | null;
  kp_mean: number | null;
  ap: number | null;
  f107: number | null;
  data_type: string | null;
  storm_flag: boolean;
  storm_class: string;
  mean_vtec: number | null;
}

export interface CelestrakStormDay {
  date: string;
  kp: number | null;
  ap: number | null;
  f107: number | null;
  ssn: number | null;
  storm_class: string;
  mean_vtec: number | null;
}

export interface CelestrakAnalysisResponse {
  source: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  storm_days: number;
  max_kp: number | null;
  max_ap: number | null;
  mean_f107: number | null;
  mean_vtec_storm: number | null;
  mean_vtec_quiet: number | null;
  series: CelestrakDailyPoint[];
  storms: CelestrakStormDay[];
  fetched_at: string | null;
}

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

export interface LivePipelineStatus {
  ntrip_configured: boolean;
  active_streams: number;
  streams: Record<string, unknown>;
  db_backend: string;
  record_count: number;
  runtime_mode: string;
  ingest_enabled: boolean;
  message: string | null;
}

export interface NtripProbeRow {
  station: string;
  mountpoint: string;
  tcp_ok: boolean;
  caster_ok: boolean;
  http_status: string | null;
  bytes_received: number;
  rtcm_total: number;
  msm_count: number;
  rtcm_frames: number;
  msg_types: Record<string, number>;
  msm_types: Record<string, number>;
  first_msgs: number[];
  verdict: "msm_streaming" | "rtcm_no_msm" | "connected_no_data" | "offline" | string;
  note: string;
  error: string | null;
}

export interface NtripProbeResponse {
  host: string | null;
  port: number;
  listen_sec: number;
  probed_at: string;
  stations: NtripProbeRow[];
  summary: {
    total: number;
    msm_streaming: number;
    rtcm_no_msm: number;
    connected_no_data: number;
    offline: number;
  };
  error: string | null;
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

// ── VTEC Theory ───────────────────────────────────────────────────────────────
export interface TheoryEquation {
  latex: string;
  number: string;
  caption: string;
}

export interface TheoryVariable {
  symbol: string;
  meaning: string;
}

export interface TheoryIllustration {
  step_id: string;
  caption: string;
  svg: string;
  num: string;
  short: string;
  accent: string;
}

export interface TheoryJourneyPill {
  num: string;
  short: string;
  accent: string;
}

export interface TheoryPipelineStage {
  label: string;
  icon: string;
}

export interface TheoryStep {
  id: string;
  title: string;
  accent: string;
  body: string;
  why: string;
  equations: TheoryEquation[];
  variables: TheoryVariable[];
  illustration: TheoryIllustration;
  ipp_detail?: boolean;
}

export interface VtecTheoryPayload {
  citation: string;
  journey: TheoryJourneyPill[];
  pipeline_stages: TheoryPipelineStage[];
  computation_pipeline: ComputationPipeline;
  steps: TheoryStep[];
  ipp: { svg: string; legend_html: string };
}

export interface ComputationPipeline {
  inputs: string[];
  stages: { label: string; ref: string }[];
  output: string;
}
