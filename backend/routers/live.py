from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from backend.deps import require_api_key
from backend.schemas import (
    LiveObservation,
    LivePipelineStatus,
    LiveStationVtecPoint,
    LiveStationVtecSeries,
    LiveVtecHealth,
    LiveVtecStationHealth,
    NtripProbeResponse,
    StationLiveStatus,
    TecMethodComparisonResponse,
    TecMethodInfo,
    TecMethodReference,
)

router = APIRouter(prefix="/live", tags=["live"])
log = logging.getLogger(__name__)

_VTEC_BY_STATION_CACHE: dict[tuple[float, int], tuple[float, list[LiveStationVtecSeries]]] = {}
_VTEC_BY_STATION_CACHE_TTL_S = 75.0


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


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None  # NaN check


def _safe_str(value) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    return text or None


def _build_live_vtec(
    *,
    hours: float,
    station: str | None,
    limit: int,
    enrich_geometry: bool,
) -> list[LiveObservation]:
    """Sync builder — run via asyncio.to_thread so look-angle math cannot stall the event loop."""
    db = _db()
    if db is None:
        return []
    try:
        df = db.query_recent(hours=hours, station=station)
        if df is None or getattr(df, "empty", True):
            return []
        if "tec_method" in df.columns:
            method = df["tec_method"].astype(str)
            # Keep live pipeline decode only (code_live / phase_only_live*).
            live_mask = method.str.contains("live", case=False, na=False) & ~method.str.startswith("dlr_")
            # Also drop anything that looks like archive/post-process.
            live_mask &= ~method.str.contains("archive|rinex|cmn", case=False, na=False)
            if bool(live_mask.any()):
                df = df.loc[live_mask]
            else:
                return []
        # Evenly subsample so elevation / constellation charts stay responsive.
        if len(df) > limit:
            step = max(1, len(df) // limit)
            df = df.iloc[::step].head(limit)

        nav = None
        if enrich_geometry:
            try:
                from backend.live_manager import get_nav_cache
                nav = get_nav_cache()
            except Exception:
                nav = None

        look_cache: dict[tuple[str, str, int], tuple[float, float] | None] = {}
        cols = set(df.columns)
        has_elev = "elevation_deg" in cols
        has_vtec = "vtec_tecu" in cols
        has_stec = "stec_tecu" in cols
        has_const = "constellation" in cols
        has_prn = "prn" in cols
        has_station = "station" in cols
        has_time = "time" in cols

        result: list[LiveObservation] = []
        for row in df.itertuples(index=False):
            elev = _safe_float(getattr(row, "elevation_deg", None)) if has_elev else None
            az = None
            prn = _safe_str(getattr(row, "prn", None)) if has_prn else None
            stn = _safe_str(getattr(row, "station", None)) if has_station else None
            time_raw = getattr(row, "time", "") if has_time else ""
            if nav is not None and prn and stn:
                try:
                    epoch = datetime.fromisoformat(str(time_raw).replace("Z", "+00:00"))
                    bucket = int(epoch.timestamp() // 60)
                except Exception:
                    epoch = None
                    bucket = -1
                cache_key = (stn.lower(), prn.upper(), bucket)
                if cache_key in look_cache:
                    look = look_cache[cache_key]
                else:
                    look = nav.look_angles(stn, prn, epoch)
                    look_cache[cache_key] = look
                if look is not None:
                    if elev is None:
                        elev = look[0]
                    az = look[1]
            result.append(
                LiveObservation(
                    time=str(time_raw or ""),
                    station=stn or "",
                    vtec_tecu=_safe_float(getattr(row, "vtec_tecu", None)) if has_vtec else None,
                    stec_tecu=_safe_float(getattr(row, "stec_tecu", None)) if has_stec else None,
                    elevation_deg=elev,
                    azimuth_deg=az,
                    constellation=_safe_str(getattr(row, "constellation", None)) if has_const else None,
                    prn=prn,
                    tec_method=_safe_str(getattr(row, "tec_method", None)) if "tec_method" in cols else "gopi_live",
                    bias_method=_safe_str(getattr(row, "bias_method", None)) if "bias_method" in cols else None,
                )
            )
        return result
    except Exception:
        log.exception("live vtec build failed")
        return []


@router.get("/vtec", response_model=list[LiveObservation])
async def live_vtec(
    hours: float = Query(2.0, ge=0.1, le=48),
    station: str | None = Query(None),
    limit: int = Query(2500, ge=100, le=20000),
    enrich_geometry: bool = Query(True),
    _=Depends(require_api_key),
):
    """Live NTRIP VTEC only — DLR Global TEC and RINEX archive rows are excluded."""
    return await asyncio.to_thread(
        _build_live_vtec,
        hours=hours,
        station=station,
        limit=limit,
        enrich_geometry=enrich_geometry,
    )


def _build_tec_method_comparison(
    *,
    hours: float,
    station: str | None,
    limit: int,
) -> TecMethodComparisonResponse:
    from zgiis.processing.gg_calibration import (
        calibrate_gg_from_observations,
        method_catalog,
        references,
        try_pytecgg_available,
    )

    gopi_rows = _build_live_vtec(
        hours=hours,
        station=station,
        limit=limit,
        enrich_geometry=True,
    )
    # Tag as GOPI for comparison UI even when DB method strings vary.
    gopi: list[LiveObservation] = []
    for obs in gopi_rows:
        gopi.append(
            obs.model_copy(
                update={
                    "tec_method": obs.tec_method or "gopi_live",
                    "bias_method": obs.bias_method or "gopi_seemala_or_live_code",
                }
            )
        )

    gg_raw = calibrate_gg_from_observations(
        [
            {
                "time": o.time,
                "station": o.station,
                "prn": o.prn,
                "constellation": o.constellation,
                "elevation_deg": o.elevation_deg,
                "azimuth_deg": o.azimuth_deg,
                "stec_tecu": o.stec_tecu,
                "vtec_tecu": o.vtec_tecu,
            }
            for o in gopi
        ]
    )
    gg = [
        LiveObservation(
            time=str(r.get("time") or ""),
            station=str(r.get("station") or ""),
            vtec_tecu=r.get("vtec_tecu"),
            stec_tecu=r.get("stec_tecu"),
            elevation_deg=r.get("elevation_deg"),
            azimuth_deg=r.get("azimuth_deg"),
            constellation=r.get("constellation"),
            prn=r.get("prn"),
            tec_method=str(r.get("tec_method") or "gg_ciraolo_window_ls"),
            bias_method=str(r.get("bias_method") or "gg_arc_bias_lt_poly"),
            arc_bias_tecu=r.get("arc_bias_tecu"),
        )
        for r in gg_raw
    ]

    engine = "pytecgg" if try_pytecgg_available() else "gg_window_ls_fallback"
    note = (
        "GOPI series are live CORS dual-frequency TEC (Seemala/Gopi path). "
        "Gg series re-calibrate the same samples with Ciraolo/Cesaroni-style "
        f"arc-bias + local-time polynomial least squares ({engine}). "
        "Full-day RINEX PyTECGg remains available for offline processing sessions."
    )
    return TecMethodComparisonResponse(
        available=bool(gopi),
        hours=hours,
        sample_limit=limit,
        gopi=gopi,
        gg=gg,
        methods=[TecMethodInfo(**m) for m in method_catalog()],
        references=[TecMethodReference(**r) for r in references()],
        note=note,
    )


@router.get("/tec-method-comparison", response_model=TecMethodComparisonResponse)
async def tec_method_comparison(
    hours: float = Query(6.0, ge=0.5, le=48),
    station: str | None = Query(None),
    limit: int = Query(2500, ge=100, le=10000),
    _=Depends(require_api_key),
):
    """Compare GOPI / Seemala live TEC with Gg (Ciraolo–Cesaroni) calibration.

    Same underlying CORS samples; Gg applies arc-bias + windowed VTEC polynomial
    calibration so differences reflect calibration method, not a different network.
    """
    return await asyncio.to_thread(
        _build_tec_method_comparison,
        hours=hours,
        station=station,
        limit=limit,
    )


@router.get("/vtec-by-station", response_model=list[LiveStationVtecSeries])
async def live_vtec_by_station(
    hours: float = Query(6.0, ge=0.5, le=48),
    resample_minutes: int = Query(2, ge=1, le=30),
    _=Depends(require_api_key),
):
    """Binned live NTRIP VTEC vs time for every Zimbabwe CORS station.

    Used by the National Dashboard / TEC heat-map pages so operators can verify
    station VTEC against the map snapshot. Prefers absolute code TEC
    (``code_live`` from the NTRIP pipeline). Aggregation stays in SQL so
    continuous ingest cannot stall the chart endpoint.
    """
    cache_key = (float(hours), int(resample_minutes))
    now = time.time()
    cached = _VTEC_BY_STATION_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _VTEC_BY_STATION_CACHE_TTL_S:
        return cached[1]

    result = await asyncio.to_thread(
        _build_live_vtec_by_station,
        hours=hours,
        resample_minutes=resample_minutes,
    )
    _VTEC_BY_STATION_CACHE[cache_key] = (now, result)
    return result


def _build_live_vtec_by_station(
    *,
    hours: float,
    resample_minutes: int,
) -> list[LiveStationVtecSeries]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

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
        df = db.station_vtec_timeseries_binned(
            hours=hours,
            resample_minutes=resample_minutes,
            code_live_only=True,
        )
        if df is None or getattr(df, "empty", True):
            return empty
        if "station" not in df.columns or "bucket" not in df.columns or "vtec_tecu" not in df.columns:
            return empty

        work = df.copy()
        work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
        work["bucket"] = pd.to_datetime(work["bucket"], utc=True, errors="coerce")
        work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
        work["obs_count"] = pd.to_numeric(work.get("obs_count"), errors="coerce").fillna(0)
        work = work.dropna(subset=["bucket", "vtec_tecu"])
        work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 200)]
        if work.empty:
            return empty

        series_by_code: dict[str, LiveStationVtecSeries] = {
            code: LiveStationVtecSeries(station=code, name=station.name, points=[])
            for code, station in catalog.items()
        }

        for code, group in work.groupby("station"):
            key = str(code).lower().rstrip("_")
            if key not in series_by_code:
                continue
            group = group.sort_values("bucket")
            points = [
                LiveStationVtecPoint(
                    time=idx.isoformat().replace("+00:00", "Z"),
                    vtec_tecu=round(float(vtec), 2),
                    obs_count=int(obs),
                )
                for idx, vtec, obs in zip(
                    group["bucket"],
                    group["vtec_tecu"],
                    group["obs_count"],
                )
                if float(vtec) > 0
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
        log.exception("live vtec-by-station build failed")
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
        # Operational station state is live only inside the same 90-second
        # freshness window used for NTRIP stream status. Older DB rows are
        # historical data and must not keep a marker/value looking current.
        df = db.query_recent(hours=90.0 / 3600.0) if db else None
        if df is not None and not df.empty and "station" in df.columns:
            # Keep only live NTRIP decode; exclude DLR, RINEX, CMN and archive.
            if "tec_method" in df.columns:
                method = df["tec_method"].astype(str)
                live_mask = method.str.contains("live", case=False, na=False)
                live_mask &= ~method.str.contains("dlr|archive|rinex|cmn", case=False, na=False)
                df = df[live_mask]
            if "time" in df.columns:
                observed_at = pd.to_datetime(df["time"], utc=True, errors="coerce")
                cutoff = datetime.now(timezone.utc) - timedelta(seconds=90)
                df = df[observed_at >= cutoff]
            if not df.empty:
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
        # A TCP connection without a recent decoded MSM message is not live
        # station data. Keep it stale and do not expose a cached TEC value.
        if stale:
            last_vtec = None
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


@router.get("/vtec-health", response_model=LiveVtecHealth)
async def live_vtec_health(_=Depends(require_api_key)):
    """Operational live VTEC health for dashboard banners and diagnostics."""
    from zgiis.live.vtec_health import build_live_vtec_health

    payload = await asyncio.to_thread(build_live_vtec_health)
    return LiveVtecHealth(
        **{
            **payload,
            "stations": [LiveVtecStationHealth(**row) for row in payload.get("stations") or []],
        }
    )


@router.get("/pipeline-status", response_model=LivePipelineStatus)
async def pipeline_status(_=Depends(require_api_key)):
    import os

    from backend.live_manager import status as live_status
    # Skip full-table COUNT(*) — under continuous NTRIP ingest that scans
    # millions of SQLite rows and stalls every dashboard poll.
    s = live_status(include_record_counts=False)
    db = _db()
    record_count = 0
    recent_record_count_1h = int(s.get("recent_vtec_records_1h") or 0)
    db_backend = s.get("db_backend") or "sqlite"
    if db_backend == "unknown":
        db_backend = "sqlite"
    try:
        if db:
            db_backend = db.backend
    except Exception:
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
