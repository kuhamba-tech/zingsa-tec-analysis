from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── Space Weather ──────────────────────────────────────────────────────────────

class SpaceWeatherCurrent(BaseModel):
    kp: float | None = None
    kp_condition: str | None = None
    kp_color: str | None = None
    dst: float | None = None
    f107: float | None = None
    s4: float | None = None
    gnss_risk: str | None = None
    gnss_risk_color: str | None = None
    stations_online: int | None = None
    stations_total: int | None = None
    plasma_speed: float | None = None
    mean_vtec: float | None = None
    updated_utc: str | None = None


class SolarActivity(BaseModel):
    flare_count: int | None = None
    cme_count: int | None = None
    xray_low: float | None = None
    xray_high: float | None = None
    plasma_speed: float | None = None
    radio_bursts: list[dict[str, Any]] = []
    active_regions: list[dict[str, Any]] = []
    cme_list: list[dict[str, Any]] = []


class SolarWindDetail(BaseModel):
    speed: float | None = None
    density: float | None = None
    temperature: float | None = None
    bt: float | None = None
    bz: float | None = None


class SolarActivityFull(BaseModel):
    mode: str = "unavailable"
    updated: str = ""
    flare_class: str = "N/A"
    flux: float | None = None
    xray_series: list[float] = []
    solar_wind: SolarWindDetail = SolarWindDetail()
    alerts: list[dict[str, Any]] = []
    donki_flares: list[dict[str, Any]] = []
    donki_cmes: list[dict[str, Any]] = []
    donki_storms: list[dict[str, Any]] = []
    donki_date_start: str | None = None
    donki_date_end: str | None = None
    donki_status: str = "unavailable"
    donki_note: str = ""
    activity_label: str = "Low"
    activity_color: str = "#22c55e"
    activity_gnss: str = "Minimal impact"
    api_routes: list[str] = []
    error: str | None = None
    active_regions: list[dict[str, Any]] = []
    cme_rows: list[dict[str, Any]] = []
    radio_burst_rows: list[dict[str, Any]] = []


class TimelinePoint(BaseModel):
    t: str
    v: float | None


class SpaceWeatherTimelines(BaseModel):
    kp: list[TimelinePoint] = []
    dst: list[TimelinePoint] = []
    f107: list[TimelinePoint] = []
    solar_wind: list[TimelinePoint] = []
    s4: list[TimelinePoint] = []
    gnss_risk: list[TimelinePoint] = []
    stations_online: list[TimelinePoint] = []
    mean_vtec: list[TimelinePoint] = []
    gic: list[TimelinePoint] = []


class SpaceWeatherHistoryRow(BaseModel):
    time: str
    kp: float | None = None
    kp_condition: str | None = None
    dst: float | None = None
    f107: float | None = None
    plasma_speed: float | None = None
    s4: float | None = None
    gnss_risk: str | None = None
    gnss_risk_score: float | None = None
    stations_online: int | None = None
    stations_total: int | None = None
    mean_vtec: float | None = None


class SpaceWeatherHistoryResponse(BaseModel):
    hours: float
    resample: str | None = None
    count: int
    rows: list[SpaceWeatherHistoryRow]


class CorrelationPair(BaseModel):
    a: str
    b: str
    r: float


class SpaceWeatherCorrelationResponse(BaseModel):
    hours: float
    resample: str
    sample_count: int
    from_time: str | None = None
    to_time: str | None = None
    matrix: dict[str, dict[str, float | None]]
    pairs: list[CorrelationPair]


class SpaceWeatherLogStatus(BaseModel):
    logging: bool
    interval_sec: float
    record_count: int
    latest_time: str | None = None
    db_backend: str


class SpaceWeatherReportParameter(BaseModel):
    name: str
    current: float | None = None
    unit: str | None = None
    trend: str = "stable"
    interpretation: str = ""


class SpaceWeatherReportGnssStation(BaseModel):
    station_code: str | None = None
    station_name: str | None = None
    availability_pct: float | None = None
    rtk_note: str = ""


class SpaceWeatherReportCharts(BaseModel):
    labels: list[str] = []
    kp: list[float | None] = []
    dst: list[float | None] = []
    tec: list[float | None] = []


