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
  mean_vtec: number | null;
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
  mean_vtec: TimelinePoint[];
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
  active_alert_count?: number;
  kp_storm_level?: string | null;
  notification_channels?: Record<string, boolean>;
}

export interface StormAlertStatus {
  active: boolean;
  active_count: number;
  banner: string | null;
  kp_storm_level: string | null;
  ekf_alert_count: number;
  notification_channels: Record<string, boolean>;
  dry_run: boolean;
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

export type SpaceWeatherReportPeriod = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export interface SpaceWeatherReportParameter {
  name: string;
  current: number | null;
  unit?: string | null;
  trend: string;
  interpretation: string;
}

export interface SpaceWeatherReportGnssStation {
  station_code: string | null;
  station_name: string | null;
  availability_pct: number | null;
  rtk_note: string;
}

export interface SpaceWeatherReportCharts {
  labels: string[];
  kp: (number | null)[];
  dst: (number | null)[];
  tec: (number | null)[];
}

export interface SpaceWeatherReport {
  period: SpaceWeatherReportPeriod;
  period_label: string;
  window_start: string;
  window_end: string;
  generated_utc: string;
  sample_count: number;
  impact: { label: string; color: string; risk: string };
  executive_summary: string;
  parameters: SpaceWeatherReportParameter[];
  gnss_stations: SpaceWeatherReportGnssStation[];
  overall_availability_pct: number | null;
  risk_score: number | null;
  risk_message: string;
  charts: SpaceWeatherReportCharts;
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
  mountpoint?: string | null;
  marker_name?: string | null;
  marker_number?: string | null;
  rtcm_id?: string | null;
  site_server?: string | null;
  last_update?: string | null;
  site_status_label?: string | null;
  catalog_status?: string | null;
  ntrip_verdict?: string | null;
  ntrip_probed_at?: string | null;
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

export interface RinexConvertConfig {
  product_type: "rinex3" | "rinex2";
  observation_rate: "original" | "1hz" | "30s" | "15s";
  archive_type: "none" | "gzip" | "hatanaka";
  use_multiple_extensions: boolean;
  include_observations: boolean;
  include_observables: string;
  satellite_system: string;
  product_dynamics: "static" | "kinematic";
  compact_rinex: boolean;
  include_doppler: boolean;
  include_snr: boolean;
  include_l2c: boolean;
  include_navigation: boolean;
  observer: string;
  agency: string;
  include_meteo: boolean;
  meteo_device_name: string;
  meteo_manufacturer: string;
  include_auxiliary: boolean;
  aux_device_name: string;
  aux_manufacturer: string;
  general_header: string;
  obs_header: string;
  nav_header: string;
  meteo_header: string;
  aux_header: string;
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
  max_vtec?: number | null;
  tec_anomaly_flag?: boolean;
  storm_flag?: boolean;
  kp_storm_flag?: boolean;
  kp?: number | null;
  dst?: number | null;
  kp_severity?: string | null;
  tec_response?: string | null;
  tec_response_z?: number | null;
  tec_deviation_tecu?: number | null;
}

export interface StormComparisonDoy {
  doy: number;
  quiet_mean_vtec: number | null;
  storm_mean_vtec: number | null;
}

export interface EiaSummary {
  peak_hour_utc: number | null;
  post_sunset_peak_hour_utc: number | null;
  post_sunset_mean_vtec: number | null;
  daytime_mean_vtec: number | null;
  peak_season: string | null;
  anomaly_day_count: number;
  storm_confirmed_count: number;
}

export interface GeomagneticDailyPoint {
  date: string;
  kp: number | null;
  dst: number | null;
}

export interface AnomalyAnalysisResponse {
  days: AnomalyDay[];
  storm_comparison: StormComparisonDoy[];
  eia: EiaSummary;
  stations: string[];
  kp_available: boolean;
  dst_available: boolean;
  geomagnetic_daily: GeomagneticDailyPoint[];
  diurnal: DiurnalPoint[];
  seasonal: SeasonalRow[];
  solar_cycle: SolarCycleRow[];
}

export interface TecHeatmapResponse {
  available: boolean;
  stations: TecHeatmapStation[];
  heat_points: TecHeatmapPoint[];
  grid: TecHeatmapGrid | null;
  bounds: number[];
  tec_min: number | null;
  tec_max: number | null;
  station_count: number;
  updated_at: string | null;
  message: string | null;
}

export interface TecHeatmapStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
  vtec: number;
  obs_count: number;
}

export interface TecHeatmapPoint {
  lon: number;
  lat: number;
  vtec: number;
  weight: number;
  code: string | null;
}

export interface TecHeatmapGrid {
  lons: number[][];
  lats: number[][];
  vtec: (number | null)[][];
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

export interface GfzKpDailyPoint {
  date: string;
  kp: number | null;
  kp_mean: number | null;
  ap: number | null;
  ap_daily: number | null;
  cp: number | null;
  storm_flag: boolean;
  storm_class: string;
  mean_vtec: number | null;
}

export interface GfzKpStormDay {
  date: string;
  kp: number | null;
  ap: number | null;
  cp: number | null;
  storm_class: string;
  mean_vtec: number | null;
}

export interface GfzKpAnalysisResponse {
  source: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  storm_days: number;
  max_kp: number | null;
  max_ap: number | null;
  mean_cp: number | null;
  mean_vtec_storm: number | null;
  mean_vtec_quiet: number | null;
  series: GfzKpDailyPoint[];
  storms: GfzKpStormDay[];
  fetched_at: string | null;
}

export interface WdcKyotoDailyPoint {
  date: string;
  kp: number | null;
  kp_mean: number | null;
  ap: number | null;
  ap_daily: number | null;
  dst: number | null;
  storm_flag: boolean;
  storm_class: string;
  mean_vtec: number | null;
}

export interface WdcKyotoStormDay {
  date: string;
  kp: number | null;
  dst: number | null;
  ap: number | null;
  storm_class: string;
  mean_vtec: number | null;
}

export interface WdcKyotoAnalysisResponse {
  source: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  storm_days: number;
  max_kp: number | null;
  min_dst: number | null;
  max_ap: number | null;
  mean_vtec_storm: number | null;
  mean_vtec_quiet: number | null;
  series: WdcKyotoDailyPoint[];
  storms: WdcKyotoStormDay[];
  fetched_at: string | null;
}

export interface IntermagnetDailyPoint {
  date: string;
  mean_h: number | null;
  range_h: number | null;
  max_dbdt: number | null;
  gic_est_a: number | null;
  samples: number;
  storm_flag: boolean;
  storm_class: string;
  mean_vtec: number | null;
}

export interface IntermagnetStormDay {
  date: string;
  max_dbdt: number | null;
  range_h: number | null;
  gic_est_a: number | null;
  storm_class: string;
  mean_vtec: number | null;
}

export interface IntermagnetAnalysisResponse {
  source: string;
  observatory: string;
  observatory_name: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number;
  storm_days: number;
  max_dbdt: number | null;
  max_range_h: number | null;
  max_gic_est_a: number | null;
  mean_vtec_storm: number | null;
  mean_vtec_quiet: number | null;
  series: IntermagnetDailyPoint[];
  storms: IntermagnetStormDay[];
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

export interface PrnObservation {
  timestamp: string;
  station: string;
  prn: string;
  constellation: string | null;
  vtec: number | null;
  stec: number | null;
  elevation_deg: number | null;
  azimuth_deg: number | null;
  quality: number | null;
}

export interface PrnMeta {
  source: string;
  record_count: number;
  stations: string[];
  prns: string[];
  has_azimuth: boolean;
  has_elevation: boolean;
  has_quality: boolean;
  time_start: string | null;
  time_end: string | null;
  message: string | null;
}

export interface PrnExplorerResponse {
  meta: PrnMeta;
  summary: PrnRow[];
  observations: PrnObservation[];
}

export interface PrnConstellationMetric {
  label: string;
  text: string;
}

export interface PrnConstellationInfo {
  id: string;
  label: string;
  icon: string;
  prefix: string;
  max_prn: number;
  color: string;
  prn_range: string;
  section: string;
  summary: string;
  frequencies: string;
  metrics: PrnConstellationMetric[];
  formula_caption: string;
  formula: string;
  zgiis: string;
}

export interface PrnConstellationPayload {
  constellations: PrnConstellationInfo[];
  citation: string;
  quality_note: string;
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

export interface LivePipelineStreamStatus {
  mountpoint: string;
  connected: boolean;
  last_seen: string | null;
  msg_count: number;
}

export interface LivePipelineStatus {
  ntrip_configured: boolean;
  active_streams: number;
  streams: Record<string, LivePipelineStreamStatus>;
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
export interface ChatContextSummary {
  lines: string[];
  tec?: Record<string, unknown> | null;
  space_weather?: Record<string, unknown> | null;
  ekf_alerts?: Record<string, unknown> | null;
  live_pipeline?: Record<string, unknown> | null;
}
export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface ChatResponse {
  reply: string;
  context_injected: boolean;
  context?: ChatContextSummary | null;
}

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
  ipp?: { svg: string; legend_html: string };
}

/** Same shape as VtecTheoryPayload (no IPP detail section). */
export type GeomagneticTheoryPayload = Omit<VtecTheoryPayload, "ipp">;
export type UnderstandingTecPayload = Omit<VtecTheoryPayload, "ipp">;

export interface ComputationPipeline {
  inputs: string[];
  stages: { label: string; ref: string }[];
  output: string;
}

// ── Navigation News (broadcast agent API) ───────────────────────────────────────

export type AudienceId = "farmer" | "surveyor" | "citizen" | "driver" | "aviation";

export interface NavigationNewsBriefApi {
  id: AudienceId;
  icon: string;
  title: string;
  audience: string;
  headline: string;
  summary: string;
  space_weather_today: string;
  space_weather_bullets: string[];
  bullets: string[];
  action: string;
  status_tone: string;
  broadcast_script: string;
  social_script: string;
  channels: string[];
}

export interface NavigationNewsBundleApi {
  computed_at: string;
  last_updated_at: string;
  next_update_at: string;
  update_interval_hours: number;
  update_history: string[];
  input_summary: string;
  sources: { spaceWeather?: boolean; corsStations?: boolean; ntripProbe?: boolean };
  briefs: NavigationNewsBriefApi[];
}

export interface NavigationNewsScheduleApi {
  last_updated_at: string;
  next_update_at: string;
  update_interval_hours: number;
  updates_per_day: number;
  update_history: string[];
}

// ── GIC Monitor ──────────────────────────────────────────────────────────────

export interface GicSubstation {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export interface GicLine {
  from: string;
  to: string;
  kv: number;
  coords: [number, number][];
}

export interface GicMonitoringStationMeta {
  station_id: string;
  name: string;
  substation: string;
  sensor: string;
  datalogger: string;
  gateway: string;
  notes: string;
}

export interface GicRiskBand {
  level: string;
  min_abs_a: number;
  color: string;
  meaning: string;
}

export interface GicNetwork {
  substations: GicSubstation[];
  lines: GicLine[];
  monitoring_stations: GicMonitoringStationMeta[];
  risk_bands: GicRiskBand[];
}

export interface GicStationStatus {
  station_id: string;
  name: string;
  substation: string | null;
  sensor: string | null;
  datalogger: string | null;
  gateway: string | null;
  record_count: number;
  first_sample: string | null;
  last_sample: string | null;
  latest_gic_a: number | null;
  latest_level: string | null;
  has_data: boolean;
}

export interface GicStatusResponse {
  stations: GicStationStatus[];
  total_records: number;
}

export interface GicSeriesPoint {
  t: string;
  observed: number | null;
  predicted: number | null;
  error: number | null;
  confidence: number | null;
  rate_a_per_min: number | null;
}

export interface GicSpaceWeatherPoint {
  t: string;
  kp: number | null;
  dst: number | null;
}

export interface GicDeviationStatus {
  available: boolean;
  observed: number | null;
  predicted: number | null;
  error: number | null;
  threshold: number | null;
  ratio: number | null;
  severity: string;
  timestamp: string | null;
}

export interface GicSeriesResponse {
  station_id: string;
  hours: number;
  resample: string | null;
  count: number;
  points: GicSeriesPoint[];
  space_weather: GicSpaceWeatherPoint[];
  deviation: GicDeviationStatus | null;
  alerts: EkfAlert[];
  banner: string | null;
}

export interface GicUploadResult {
  filename: string;
  station_id: string;
  parsed: number;
  inserted: number;
  from: string;
  to: string;
}

export interface GicReportStatistics {
  mean_a: number;
  std_a: number;
  min_a: number;
  max_a: number;
  peak_abs_a: number;
  peak_time: string;
  p95_abs_a: number;
  first_sample: string;
  last_sample: string;
}

export interface GicBandMinutes {
  level: string;
  minutes: number;
  samples: number;
}

export interface GicEvent {
  start: string;
  end: string;
  duration_min: number;
  peak_gic_a: number;
  peak_time: string;
  level: string;
}

export interface GicKpCorrelation {
  kp_r: number | null;
  dst_r: number | null;
  samples: number;
}

export interface GicLiveModelPoint {
  t: string;
  b_total: number;
  dbdt: number | null;
  gic_est_a: number | null;
}

export interface GicLiveModel {
  available: boolean;
  reason?: string;
  model?: string;
  coefficient_a_per_nt_min?: number;
  source?: string;
  disclaimer?: string;
  latest?: GicLiveModelPoint | null;
  count?: number;
  points: GicLiveModelPoint[];
}

export type GicReportPeriod = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export interface GicReport {
  station_id: string;
  period: GicReportPeriod;
  period_label: string;
  window_start: string;
  window_end: string;
  generated_utc: string;
  sample_count: number;
  statistics: GicReportStatistics | null;
  band_minutes: GicBandMinutes[];
  events: GicEvent[];
  kp_correlation: GicKpCorrelation | null;
  interpretation: string[];
}
