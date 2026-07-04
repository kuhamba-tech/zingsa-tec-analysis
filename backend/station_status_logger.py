"""
Poll the live NTRIP pipeline's per-station connection state and log
online / degraded / offline / unknown transitions.

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


def _status_from_live() -> dict[str, str]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, derive_status_from_stream

    try:
        from backend import live_manager
        streams = live_manager.status().get("streams", {})
    except Exception:
        streams = {}

    result: dict[str, str] = {}
    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        result[code] = derive_status_from_stream(streams.get(code))
    return result


def _counts(statuses: dict[str, str]) -> dict[str, int]:
    c = {"online": 0, "degraded": 0, "offline": 0, "unknown": 0}
    for status in statuses.values():
        key = status if status in c else "unknown"
        c[key] += 1
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
            db.insert_event(
                {
                    "time": when,
                    "station_code": code,
                    "status": status,
                    "previous_status": prev,
                    "event_type": "status_change",
                    "online_count": counts["online"],
                    "degraded_count": counts["degraded"],
                    "offline_count": counts["offline"],
                    "unknown_count": counts["unknown"],
                    "api_reachable": api_reachable,
                    "message": f"{prev} → {status}",
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


def poll_and_log(*, source: str = "scheduler", force: bool = False) -> dict[str, Any]:
    """
    Read per-station connection state from the live NTRIP pipeline and update
    the status archive. Returns summary dict with poll outcome.
    """
    global _last_poll_at

    now = time.monotonic()
    if not force and _last_poll_at is not None and (now - _last_poll_at) < _MIN_POLL_GAP_SEC:
        return {"skipped": True}

    try:
        from backend import live_manager

        pipeline_status = live_manager.status()
        if not (pipeline_status.get("configured") or pipeline_status.get("active_streams")):
            return {
                "skipped": True,
                "reason": "live pipeline is not configured in this process",
            }
    except Exception:
        return {"skipped": True, "reason": "live pipeline status unavailable"}

    _last_poll_at = now

    current = _status_from_live()
    counts = _counts(current)
    try:
        changes = _log_status_changes(current, source=source, api_reachable=True)
    except Exception as exc:
        # The live dashboard must stay available even if the status archive
        # database drops an idle connection. Reset so the next poll reconnects.
        global _db
        log.warning("station status archive write failed: %s", exc)
        _db = None
        return {
            "ok": False,
            "reason": "archive write failed",
            "stations": len(current),
            **counts,
        }

    return {
        "ok": True,
        "changes": changes,
        "stations": len(current),
        **counts,
    }


def _loop() -> None:
    interval = max(30.0, float(os.getenv("STATION_STATUS_POLL_SEC", "60")))
    log.info("Station status logger started (every %.0fs)", interval)
    while not _stop.wait(interval):
        poll_and_log(source="scheduler")


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    try:
        poll_and_log(source="startup", force=True)
    except Exception as exc:
        log.warning("station status startup poll failed: %s", exc)
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
        "db_backend": "timescaledb" if os.getenv("TSDB_DSN") else "sqlite",
    }
