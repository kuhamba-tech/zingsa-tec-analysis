from __future__ import annotations

import math
import logging
import os
import threading
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import (
    CorsHealthOut,
    RoverClientsOut,
    StationOut,
    StationStatusEventOut,
    StationStatusLogStatus,
    StationUptimeAnalysis,
    StationUptimeRow,
    StationUptimeTimelinePoint,
)
from backend.station_status_logger import poll_and_log, status as station_log_status

router = APIRouter(prefix="/cors", tags=["cors"])
log = logging.getLogger(__name__)

_STATIONS_CACHE_TTL_SEC = 45.0
# Live pipeline status changes every few seconds. A long TTL kept markers
# stale after streams went online/offline.
_STATIONS_LIVE_CACHE_TTL_SEC = 5.0
_stations_cache: dict[str, object] = {"rows": None, "ts": 0.0, "key": None}


def _is_serverless_runtime() -> bool:
    """Whether this request is running in deployment compute, not the collector."""
    return any(
        os.getenv(name)
        for name in ("VERCEL", "VERCEL_ENV", "VERCEL_URL", "AWS_LAMBDA_FUNCTION_NAME")
    )


def _live_pipeline_can_poll() -> bool:
    try:
        from backend.live_manager import status as live_status

        s = live_status()
        return bool(s.get("configured") or s.get("active_streams"))
    except Exception:
        return False


def _schedule_station_status_poll(*, source: str) -> None:
    if not _live_pipeline_can_poll():
        return
    threading.Thread(
        target=poll_and_log,
        kwargs={"source": source, "force": False},
        daemon=True,
        name=f"zgiis-station-status-{source}",
    ).start()


def _archive_freshness_hours() -> float:
    raw = os.getenv("LIVE_STATUS_ARCHIVE_HOURS", "1").strip()
    try:
        return max(0.05, float(raw))
    except ValueError:
        return 1.0


def _merge_live_station_statuses(stations: list, live_stations: list) -> list:
    """Overlay every live NTRIP state, not only the online state."""
    from dataclasses import replace

    from zgiis.cors.stations import normalize_station_status

    live_by_code = {s.code.lower().rstrip("_"): s for s in live_stations}
    merged = []
    for station in stations:
        live = live_by_code.get(station.code.lower().rstrip("_"))
        if live is None:
            merged.append(replace(station, status="offline", status_source="ntrip"))
        else:
            merged.append(
                replace(
                    station,
                    status=normalize_station_status(live.status),
                    status_source=live.status_source,
                )
            )
    return merged


def _merge_archived_live_statuses(stations: list) -> tuple[list, bool]:
    """Overlay recent live-collector snapshots from the shared status DB.

    This is the production path for Vercel: the always-on collector writes
    snapshots from a persistent process, while serverless functions only read.
    """
    from dataclasses import replace

    from backend.station_status_logger import get_db as get_status_db
    from zgiis.cors.site_details import enrich_station, vendor_status_label

    try:
        latest = get_status_db().latest_snapshots(hours=_archive_freshness_hours())
    except Exception:
        log.exception("Failed to read archived live station snapshots")
        return stations, False

    if not latest:
        return stations, False

    merged = []
    applied = False
    for station in stations:
        code = station.code.lower().rstrip("_")
        row = latest.get(code)
        if not row or row["status"] == "unknown":
            merged.append(station)
            continue
        status = row["status"]
        updated = str(row.get("time") or "").replace("T", " ").replace("+00:00", " UTC")[:22]
        s = replace(
            station,
            status=status,
            status_source="ntrip",
            last_update=updated,
            site_status_label=vendor_status_label(status),
        )
        merged.append(enrich_station(s))
        applied = True
    return merged, applied


def _archived_status_counts() -> tuple[int, int, int, int] | None:
    """Fast production health path: count recent collector snapshots only.

    Vercel serverless must not open live NTRIP sockets just to answer
    /cors/health. The persistent collector writes these snapshots to Supabase.
    """
    try:
        from backend.station_status_logger import get_db as get_status_db
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        latest = get_status_db().latest_snapshots(hours=_archive_freshness_hours())
    except Exception:
        log.exception("Failed to count archived station snapshots")
        return None

    if not latest:
        return None

    total = len(ZIMBABWE_CORS_STATIONS)
    online = sum(1 for row in latest.values() if row.get("status") == "online")
    # Legacy "degraded" snapshots count as offline (no MSM stream).
    offline_known = sum(
        1 for row in latest.values() if row.get("status") in {"offline", "degraded"}
    )
    known = online + offline_known
    offline = offline_known + max(0, total - known)
    return online, 0, offline, total


