from __future__ import annotations

import math
import time

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import CorsHealthOut, StationOut, StationStatusEventOut, StationStatusLogStatus, StationUptimeRow
from backend.station_status_logger import poll_and_log, status as station_log_status

router = APIRouter(prefix="/cors", tags=["cors"])

_STATIONS_CACHE_TTL_SEC = 45.0
_stations_cache: dict[str, object] = {"rows": None, "ts": 0.0}


def _stations_impl() -> list:
    from dataclasses import replace

    from backend.live_manager import status as live_status, get_db
    from zgiis.api.cors_client import fetch_station_health
    from zgiis.cors.site_details import enrich_station
    from zgiis.cors.stations import stations_for_map, stations_for_map_live

    try:
        health = fetch_station_health(country="Zimbabwe")
    except Exception:
        health = None

    stations = stations_for_map(health, require_live_telemetry=False)

    live_streams: dict = {}
    try:
        live = stations_for_map_live()
        live_by_code = {s.code.lower(): s for s in live}
        live_streams = live_status().get("streams") or {}
        stations = [
            replace(s, status="online", status_source="ntrip")
            if live_by_code.get(s.code.lower()) and live_by_code[s.code.lower()].status == "online"
            else s
            for s in stations
        ]
    except Exception:
        pass

    try:
        df = get_db().query_recent(hours=0.25)
    except Exception:
        df = None

    merged = []
    for station in stations:
        code = station.code.lower()
        stream = live_streams.get(code) if live_streams else None
        s = enrich_station(station, stream=stream)
        if df is not None and not df.empty and "station" in df.columns:
            latest = df.sort_values("time").groupby("station").tail(1).set_index("station")
            means = df.groupby("station")["vtec_tecu"].mean() if "vtec_tecu" in df.columns else {}
            if code in latest.index:
                current_tec = float(means.get(code, 0.0) or 0.0)
                s = replace(s, status="online", status_source="ntrip", current_tec=round(current_tec, 2))
                s = enrich_station(s, stream=stream)
        merged.append(s)
    return merged


def _stations() -> list:
    now = time.monotonic()
    cached = _stations_cache.get("rows")
    if cached is not None and (now - float(_stations_cache["ts"])) < _STATIONS_CACHE_TTL_SEC:
        return cached  # type: ignore[return-value]
    rows = _stations_impl()
    _stations_cache["rows"] = rows
    _stations_cache["ts"] = now
    return rows


def _station_out(s) -> StationOut:
    return StationOut(
        code=s.code,
        name=s.name,
        lat=s.lat,
        lon=s.lon,
        status=s.status,
        status_source=getattr(s, "status_source", "unknown"),
        constellations=list(s.constellations) if s.constellations else [],
        current_tec=s.current_tec,
        height_m=getattr(s, "height_m", None),
        mountpoint=getattr(s, "mountpoint", None) or None,
        marker_name=getattr(s, "marker_name", None) or None,
        marker_number=getattr(s, "marker_number", None) or None,
        rtcm_id=getattr(s, "rtcm_id", None) or None,
        site_server=getattr(s, "site_server", None) or None,
        last_update=getattr(s, "last_update", None) or None,
        site_status_label=getattr(s, "site_status_label", None) or None,
    )


@router.get("/stations", response_model=list[StationOut])
async def stations(_=Depends(require_api_key)):
    poll_and_log(source="cors_stations", force=False)
    return [_station_out(s) for s in _stations()]


@router.get("/stations/{code}", response_model=StationOut)
async def station_detail(code: str, _=Depends(require_api_key)):
    match = next((s for s in _stations() if s.code == code.lower()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Station '{code}' not found")
    return _station_out(match)


@router.get("/health", response_model=CorsHealthOut)
async def health(_=Depends(require_api_key)):
    poll_and_log(source="cors_health", force=False)
    all_s = _stations()
    online = sum(1 for s in all_s if s.status == "online")
    degraded = sum(1 for s in all_s if s.status == "degraded")
    offline = sum(1 for s in all_s if s.status == "offline")
    return CorsHealthOut(online=online, degraded=degraded, offline=offline, total=len(all_s))


@router.get("/status/log", response_model=StationStatusLogStatus)
async def status_log(_=Depends(require_api_key)):
    return StationStatusLogStatus(**station_log_status())


@router.get("/status/events", response_model=list[StationStatusEventOut])
async def status_events(
    hours: float = 168.0,
    station: str | None = None,
    event_type: str | None = None,
    limit: int = 500,
    _=Depends(require_api_key),
):
    from backend.station_status_logger import get_db

    df = get_db().query_events(
        hours=hours,
        station_code=station,
        event_type=event_type,
        limit=limit,
    )
    if df.empty:
        return []
    rows: list[StationStatusEventOut] = []
    for _, r in df.iterrows():
        t = r["time"]
        rows.append(
            StationStatusEventOut(
                time=t.isoformat() if hasattr(t, "isoformat") else str(t),
                station_code=r.get("station_code") if _is_present(r.get("station_code")) else None,
                status=str(r["status"]),
                previous_status=(
                    str(r["previous_status"])
                    if _is_present(r.get("previous_status")) else None
                ),
                event_type=str(r["event_type"]),
                online_count=_int_or_none(r.get("online_count")),
                degraded_count=_int_or_none(r.get("degraded_count")),
                offline_count=_int_or_none(r.get("offline_count")),
                unknown_count=_int_or_none(r.get("unknown_count")),
                api_reachable=bool(r.get("api_reachable")),
                message=str(r["message"]) if _is_present(r.get("message")) else None,
                source=str(r["source"]) if _is_present(r.get("source")) else None,
            )
        )
    return rows


@router.get("/status/uptime", response_model=list[StationUptimeRow])
async def status_uptime(hours: float = 168.0, _=Depends(require_api_key)):
    from backend.station_status_logger import get_db

    return [StationUptimeRow(**row) for row in get_db().uptime_summary(hours=hours)]


def _int_or_none(value: object) -> int | None:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_present(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return True