class SpaceWeatherReportResponse(BaseModel):
    period: str
    period_label: str
    window_start: str
    window_end: str
    generated_utc: str
    sample_count: int = 0
    impact: dict[str, str]
    executive_summary: str
    parameters: list[SpaceWeatherReportParameter] = []
    gnss_stations: list[SpaceWeatherReportGnssStation] = []
    overall_availability_pct: float | None = None
    risk_score: float | None = None
    risk_message: str = ""
    charts: SpaceWeatherReportCharts = SpaceWeatherReportCharts()


# ── Extended Kalman Filter (EKF) ──────────────────────────────────────────────

class EkfPointOut(BaseModel):
    t: str
    observed: float | None = None
    predicted: float | None = None
    error: float | None = None
    confidence: float | None = None


class EkfSeriesOut(BaseModel):
    parameter: str
    points: list[EkfPointOut] = []


class EkfAlertOut(BaseModel):
    alert_id: str
    timestamp: str
    parameter: str
    parameter_label: str
    observed_value: float | None = None
    ekf_predicted_value: float | None = None
    prediction_error: float | None = None
    threshold: float | None = None
    severity: str
    related_indicators: list[str] = []
    alert_message: str
    acknowledged_status: bool = False


class EkfStatusOut(BaseModel):
    series: dict[str, EkfSeriesOut] = {}
    alerts: list[EkfAlertOut] = []
    banner: str | None = None
    active_alert_count: int = 0
    kp_storm_level: str | None = None
    notification_channels: dict[str, bool] = {}


class StormAlertDispatchResult(BaseModel):
    channel: str
    ok: bool
    detail: str = ""


class StormAlertStatus(BaseModel):
    active: bool
    active_count: int = 0
    banner: str | None = None
    kp_storm_level: str | None = None
    geomagnetic_level: str = "none"
    geomagnetic_reasons: list[str] = []
    alert_rules: list[str] = []
    ekf_alert_count: int = 0
    notification_channels: dict[str, bool] = {}
    dry_run: bool = True

class StationOut(BaseModel):
    code: str
    name: str
    lat: float
    lon: float
    status: str
    status_source: str = "unknown"  # "ntrip" | "catalog" | "unknown"
    constellations: list[str] = []
    current_tec: float | None = None
    height_m: float | None = None
    mountpoint: str | None = None
    marker_name: str | None = None
    marker_number: str | None = None
    rtcm_id: str | None = None
    site_server: str | None = None
    last_update: str | None = None
    site_status_label: str | None = None
    catalog_status: str | None = None
    ntrip_verdict: str | None = None
    ntrip_probed_at: str | None = None


class CorsHealthOut(BaseModel):
    online: int
    degraded: int
    offline: int
    total: int


class StationStatusLogStatus(BaseModel):
    logging: bool
    poll_interval_sec: float
    api_reachable: bool
    event_count: int
    snapshot_count: int
    tracked_stations: int
    db_backend: str


class StationStatusEventOut(BaseModel):
    time: str
    station_code: str | None = None
    status: str
    previous_status: str | None = None
    event_type: str
    online_count: int | None = None
    degraded_count: int | None = None
    offline_count: int | None = None
    unknown_count: int | None = None
    api_reachable: bool = True
    message: str | None = None
    source: str | None = None


class StationUptimeRow(BaseModel):
    station_code: str
    station_name: str
    samples: int
    online_pct: float
    degraded_pct: float
    offline_pct: float
    unknown_pct: float


# ── Processing ─────────────────────────────────────────────────────────────────

class ProcessingSession(BaseModel):
    session_id: str
    status: str  # queued | running | done | error
    message: str = ""
    rows: int = 0


class TecSummaryRow(BaseModel):
    date: str
    mean_vtec: float | None = None
    max_vtec: float | None = None
    min_vtec: float | None = None
    daytime_mean_vtec: float | None = None
    samples: int | None = None
    storm_flag: bool | None = None
    kp_index: float | None = None


class TecHourlyRow(BaseModel):
    ut_hour: float
    mean_vtec: float | None = None
    max_vtec: float | None = None
    min_vtec: float | None = None
    days_used: int | None = None


class BiasRow(BaseModel):
    station: str
    mean_stec: float | None = None
    mean_vtec: float | None = None
    dcb_folder: str