def _stations_impl(*, refresh_ntrip: bool = False) -> list:
    from dataclasses import replace

    from backend.live_manager import status as live_status, get_db
    from zgiis.api.cors_client import fetch_station_health
    from zgiis.cors.site_details import enrich_station, enrich_station_from_probe
    from zgiis.cors.stations import derive_status_from_stream, stations_for_map, stations_for_map_live
    from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe, probe_rows_by_station

    try:
        health = fetch_station_health(country="Zimbabwe") if refresh_ntrip else None
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

    archive_applied = False
    if not pipeline_configured:
        stations, archive_applied = _merge_archived_live_statuses(stations)
        if archive_applied and _is_serverless_runtime():
            return stations

    probe_payload = None
    probe_by: dict = {}
    try:
        df = get_db().query_recent(hours=2.0)
    except Exception:
        df = None

    has_recent_vtec = (
        df is not None
        and not df.empty
        and "station" in df.columns
        and "vtec_tecu" in df.columns
    )
    vtec_by_station: dict[str, float] = {}
    if has_recent_vtec:
        grouped = df.groupby("station")["vtec_tecu"]
        for code_raw, series in grouped:
            code = str(code_raw).lower().rstrip("_")
            mean_vtec = float(series.mean())
            if math.isfinite(mean_vtec) and mean_vtec > 0:
                vtec_by_station[code] = mean_vtec

    try:
        from backend.live_manager import latest_vtec_by_station

        for code, vtec in latest_vtec_by_station().items():
            key = code.lower().rstrip("_")
            if vtec > 0 and key not in vtec_by_station:
                vtec_by_station[key] = float(vtec)
    except Exception:
        pass

    # Vercel functions must never replace persistent-collector snapshots with
    # their own short socket probe. Those one-shot probes often see an accepted
    # NTRIP connection but no MSM inside the small request window, which paints
    # every station offline even while the collector is receiving data.
    # Local/persistent runtimes retain the probe fallback for diagnostics.
    run_probe = not _is_serverless_runtime() and (
        (not pipeline_configured and not archive_applied)
        or (not vtec_by_station and not archive_applied)
    )
    if run_probe:
        try:
            from zgiis.live.ntrip_status_cache import ntrip_probe_enabled

            if ntrip_probe_enabled():
                probe_payload = get_cached_ntrip_probe(
                    refresh=refresh_ntrip,
                    listen_sec=6.0,
                    allow_blocking_refresh=refresh_ntrip,
                )
                if not probe_payload.get("error"):
                    probe_by = probe_rows_by_station(probe_payload)
                    for code, row in probe_by.items():
                        raw = row.get("mean_vtec_tecu")
                        if raw is None:
                            continue
                        sample = float(raw)
                        if sample > 0:
                            vtec_by_station[code.lower().rstrip("_")] = sample
        except Exception:
            probe_payload = None
            probe_by = {}

    probed_at = str(probe_payload.get("probed_at") or "") if probe_payload else ""
    msm_online = [
        code
        for code, row in probe_by.items()
        if str(row.get("verdict", "")).lower() == "msm_streaming"
    ]
    if msm_online and (not pipeline_configured or not has_recent_vtec):
        try:
            from backend import live_manager

            threading.Thread(
                target=live_manager.ensure_ingest_for_stations,
                args=(msm_online,),
                daemon=True,
                name="zgiis-ensure-ingest",
            ).start()
        except Exception:
            log.exception("Failed to start live ingest for probed-online CORS stations")

    sourcetable_by_station: dict[str, dict] = {}
    if refresh_ntrip:
        try:
            from zgiis.live.ntrip_sourcetable_cache import get_cached_sourcetable_diagnostics

            mountpoints = _parse_mountpoints_for_sourcetable()
            if mountpoints:
                diag = get_cached_sourcetable_diagnostics(mountpoints, refresh=refresh_ntrip)
                sourcetable_by_station = diag.get("by_station") or {}
        except Exception:
            log.exception("Failed to fetch NTRIP caster sourcetable diagnostics")

    merged = []
    for station in stations:
        code = station.code.lower()
        stream = live_streams.get(code) if live_streams else None
        if stream is None and live_streams:
            # Mountpoint codes sometimes use a trailing underscore (e.g. gsu → GSU_).
            stream = live_streams.get(code.rstrip("_")) or live_streams.get(f"{code.rstrip('_')}_")
        s = enrich_station(station, stream=stream)
        if pipeline_configured:
            derived = derive_status_from_stream(stream)
            s = replace(s, status=derived, status_source="ntrip")
            # Re-apply vendor label after status derive so labels match online/offline.
            s = enrich_station(s, stream=stream)
        if code in probe_by or code.rstrip("_") in probe_by:
            row = probe_by.get(code) or probe_by.get(code.rstrip("_"))
            s = enrich_station_from_probe(s, row, probed_at=probed_at or None)
        vtec = vtec_by_station.get(code.rstrip("_"))
        if vtec is not None and vtec > 0:
            # VTEC is telemetry quality, not Spider site online/offline.
            s = replace(s, current_tec=round(vtec, 2))
            s = enrich_station(s, stream=stream)
        st_diag = sourcetable_by_station.get(code.rstrip("_"))
        if st_diag:
            s = replace(
                s,
                sourcetable_identifier=st_diag.get("identifier") or "",
                sourcetable_mismatch=bool(st_diag.get("mismatch")),
                sourcetable_note=st_diag.get("note") or "",
            )
        merged.append(s)
    return _merge_rover_clients(_merge_spider_site_statuses(merged, refresh=refresh_ntrip))


