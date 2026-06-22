from __future__ import annotations

import math
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import CorsHealthOut, StationOut, StationStatusEventOut, StationStatusLogStatus, StationUptimeRow
from backend.station_status_logger import poll_and_log, status as station_log_status

router = APIRouter(prefix="/cors", tags=["cors"])
log = logging.getLogger(__name__)

_STATIONS_CACHE_TTL_SEC = 45.0
_stations_cache: dict[str, object] = {"rows": None, "ts": 0.0}


def _merge_live_station_statuses(stations: list, live_stations: list) -> list:
    """Overlay every live NTRIP state, not only the online state."""
    from dataclasses import replace

    live_by_code = {s.code.lower().rstrip("_"): s for s in live_stations}
    merged = []
    for station in stations:
        live = live_by_code.get(station.code.lower().rstrip("_"))
        if live is None:
            merged.append(replace(station, status="offline", status_source="ntrip"))
        else:
            merged.append(replace(station, status=live.status, status_source=live.status_source))
    return merged


def _stations_impl(*, refresh_ntrip: bool = False) -> list:
    from dataclasses import replace

    from backend.live_manager import status as live_status, get_db
    from zgiis.api.cors_client import fetch_station_health
    from zgiis.cors.site_details import enrich_station, enrich_station_from_probe
    from zgiis.cors.stations import derive_status_from_stream, stations_for_map, stations_for_map_live
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe, probe_rows_by_station

    try:
        health = fetch_station_health(country="Zimbabwe")
    except Exception:
        health = None

    stations = stations_for_map(health, require_live_telemetry=False)

    live_streams: dict = {}
    pipeline_configured = False
    try:
        mgr = live_status()
        live_streams = mgr.get("streams") or {}
        pipeline_configured = bool(mgr.get("configured") or live_streams)
        if pipeline_configured:
            live = stations_for_map_live(live_streams)
            stations = _merge_live_station_statuses(stations, live)
    except Exception:
        log.exception("Failed to merge live NTRIP station states")

    probe_payload = None
    probe_by: dict = {}
    if not pipeline_configured:
        try:
            probe_payload = get_cached_ntrip_probe(refresh=refresh_ntrip, listen_sec=4.0)
            if not probe_payload.get("error"):
                probe_by = probe_rows_by_station(probe_payload)
        except Exception:
            probe_payload = None
            probe_by = {}

    try:
        df = get_db().query_recent(hours=0.25)
    except Exception:
        df = None

    probed_at = str(probe_payload.get("probed_at") or "") if probe_payload else ""
    merged = []
    for station in stations:
        code = station.code.lower()
        stream = live_streams.get(code) if live_streams else None
        s = enrich_station(station, stream=stream)
        if pipeline_configured:
            s = replace(s, status=derive_status_from_stream(stream), status_source="ntrip")
        if code in probe_by:
            s = enrich_station_from_probe(s, probe_by[code], probed_at=probed_at or None)
        elif df is not None and not df.empty and "station" in df.columns:
            latest = df.sort_values("time").groupby("station").tail(1).set_index("station")
            means = df.groupby("station")["vtec_tecu"].mean() if "vtec_tecu" in df.columns else {}
            if code in latest.index:
                current_tec = float(means.get(code, 0.0) or 0.0)
                s = replace(s, status="online", status_source="ntrip", current_tec=round(current_tec, 2))
                s = enrich_station(s, stream=stream)
        merged.append(s)
    return merged


def _stations(*, refresh_ntrip: bool = False) -> list:
    now = time.monotonic()
    cached = _stations_cache.get("rows")
    cache_key = f"ntrip:{refresh_ntrip}"
    if (
        cached is not None
        and (now - float(_stations_cache["ts"])) < _STATIONS_CACHE_TTL_SEC
        and _stations_cache.get("key") == cache_key
    ):
        return cached  # type: ignore[return-value]
    rows = _stations_impl(refresh_ntrip=refresh_ntrip)
    _stations_cache["rows"] = rows
    _stations_cache["ts"] = now
    _stations_cache["key"] = cache_key
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
        catalog_status=getattr(s, "catalog_status", None) or None,
        ntrip_verdict=getattr(s, "ntrip_verdict", None) or None,
        ntrip_probed_at=getattr(s, "ntrip_probed_at", None) or None,
    )


@router.get("/stations", response_model=list[StationOut])
async def stations(
    refresh_ntrip: bool = Query(False),
    _=Depends(require_api_key),
):
    poll_and_log(source="cors_stations", force=False)
    return [_station_out(s) for s in _stations(refresh_ntrip=refresh_ntrip)]


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
