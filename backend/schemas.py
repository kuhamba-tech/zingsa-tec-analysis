from __future__ import annotations

from typing import Any

from pydantic import BaseModel


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


# ── CORS Network ───────────────────────────────────────────────────────────────

class StationOut(BaseModel):
    code: str
    name: str
    lat: float
    lon: float
    status: str
    constellations: list[str] = []
    current_tec: float | None = None
    height_m: float | None = None


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


class PrnRow(BaseModel):
    prn: str
    constellation: str
    mean_vtec: float | None = None
    max_vtec: float | None = None
    mean_stec: float | None = None
    mean_elevation: float | None = None
    mean_qual: float | None = None
    samples: int | None = None


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


# ── Chat ───────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    api_key: str | None = None


class ChatResponse(BaseModel):
    reply: str
    context_injected: bool = False