def _merge_spider_site_statuses(stations: list, *, refresh: bool = False) -> list:
    """Overlay Leica Spider Site Status (Status==3 ⇒ online) as map ground truth."""
    from dataclasses import replace

    from zgiis.cors.site_details import vendor_status_label
    from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

    if not spider_status_enabled():
        return stations

    try:
        payload = get_cached_spider_site_statuses(refresh=refresh)
    except Exception:
        log.exception("Failed to load Spider site status")
        return stations

    by_station = payload.get("by_station") or {}
    if not by_station:
        if payload.get("error"):
            log.warning("Spider site status unavailable: %s", payload.get("error"))
        return stations

    merged = []
    for station in stations:
        code = station.code.lower().rstrip("_")
        row = by_station.get(code)
        if row is None:
            merged.append(station)
            continue
        status = str(row.get("status") or "offline")
        last_update = str(row.get("last_update") or station.last_update or "")
        label = vendor_status_label(status, connected=status == "online", receiving=False)
        merged.append(
            replace(
                station,
                status=status,
                status_source="spider",
                last_update=last_update[:22] if last_update else station.last_update,
                site_status_label=label,
                site_server="Spider Site Status",
            )
        )
    return merged


def _merge_rover_clients(stations: list) -> list:
    """Overlay live rover (NTRIP client) counts when a Spider/caster feed exists."""
    from dataclasses import replace

    try:
        from zgiis.live.rover_clients import load_rover_clients
    except Exception:
        return stations

    try:
        snap = load_rover_clients()
    except Exception:
        log.exception("Failed to load rover client snapshot")
        return stations

    if not snap.available:
        return stations

    by_code = {s.code.lower().rstrip("_"): s for s in snap.stations}
    merged = []
    for station in stations:
        row = by_code.get(station.code.lower().rstrip("_"))
        if row is None:
            merged.append(station)
            continue
        merged.append(
            replace(
                station,
                connected_rovers=int(row.connected_rovers),
                rover_peak_24h=row.peak_24h,
                rover_share_pct=row.share_pct,
                rover_rank=row.rank,
            )
        )
    return merged


def _parse_mountpoints_for_sourcetable() -> dict[str, str]:
    try:
        from zgiis.live.mountpoints import parse_mountpoints

        return parse_mountpoints()
    except Exception:
        return {}


def _stations(*, refresh_ntrip: bool = False) -> list:
    now = time.monotonic()
    cached = _stations_cache.get("rows")
    cache_key = f"ntrip:{refresh_ntrip}"
    ttl = _STATIONS_CACHE_TTL_SEC
    try:
        from backend.live_manager import status as live_status

        if live_status().get("configured") or live_status().get("streams"):
            ttl = _STATIONS_LIVE_CACHE_TTL_SEC
    except Exception:
        pass
    if (
        cached is not None
        and (now - float(_stations_cache["ts"])) < ttl
        and _stations_cache.get("key") == cache_key
    ):
        return cached  # type: ignore[return-value]
    rows = _stations_impl(refresh_ntrip=refresh_ntrip)
    _stations_cache["rows"] = rows
    _stations_cache["ts"] = now
    _stations_cache["key"] = cache_key
    return rows


def clear_stations_cache() -> None:
    """Drop the in-process stations TTL cache (used after status-model changes)."""
    _stations_cache["rows"] = None
    _stations_cache["ts"] = 0.0
    _stations_cache["key"] = None


def _station_out(s) -> StationOut:
    current_tec = getattr(s, "current_tec", None)
    if current_tec is not None:
        try:
            current_tec = float(current_tec)
        except (TypeError, ValueError):
            current_tec = None
        else:
            if not math.isfinite(current_tec) or current_tec <= 0:
                current_tec = None

    return StationOut(
        code=s.code,
        name=s.name,
        lat=s.lat,
        lon=s.lon,
        status=s.status,
        status_source=getattr(s, "status_source", "unknown"),
        constellations=list(s.constellations) if s.constellations else [],
        current_tec=current_tec,
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
        sourcetable_identifier=getattr(s, "sourcetable_identifier", None) or None,
        sourcetable_mismatch=bool(getattr(s, "sourcetable_mismatch", False)),
        sourcetable_note=getattr(s, "sourcetable_note", None) or None,
        connected_rovers=getattr(s, "connected_rovers", None),
        rover_peak_24h=getattr(s, "rover_peak_24h", None),
        rover_share_pct=getattr(s, "rover_share_pct", None),
        rover_rank=getattr(s, "rover_rank", None),
    )