class TecPlotPoint(BaseModel):
    x: float | None = None
    y: float | None = None


class TecPlotDataset(BaseModel):
    label: str
    points: list[TecPlotPoint]


class TecPlotSeries(BaseModel):
    datasets: list[TecPlotDataset] = []
    mean: list[TecPlotPoint] = []
    xlabel: str = "UT (hrs)"
    ylabel: str = "VTEC (TECU)"
    y_min: float = -25.0
    y_max: float = 75.0


# ── TEC Analysis ───────────────────────────────────────────────────────────────

class ArchiveMeta(BaseModel):
    available: bool = False
    stations: list[str] = []
    first_date: str | None = None
    last_date: str | None = None
    observations: int = 0
    source_files: int = 0
    total_rows: int = 0


class TecObservation(BaseModel):
    timestamp: str
    station: str
    vtec: float | None = None
    stec: float | None = None
    constellation: str | None = None
    prn: str | None = None
    elevation_deg: float | None = None


class AnomalyDay(BaseModel):
    date: str
    mean_vtec: float
    anomaly: bool
    threshold: float
    max_vtec: float | None = None
    tec_anomaly_flag: bool = False
    storm_flag: bool = False
    kp_storm_flag: bool = False
    kp: float | None = None
    dst: float | None = None
    kp_severity: str | None = None
    tec_response: str | None = None
    tec_response_z: float | None = None
    tec_deviation_tecu: float | None = None


class StormComparisonDoy(BaseModel):
    doy: int
    quiet_mean_vtec: float | None = None
    storm_mean_vtec: float | None = None


class EiaSummary(BaseModel):
    peak_hour_utc: int | None = None
    post_sunset_peak_hour_utc: int | None = None
    post_sunset_mean_vtec: float | None = None
    daytime_mean_vtec: float | None = None
    peak_season: str | None = None
    anomaly_day_count: int = 0
    storm_confirmed_count: int = 0


class GeomagneticDailyPoint(BaseModel):
    date: str
    kp: float | None = None
    dst: float | None = None


class AnomalyAnalysisResponse(BaseModel):
    days: list[AnomalyDay]
    storm_comparison: list[StormComparisonDoy]
    eia: EiaSummary
    stations: list[str]
    kp_available: bool
    dst_available: bool = False
    geomagnetic_daily: list[GeomagneticDailyPoint] = []
    diurnal: list["DiurnalPoint"] = []
    seasonal: list["SeasonalRow"] = []
    solar_cycle: list["SolarCycleRow"] = []


class DiurnalPoint(BaseModel):
    hour: int
    mean_vtec: float
    std_vtec: float


class SeasonalRow(BaseModel):
    season: str
    mean: float
    max: float
    min: float
    std: float


class SolarCycleRow(BaseModel):
    year: int
    mean_vtec: float
    max_vtec: float
    min_vtec: float


class OmniDailyPoint(BaseModel):
    date: str
    ssn: float | None = None
    kp: float | None = None
    kp_mean: float | None = None
    dst: float | None = None
    f107: float | None = None
    storm_flag: bool = False
    storm_class: str = "Quiet"
    mean_vtec: float | None = None


class OmniStormDay(BaseModel):
    date: str
    kp: float | None = None
    dst: float | None = None
    f107: float | None = None
    ssn: float | None = None
    storm_class: str
    mean_vtec: float | None = None


class OmniAnalysisResponse(BaseModel):
    source: str
    start_date: str | None = None
    end_date: str | None = None
    days: int = 0
    storm_days: int = 0
    max_kp: float | None = None
    min_dst: float | None = None
    mean_f107: float | None = None
    mean_vtec_storm: float | None = None
    mean_vtec_quiet: float | None = None
    series: list[OmniDailyPoint] = []
    storms: list[OmniStormDay] = []
    fetched_at: str | None = None


class CelestrakDailyPoint(BaseModel):
    date: str
    ssn: float | None = None
    kp: float | None = None
    kp_mean: float | None = None
    ap: float | None = None
    f107: float | None = None
    data_type: str | None = None
    storm_flag: bool = False
    storm_class: str = "Quiet"
    mean_vtec: float | None = None


