from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import CorsHealthOut, StationOut, StationStatusEventOut, StationStatusLogStatus, StationUptimeRow
from backend.station_status_logger import poll_and_log, status as station_log_status

router = APIRouter(prefix="/cors", tags=["cors"])


def _stations() -> list:
    from zgiis.cors.stations import stations_for_map_live
    return stations_for_map_live()


@router.get("/stations", response_model=list[StationOut])
async def stations(_=Depends(require_api_key)):
    poll_and_log(source="cors_stations", force=False)
    return [
        StationOut(
            code=s.code,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            status=s.status,
            constellations=list(s.constellations) if s.constellations else [],
            current_tec=s.current_tec,
            height_m=getattr(s, "height_m", None),
        )
        for s in _stations()
    ]


@router.get("/stations/{code}", response_model=StationOut)
async def station_detail(code: str, _=Depends(require_api_key)):
    match = next((s for s in _stations() if s.code == code.lower()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Station '{code}' not found")
    return StationOut(
        code=match.code,
        name=match.name,
        lat=match.lat,
        lon=match.lon,
        status=match.status,
        constellations=list(match.constellations) if match.constellations else [],
        current_tec=match.current_tec,
        height_m=getattr(match, "height_m", None),
    )


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
