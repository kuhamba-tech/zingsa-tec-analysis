"""
Poll the live NTRIP pipeline's per-station connection state and log
online / offline / unknown transitions.

Status is derived entirely from backend.live_manager.status() (real RTCM
handshake + last-seen-data timestamps) — no third-party API is involved.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

_db = None
_thread: threading.Thread | None = None
_stop = threading.Event()
_last_poll_at: float | None = None

_last_station_status: dict[str, str] = {}

_MIN_POLL_GAP_SEC = float(os.getenv("STATION_STATUS_MIN_GAP_SEC", "45"))


def get_db():
    global _db
    if _db is None:
        from zgiis.db.station_status_db import StationStatusDB

        _db = StationStatusDB()
    return _db


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()


def _status_from_streams(streams: dict[str, dict]) -> dict[str, str]:
    from zgiis.cors.stations import (
        ZIMBABWE_CORS_STATIONS,
        derive_status_from_stream,
        normalize_station_status,
    )

    result: dict[str, str] = {}
    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        result[code] = normalize_station_status(derive_status_from_stream(streams.get(code)))
    return result


def _status_from_live() -> dict[str, str]:
    try:
        from backend import live_manager
        streams = live_manager.status().get("streams", {})
    except Exception:
        streams = {}
    return _status_from_streams(streams)


def _counts(statuses: dict[str, str]) -> dict[str, int]:
    c = {"online": 0, "degraded": 0, "offline": 0, "unknown": 0}
    for status in statuses.values():
        if status == "online":
            c["online"] += 1
        elif status == "unknown":
            c["unknown"] += 1
        else:
            c["offline"] += 1
    return c


def _log_status_changes(
    current: dict[str, str],
    *,
    source: str,
    api_reachable: bool = True,
) -> int:
    global _last_station_status
    db = get_db()
    when = _now_iso()
    changes = 0
    counts = _counts(current)

    for code, status in sorted(current.items()):
        prev = _last_station_status.get(code)
        if prev is not None and prev != status:
            if status == "offline":
                event_type = "site_down"
                message = f"Site went offline ({prev} → offline)"
            elif prev == "offline" and status == "online":
                event_type = "site_up"
                message = f"Site back online (offline → online)"
            elif prev == "online" and status == "unknown":
                event_type = "connection_lost"
                message = f"Connection lost ({prev} → unknown)"
            else:
                event_type = "status_change"
                message = f"{prev} → {status}"
            db.insert_event(
                {
                    "time": when,
                    "station_code": code,
                    "status": status,
                    "previous_status": prev,
                    "event_type": event_type,
                    "online_count": counts["online"],
                    "degraded_count": counts["degraded"],
                    "offline_count": counts["offline"],
                    "unknown_count": counts["unknown"],
                    "api_reachable": api_reachable,
                    "message": message,
                    "source": source,
                }
            )
            changes += 1
        elif prev is None:
            db.insert_event(
                {
                    "time": when,
                    "station_code": code,
                    "status": status,
                    "previous_status": None,
                    "event_type": "initial_state",
                    "online_count": counts["online"],
                    "degraded_count": counts["degraded"],
                    "offline_count": counts["offline"],
                    "unknown_count": counts["unknown"],
                    "api_reachable": api_reachable,
                    "source": source,
                }
            )
            changes += 1

    snapshots = [
        {
            "time": when,
            "station_code": code,
            "status": status,
            "api_reachable": api_reachable,
            "source": source,
        }
        for code, status in current.items()
    ]
    db.insert_snapshots(snapshots)
    _last_station_status = dict(current)
    return changes


def _status_from_spider() -> dict[str, str]:
    """Spider Site Status (Status==3 ⇒ online) when NTRIP ingest is unavailable."""
    try:
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

        if not spider_status_enabled():
            return {}
        payload = get_cached_spider_site_statuses()
        by_station = payload.get("by_station") or {}
        if not by_station:
            return {}
        result: dict[str, str] = {}
        for station in ZIMBABWE_CORS_STATIONS:
            code = station.code.lower().rstrip("_")
            row = by_station.get(code)
            if row is None:
                result[code] = "unknown"
            else:
                result[code] = "online" if row.get("status") == "online" else "offline"
        return result
    except Exception:
        return {}


def log_status_map(current: dict[str, str], *, source: str, api_reachable: bool = True) -> dict[str, Any]:
    """Log a pre-built station_code → status map (Spider or external collector)."""
    counts = _counts(current)
    try:
        changes = _log_status_changes(current, source=source, api_reachable=api_reachable)
    except Exception as exc:
        global _db
        log.warning("station status archive write failed: %s", exc)
        _db = None
        return {"ok": False, "reason": "archive write failed", "stations": len(current), **counts}
    return {"ok": True, "changes": changes, "stations": len(current), **counts}


def log_streams(streams: dict[str, dict], *, source: str = "collector") -> dict[str, Any]:
    """
    Log status derived from an externally-supplied NTRIP stream-status dict
    (same shape as LiveNtripManager.status()).

    Used by the standalone persistent collector (scripts/live_ntrip_collector.py),
    which runs its own LiveNtripManager in a separate process from the FastAPI
    backend and therefore can't go through backend.live_manager. This is what
    feeds station_status_snapshots for Vercel's serverless reads.
    """
    current = _status_from_streams(streams)
    return log_status_map(current, source=source, api_reachable=True)


def poll_and_log(*, source: str = "scheduler", force: bool = False) -> dict[str, Any]:
    """
    Read per-station connection state from the live NTRIP pipeline and update
    the status archive. Returns summary dict with poll outcome.
    """
    global _last_poll_at

    now = time.monotonic()
    if not force and _last_poll_at is not None and (now - _last_poll_at) < _MIN_POLL_GAP_SEC:
        return {"skipped": True}

    pipeline_status: dict[str, Any] = {}
    try:
        from backend import live_manager

        pipeline_status = live_manager.status()
    except Exception:
        pipeline_status = {}

    if pipeline_status.get("configured") or pipeline_status.get("active_streams"):
        _last_poll_at = now
        return log_streams(pipeline_status.get("streams", {}), source=source)

    spider_status = _status_from_spider()
    if spider_status:
        _last_poll_at = now
        return log_status_map(spider_status, source=f"{source}_spider", api_reachable=True)

    return {"skipped": True, "reason": "live pipeline and Spider status both unavailable"}


def _loop() -> None:
    interval = max(30.0, float(os.getenv("STATION_STATUS_POLL_SEC", "60")))
    log.info("Station status logger started (every %.0fs)", interval)
    try:
        poll_and_log(source="startup", force=True)
    except Exception as exc:
        log.warning("station status startup poll failed: %s", exc)
    while not _stop.wait(interval):
        poll_and_log(source="scheduler")


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="station-status-logger", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    global _thread
    if _thread:
        _thread.join(timeout=3.0)
        _thread = None


def status() -> dict:
    db = get_db()
    try:
        from zgiis.db.config import database_backend_label, database_dsn

        db_backend = database_backend_label(database_dsn())
    except Exception:
        db_backend = "sqlite"
    try:
        from backend import live_manager
        pipeline_configured = live_manager.is_configured()
    except Exception:
        pipeline_configured = False
    return {
        "logging": bool(_thread and _thread.is_alive()),
        "poll_interval_sec": float(os.getenv("STATION_STATUS_POLL_SEC", "60")),
        "api_reachable": pipeline_configured,
        "event_count": db.event_count(),
        "snapshot_count": db.snapshot_count(),
        "tracked_stations": len(_last_station_status),
        "db_backend": db_backend,
    }
