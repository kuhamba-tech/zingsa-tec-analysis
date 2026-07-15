from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from backend.deps import require_api_key
from backend.schemas import LiveObservation, LivePipelineStatus, NtripProbeResponse, StationLiveStatus

router = APIRouter(prefix="/live", tags=["live"])


def _db():
    try:
        from backend.live_manager import get_db
        return get_db()
    except Exception:
        return None


def _monitor():
    try:
        from backend.live_manager import get_monitor
        return get_monitor()
    except Exception:
        return None


@router.get("/vtec", response_model=list[LiveObservation])
async def live_vtec(
    hours: float = Query(2.0, ge=0.1, le=48),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    db = _db()
    if db is None:
        return []
    try:
        df = db.query_recent(hours=hours, station=station)
        if df.empty:
            return []
        result = []
        for _, row in df.iterrows():
            result.append(LiveObservation(
                time=str(row.get("time", "")),
                station=str(row.get("station", "")),
                vtec_tecu=float(row["vtec_tecu"]) if "vtec_tecu" in row else None,
                stec_tecu=float(row["stec_tecu"]) if "stec_tecu" in row else None,
                elevation_deg=float(row["elevation_deg"]) if "elevation_deg" in row else None,
                constellation=str(row["constellation"]) if "constellation" in row else None,
                prn=str(row["prn"]) if "prn" in row else None,
            ))
        return result
    except Exception:
        return []


@router.get("/stations", response_model=list[StationLiveStatus])
async def live_stations(_=Depends(require_api_key)):
    from backend.live_manager import status as live_status
    from zgiis.cors.stations import stations_for_map_live
    live = live_status()
    streams = live.get("streams") or {}
    mon = _monitor()
    stations = stations_for_map_live(streams)
    latest_by_station: dict = {}
    mean_by_station: dict = {}
    db = _db()
    try:
        df = db.query_recent(hours=0.25) if db else None
        if df is not None and not df.empty and "station" in df.columns:
            latest = df.sort_values("time").groupby("station").tail(1).set_index("station")
            latest_by_station = latest.to_dict(orient="index")
            if "vtec_tecu" in df.columns:
                mean_by_station = df.groupby("station")["vtec_tecu"].mean().to_dict()
    except Exception:
        latest_by_station = {}
        mean_by_station = {}

    result = []
    for s in stations:
        lat_ms = None
        msg_rt = None
        stale = True
        last_vtec = s.current_tec if s.current_tec else None
        code = s.code.lower()
        stream = streams.get(code)
        if mon:
            try:
                stats = mon.latency(code)
                lat_ms = stats.get("mean_ms")
                msg_rt = mon.msg_rate(code)
                stale = mon.is_stale(code)
            except Exception:
                pass
        if code in latest_by_station:
            stale = False
            last_vtec = float(mean_by_station.get(code, latest_by_station[code].get("vtec_tecu") or 0.0))
        elif stream and stream.get("connected"):
            stale = False
        result.append(StationLiveStatus(
            code=s.code,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            latency_ms=lat_ms,
            msg_rate=msg_rt,
            stale=stale,
            last_vtec=last_vtec,
        ))
    return result


@router.get("/pipeline-status", response_model=LivePipelineStatus)
async def pipeline_status(_=Depends(require_api_key)):
    import os

    from backend.live_manager import status as live_status
    s = live_status()
    db = _db()
    record_count = 0
    recent_record_count_1h = int(s.get("recent_vtec_records_1h") or 0)
    db_backend = s.get("db_backend") or "sqlite"
    if db_backend == "unknown":
        db_backend = "sqlite"
    try:
        if db:
            db_backend = db.backend
            record_count = db.record_count()
            if not recent_record_count_1h:
                recent_record_count_1h = db.record_count(hours=1.0)
    except Exception:
        record_count = 0
        if db_backend == "unknown":
            db_backend = "timescaledb" if os.getenv("TSDB_DSN") else "sqlite"
    return LivePipelineStatus(
        ntrip_configured=s["configured"],
        active_streams=s["active_streams"],
        streams=s["streams"],
        db_backend=db_backend,
        db_env_key=s.get("db_env_key"),
        db_host_kind=s.get("db_host_kind", "sqlite"),
        record_count=record_count,
        recent_record_count_1h=recent_record_count_1h,
        diagnostics=s.get("diagnostics") or {},
        runtime_mode=s.get("runtime_mode", "persistent-process"),
        ingest_enabled=bool(s.get("ingest_enabled", True)),
        message=s.get("message"),
    )


@router.get("/ntrip-status", response_model=NtripProbeResponse)
async def ntrip_status(
    refresh: bool = Query(False),
    listen_sec: float = Query(4.0, ge=2.0, le=12.0),
    _=Depends(require_api_key),
):
    """Cached live NTRIP probe — real caster TCP/RTCM decode, refreshed every ~2 min."""
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

    payload = get_cached_ntrip_probe(refresh=refresh, listen_sec=listen_sec)
    return NtripProbeResponse(**payload)


@router.post("/ntrip-probe", response_model=NtripProbeResponse)
async def ntrip_probe(
    listen_sec: float = Query(6.0, ge=2.0, le=20.0),
    _=Depends(require_api_key),
):
    """Probe each configured NTRIP mountpoint without stopping the live collector."""
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

    payload = get_cached_ntrip_probe(refresh=True, listen_sec=listen_sec)
    return NtripProbeResponse(**payload)


@router.websocket("/stream")
async def live_stream(ws: WebSocket):
    await ws.accept()
    db = _db()
    try:
        last_latest_time: str | None = None
        while True:
            if db:
                try:
                    df = db.query_recent(hours=0.1)
                    if not df.empty:
                        latest_time = str(df["time"].max())
                        if latest_time != last_latest_time:
                            last_latest_time = latest_time
                            latest = df.tail(10)
                            rows = []
                            for _, row in latest.iterrows():
                                rows.append({
                                    "time": str(row.get("time", "")),
                                    "station": str(row.get("station", "")),
                                    "vtec_tecu": float(row["vtec_tecu"]) if "vtec_tecu" in row else None,
                                })
                            await ws.send_text(json.dumps(rows))
                except Exception:
                    pass
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
