from __future__ import annotations

import asyncio
import json

import pandas as pd
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from backend.deps import require_api_key
from backend.schemas import (
    LiveObservation,
    LivePipelineStatus,
    LiveStationVtecPoint,
    LiveStationVtecSeries,
    NtripProbeResponse,
    StationLiveStatus,
)

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


@router.get("/vtec-by-station", response_model=list[LiveStationVtecSeries])
async def live_vtec_by_station(
    hours: float = Query(6.0, ge=0.5, le=48),
    resample_minutes: int = Query(2, ge=1, le=30),
    _=Depends(require_api_key),
):
    """Binned mean/median live VTEC vs time for every Zimbabwe CORS station.

    Used by the National Dashboard / TEC heat-map pages so operators can verify
    station VTEC against the map snapshot. Prefers absolute code TEC when present.
    """
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    from zgiis.maps.heatmap_data import _absolute_vtec_observation_frame

    catalog = {
        s.code.lower().rstrip("_"): s
        for s in ZIMBABWE_CORS_STATIONS
    }
    empty = [
        LiveStationVtecSeries(station=code, name=station.name, points=[])
        for code, station in sorted(catalog.items(), key=lambda item: item[0])
    ]

    db = _db()
    if db is None:
        return empty
    try:
        df = db.query_recent(hours=hours)
        if df is None or getattr(df, "empty", True):
            return empty
        df = _absolute_vtec_observation_frame(df)
        if df is None or getattr(df, "empty", True):
            return empty
        if "station" not in df.columns or "vtec_tecu" not in df.columns or "time" not in df.columns:
            return empty

        work = df.copy()
        work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
        work["time"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
        work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
        work = work.dropna(subset=["time", "vtec_tecu"])
        work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 200)]
        if work.empty:
            return empty

        rule = f"{int(resample_minutes)}min"
        series_by_code: dict[str, LiveStationVtecSeries] = {
            code: LiveStationVtecSeries(station=code, name=station.name, points=[])
            for code, station in catalog.items()
        }

        for code, group in work.groupby("station"):
            key = str(code).lower().rstrip("_")
            if key not in series_by_code:
                continue
            # Median per bin is less sensitive to PRN/code-TEC spikes than mean.
            binned = (
                group.set_index("time")["vtec_tecu"]
                .resample(rule)
                .agg(["median", "count"])
                .dropna(subset=["median"])
            )
            if binned.empty:
                continue
            points = [
                LiveStationVtecPoint(
                    time=idx.isoformat().replace("+00:00", "Z"),
                    vtec_tecu=round(float(row["median"]), 2),
                    obs_count=int(row["count"]),
                )
                for idx, row in binned.iterrows()
                if float(row["median"]) > 0
            ]
            values = [p.vtec_tecu for p in points]
            series_by_code[key] = LiveStationVtecSeries(
                station=key,
                name=series_by_code[key].name,
                points=points,
                latest_vtec=values[-1] if values else None,
                mean_vtec=round(sum(values) / len(values), 2) if values else None,
            )

        return [series_by_code[code] for code in sorted(series_by_code)]
    except Exception:
        return empty


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