class CelestrakStormDay(BaseModel):
    date: str
    kp: float | None = None
    ap: float | None = None
    f107: float | None = None
    ssn: float | None = None
    storm_class: str
    mean_vtec: float | None = None


class CelestrakAnalysisResponse(BaseModel):
    source: str
    start_date: str | None = None
    end_date: str | None = None
    days: int = 0
    storm_days: int = 0
    max_kp: float | None = None
    max_ap: float | None = None
    mean_f107: float | None = None
    mean_vtec_storm: float | None = None
    mean_vtec_quiet: float | None = None
    series: list[CelestrakDailyPoint] = []
    storms: list[CelestrakStormDay] = []
    fetched_at: str | None = None


class GfzKpDailyPoint(BaseModel):
    date: str
    kp: float | None = None
    kp_mean: float | None = None
    ap: float | None = None
    ap_daily: float | None = None
    cp: float | None = None
    storm_flag: bool = False
    storm_class: str = "Quiet"
    mean_vtec: float | None = None


class GfzKpStormDay(BaseModel):
    date: str
    kp: float | None = None
    ap: float | None = None
    cp: float | None = None
    storm_class: str
    mean_vtec: float | None = None


class GfzKpAnalysisResponse(BaseModel):
    source: str
    start_date: str | None = None
    end_date: str | None = None
    days: int = 0
    storm_days: int = 0
    max_kp: float | None = None
    max_ap: float | None = None
    mean_cp: float | None = None
    mean_vtec_storm: float | None = None
    mean_vtec_quiet: float | None = None
    series: list[GfzKpDailyPoint] = []
    storms: list[GfzKpStormDay] = []
    fetched_at: str | None = None


class WdcKyotoDailyPoint(BaseModel):
    date: str
    kp: float | None = None
    kp_mean: float | None = None
    ap: float | None = None
    ap_daily: float | None = None
    dst: float | None = None
    storm_flag: bool = False
    storm_class: str = "Quiet"
    mean_vtec: float | None = None


class WdcKyotoStormDay(BaseModel):
    date: str
    kp: float | None = None
    dst: float | None = None
    ap: float | None = None
    storm_class: str
    mean_vtec: float | None = None


class WdcKyotoAnalysisResponse(BaseModel):
    source: str
    start_date: str | None = None
    end_date: str | None = None
    days: int = 0
    storm_days: int = 0
    max_kp: float | None = None
    min_dst: float | None = None
    max_ap: float | None = None
    mean_vtec_storm: float | None = None
    mean_vtec_quiet: float | None = None
    series: list[WdcKyotoDailyPoint] = []
    storms: list[WdcKyotoStormDay] = []
    fetched_at: str | None = None


class IntermagnetDailyPoint(BaseModel):
    date: str
    mean_h: float | None = None
    range_h: float | None = None
    max_dbdt: float | None = None
    gic_est_a: float | None = None
    samples: int = 0
    storm_flag: bool = False
    storm_class: str = "Quiet"
    mean_vtec: float | None = None


class IntermagnetStormDay(BaseModel):
    date: str
    max_dbdt: float | None = None
    range_h: float | None = None
    gic_est_a: float | None = None
    storm_class: str
    mean_vtec: float | None = None


class IntermagnetAnalysisResponse(BaseModel):
    source: str
    observatory: str
    observatory_name: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    days: int = 0
    storm_days: int = 0
    max_dbdt: float | None = None
    max_range_h: float | None = None
    max_gic_est_a: float | None = None
    mean_vtec_storm: float | None = None
    mean_vtec_quiet: float | None = None
    series: list[IntermagnetDailyPoint] = []
    storms: list[IntermagnetStormDay] = []
    fetched_at: str | None = None


class PrnRow(BaseModel):
    prn: str
    constellation: str
    mean_vtec: float | None = None
    max_vtec: float | None = None
    mean_stec: float | None = None
    mean_elevation: float | None = None
    mean_qual: float | None = None
    samples: int | None = None


class PrnObservation(BaseModel):
    timestamp: str
    station: str
    prn: str
    constellation: str | None = None
    vtec: float | None = None
    stec: float | None = None
    elevation_deg: float | None = None
    azimuth_deg: float | None = None
    quality: float | None = None


