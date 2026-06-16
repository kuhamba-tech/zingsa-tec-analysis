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
    samples: int | None = None


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
