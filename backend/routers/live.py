from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from backend.deps import require_api_key
from backend.schemas import LiveObservation, LivePipelineStatus, StationLiveStatus

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
    from zgiis.cors.stations import stations_for_map
    mon = _monitor()
    stations = stations_for_map()
    result = []
    for s in stations:
        lat_ms = None
        msg_rt = None
        stale = True
        if mon:
            try:
                stats = mon.latency(s.code)
                lat_ms = stats.get("mean_ms")
                msg_rt = mon.msg_rate(s.code)
                stale = mon.is_stale(s.code)
            except Exception:
                pass
        result.append(StationLiveStatus(
            code=s.code,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            latency_ms=lat_ms,
            msg_rate=msg_rt,
            stale=stale,
            last_vtec=s.current_tec,
        ))
    return result


@router.get("/pipeline-status", response_model=LivePipelineStatus)
async def pipeline_status(_=Depends(require_api_key)):
    from backend.live_manager import status as live_status
    s = live_status()
    db = _db()
    try:
        record_count = db.record_count() if db else 0
    except Exception:
        record_count = 0
    return LivePipelineStatus(
        ntrip_configured=s["configured"],
        active_streams=s["active_streams"],
        streams=s["streams"],
        db_backend=s["db_backend"],
        record_count=record_count,
    )


@router.websocket("/stream")
async def live_stream(ws: WebSocket):
    await ws.accept()
    db = _db()
    try:
        last_count = 0
        while True:
            if db:
                try:
                    df = db.query_recent(hours=0.1)
                    if not df.empty and len(df) != last_count:
                        last_count = len(df)
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