class PrnMeta(BaseModel):
    source: str
    record_count: int = 0
    stations: list[str] = []
    prns: list[str] = []
    has_azimuth: bool = False
    has_elevation: bool = False
    has_quality: bool = False
    time_start: str | None = None
    time_end: str | None = None
    message: str | None = None


class PrnExplorerResponse(BaseModel):
    meta: PrnMeta
    summary: list[PrnRow]
    observations: list[PrnObservation]


class TecHeatmapStation(BaseModel):
    code: str
    name: str
    lat: float
    lon: float
    vtec: float
    obs_count: int = 0


class TecHeatmapPoint(BaseModel):
    lon: float
    lat: float
    vtec: float
    weight: float
    code: str | None = None


class TecHeatmapGrid(BaseModel):
    lons: list[list[float]]
    lats: list[list[float]]
    vtec: list[list[float | None]]


class TecHeatmapResponse(BaseModel):
    available: bool
    stations: list[TecHeatmapStation]
    heat_points: list[TecHeatmapPoint]
    grid: TecHeatmapGrid | None = None
    bounds: list[float]
    tec_min: float | None = None
    tec_max: float | None = None
    station_count: int = 0
    updated_at: str | None = None
    message: str | None = None
    data_quality: str = "none"
    icao_mod_tecu: float = 125.0
    icao_sev_tecu: float = 175.0


# ── Live Pipeline ──────────────────────────────────────────────────────────────

class LiveObservation(BaseModel):
    time: str
    station: str
    vtec_tecu: float | None = None
    stec_tecu: float | None = None
    elevation_deg: float | None = None
    constellation: str | None = None
    prn: str | None = None


class StationLiveStatus(BaseModel):
    code: str
    name: str
    lat: float
    lon: float
    latency_ms: float | None = None
    msg_rate: float | None = None
    stale: bool = True
    last_vtec: float | None = None


class LivePipelineStatus(BaseModel):
    ntrip_configured: bool = False
    active_streams: int = 0
    streams: dict[str, Any] = {}
    db_backend: str = "sqlite"
    record_count: int = 0
    recent_record_count_1h: int = 0
    runtime_mode: str = "persistent-process"
    ingest_enabled: bool = True
    message: str | None = None


class NtripProbeRow(BaseModel):
    station: str
    mountpoint: str
    tcp_ok: bool = False
    caster_ok: bool = False
    http_status: str | None = None
    bytes_received: int = 0
    rtcm_total: int = 0
    msm_count: int = 0
    rtcm_frames: int = 0
    msg_types: dict[str, int] = {}
    msm_types: dict[str, int] = {}
    first_msgs: list[int] = []
    verdict: str
    note: str = ""
    error: str | None = None


class NtripProbeSummary(BaseModel):
    total: int = 0
    msm_streaming: int = 0
    rtcm_no_msm: int = 0
    connected_no_data: int = 0
    offline: int = 0


class NtripProbeResponse(BaseModel):
    host: str | None = None
    port: int = 2101
    listen_sec: float = 6.0
    probed_at: str
    stations: list[NtripProbeRow] = []
    summary: NtripProbeSummary
    error: str | None = None


# ── Forecast ───────────────────────────────────────────────────────────────────

class ForecastStatus(BaseModel):
    torch_ok: bool
    model_exists: bool
    forecast_h: int
    seq_len: int
    path: str | None = None


class ForecastPoint(BaseModel):
    t: str
    predicted_vtec: float
    upper: float | None = None
    lower: float | None = None


class CnnGruTrainStatus(BaseModel):
    running: bool = False
    started_at: str | None = None
    epoch: int = 0
    total_epochs: int = 30
    last_loss: float | None = None
    error: str | None = None
    result: dict | None = None


# ── Navigation News ────────────────────────────────────────────────────────────

class NavigationNewsBriefOut(BaseModel):
    id: str
    icon: str
    title: str
    audience: str
    headline: str
    summary: str
    space_weather_today: str
    space_weather_bullets: list[str]
    bullets: list[str]
    action: str
    status_tone: str
    broadcast_script: str
    social_script: str
    channels: list[str]


class NavigationNewsBundleOut(BaseModel):
    computed_at: str
    last_updated_at: str
    next_update_at: str
    update_interval_hours: int = 4
    update_history: list[str] = []
    input_summary: str
    sources: dict[str, bool]
    briefs: list[NavigationNewsBriefOut]