@router.get("/stations", response_model=list[StationOut])
def stations(
    refresh_ntrip: bool = Query(False),
    _=Depends(require_api_key),
):
    _schedule_station_status_poll(source="cors_stations")
    if refresh_ntrip:
        clear_stations_cache()
    return [_station_out(s) for s in _stations(refresh_ntrip=refresh_ntrip)]


@router.get("/rover-clients", response_model=RoverClientsOut)
def rover_clients(
    refresh: bool = Query(False),
    _=Depends(require_api_key),
):
    """Live NTRIP rover / client counts per CORS (Spider Business Center feed)."""
    from zgiis.live.rover_clients import load_rover_clients

    snap = load_rover_clients(force_refresh=refresh)
    return RoverClientsOut(**snap.to_dict())


@router.get("/stations/{code}", response_model=StationOut)
async def station_detail(code: str, _=Depends(require_api_key)):
    clear_stations_cache()
    match = next((s for s in _stations() if s.code == code.lower()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Station '{code}' not found")
    return _station_out(match)


@router.get("/health", response_model=CorsHealthOut)
async def health(_=Depends(require_api_key)):
    _schedule_station_status_poll(source="cors_health")
    archived = _archived_status_counts()
    if archived is not None:
        online, _degraded, offline, total = archived
        return CorsHealthOut(online=online, degraded=0, offline=offline, total=total)
    all_s = _stations()
    online = sum(1 for s in all_s if s.status == "online")
    offline = sum(1 for s in all_s if s.status != "online")
    return CorsHealthOut(online=online, degraded=0, offline=offline, total=len(all_s))


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


@router.post("/status/snapshots")
async def ingest_status_snapshots(
    payload: dict = Body(...),
    _=Depends(require_api_key),
):
    from datetime import datetime, timezone

    from backend.station_status_logger import get_db as get_status_db
    from zgiis.db.station_status_db import VALID_STATUSES

    rows_in = payload.get("snapshots") if isinstance(payload, dict) else None
    if not isinstance(rows_in, list):
        raise HTTPException(status_code=400, detail="snapshots must be a list")

    now = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
    rows = []
    for item in rows_in[:100]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("station_code") or item.get("code") or "").lower().rstrip("_")
        status = str(item.get("status") or "").lower()
        if not code or status not in VALID_STATUSES:
            continue
        rows.append(
            {
                "time": str(item.get("time") or now),
                "station_code": code,
                "status": status,
                "api_reachable": bool(item.get("api_reachable", True)),
                "source": str(item.get("source") or "status_snapshot_push"),
            }
        )

    inserted = get_status_db().insert_snapshots(rows)
    return {"inserted": inserted}


@router.get("/status/uptime", response_model=list[StationUptimeRow])
async def status_uptime(
    hours: float = 168.0,
    station: str | None = Query(None, description="Optional station code filter"),
    _=Depends(require_api_key),
):
    from backend.station_status_logger import get_db

    return [
        StationUptimeRow(**row)
        for row in get_db().uptime_summary(hours=hours, station_code=station)
    ]


@router.get("/status/timeline", response_model=list[StationUptimeTimelinePoint])
async def status_timeline(
    hours: float = 168.0,
    station: str | None = Query(None, description="Station code; omit for whole network"),
    bucket_minutes: int | None = Query(
        None, ge=1, le=10080, description="Aggregation bucket; defaults by window size"
    ),
    _=Depends(require_api_key),
):
    from backend.station_status_logger import get_db

    rows = get_db().uptime_timeline(
        hours=hours, station_code=station, bucket_minutes=bucket_minutes
    )
    return [StationUptimeTimelinePoint(**row) for row in rows]


@router.get("/status/analysis", response_model=StationUptimeAnalysis)
async def status_analysis(
    hours: float = 168.0,
    station: str | None = Query(None, description="Station code; omit for whole network"),
    bucket_minutes: int | None = Query(
        None, ge=1, le=10080, description="Aggregation bucket; defaults by window size"
    ),
    _=Depends(require_api_key),
):
    """Network / per-station uptime metrics + bucketed timeline for 1d–1y analysis."""
    from backend.station_status_logger import get_db

    payload = get_db().uptime_analysis(
        hours=hours, station_code=station, bucket_minutes=bucket_minutes
    )
    return StationUptimeAnalysis(**payload)


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