class AiAudienceRecommendationOut(BaseModel):
    id: str
    label: str
    icon: str
    headline: str
    detail: str | None = None
    tone: str


class AiRecommendationsOut(BaseModel):
    recommendations: list[AiAudienceRecommendationOut]
    tone: str
    computed_at: str | None = None


class NavigationNewsScheduleOut(BaseModel):
    last_updated_at: str
    next_update_at: str
    update_interval_hours: int = 4
    updates_per_day: int = 6
    update_history: list[str] = []


class BroadcastRecipientOut(BaseModel):
    recipient_id: str
    recipient_type: str
    whatsapp_to: str
    display_name: str
    audience: str
    audience_role: str | None = None
    audience_title: str | None = None
    audience_description: str | None = None
    audience_icon: str | None = None
    script_kind: str = "broadcast"
    language: str = "en"
    language_label: str | None = None
    accessibility: str = "standard"
    accessibility_label: str | None = None
    active: bool = True
    notes: str | None = None
    created_at: str
    updated_at: str


class NavigationNewsAudienceRoleOut(BaseModel):
    id: str
    role: str
    title: str
    description: str
    icon: str


class DeliveryOptionOut(BaseModel):
    id: str
    label: str


class NavigationDeliveryOptionsOut(BaseModel):
    languages: list[DeliveryOptionOut]
    accessibility: list[DeliveryOptionOut]


class BroadcastRecipientCreate(BaseModel):
    recipient_type: str = Field(..., description="phone")
    whatsapp_to: str = Field(..., description="E.164 digits")
    display_name: str = Field(..., min_length=2, description="Contact name on the platform")
    audience: str = "citizen"
    script_kind: str = "broadcast"
    language: str = "en"
    accessibility: str = "standard"
    notes: str | None = None
    active: bool = True


class BroadcastRecipientUpdate(BaseModel):
    recipient_type: str | None = None
    whatsapp_to: str | None = None
    display_name: str | None = Field(None, min_length=2)
    audience: str | None = None
    script_kind: str | None = None
    language: str | None = None
    accessibility: str | None = None
    notes: str | None = None
    active: bool | None = None


class BroadcastDeliveryOut(BaseModel):
    delivery_id: str
    recipient_id: str | None = None
    display_name: str | None = None
    whatsapp_to: str | None = None
    audience: str | None = None
    ok: bool
    detail: str | None = None
    dry_run: bool = False
    sent_at: str


class NavigationFacebookStatusOut(BaseModel):
    enabled: bool
    configured: bool
    dry_run: bool
    page_id: str
    page_url: str


class NavigationBroadcastStatusOut(BaseModel):
    enabled: bool
    running: bool
    interval_hours: float
    last_broadcast_at: str | None = None
    next_broadcast_at: str | None = None
    active_recipient_count: int
    whatsapp_configured: bool
    dry_run: bool
    recent_deliveries: list[BroadcastDeliveryOut] = []
    facebook: NavigationFacebookStatusOut | None = None


class NavigationBroadcastOverviewOut(BaseModel):
    recipients: list[BroadcastRecipientOut]
    status: NavigationBroadcastStatusOut


class NavigationBroadcastRunOut(BaseModel):
    ok: bool
    skipped: bool = False
    reason: str | None = None
    recipient_count: int = 0
    dry_run: bool = False
    headline: str | None = None
    computed_at: str | None = None
    deliveries: list[dict] = []
    facebook: dict | None = None


class NavigationFacebookPostOut(BaseModel):
    ok: bool
    skipped: bool = False
    reason: str | None = None
    dry_run: bool = False
    page_id: str
    page_url: str
    detail: str | None = None
    message_preview: str | None = None
    message_length: int | None = None
    computed_at: str | None = None


# ── Chat ───────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatContextSummary(BaseModel):
    lines: list[str] = []
    tec: dict | None = None
    space_weather: dict | None = None
    ekf_alerts: dict | None = None
    live_pipeline: dict | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    api_key: str | None = None
    station: str | None = None


class ChatResponse(BaseModel):
    reply: str
    context_injected: bool = False
    context: ChatContextSummary | None = None
