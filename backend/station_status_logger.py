"""
Poll CORS station-health and log online / degraded / offline transitions.

When the remote API is unreachable (connection cut off), stations are marked
unknown and a connection_lost event is recorded. When polling resumes,
connection_restored is logged and per-station status changes are detected.
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
_api_reachable: bool = True

_MIN_POLL_GAP_SEC = float(os.getenv("STATION_STATUS_MIN_GAP_SEC", "45"))


def get_db():
    global _db
    if _db is None:
        from zgiis.db.station_status_db import StationStatusDB

        _db = StationStatusDB()
    return _db


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()


def _parse_health_stations(health: dict[str, Any]) -> dict[str, str]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, api_status_to_map

    summary = health.get("health_summary") or {}
    rows = health.get("stations") or []
    telemetry_live = int(summary.get("telemetry_live") or 0)

    by_code: dict[str, str] = {}
    for row in rows:
        code = str(row.get("station_id", "")).lower().rstrip("_")
        if code:
            by_code[code] = api_status_to_map(row.get("status"))

    result: dict[str, str] = {}
    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        if telemetry_live <= 0 or not rows:
            result[code] = "unknown"
        elif code in by_code:
            result[code] = by_code[code]
        else:
            result[code] = "offline"
    return result


def _counts(statuses: dict[str, str]) -> dict[str, int]:
    c = {"online": 0, "degraded": 0, "offline": 0, "unknown": 0}
    for status in statuses.values():
        key = status if status in c else "unknown"
        c[key] += 1
    return c


def _log_connection_lost(*, source: str, message: str) -> None:
    global _api_reachable
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    db = get_db()
    when = _now_iso()
    counts = _counts(_last_station_status) if _last_station_status else {
        "online": 0, "degraded": 0, "offline": 0, "unknown": 0,
    }

    db.insert_event(
        {
            "time": when,
            "station_code": None,
            "status": "unknown",
            "previous_status": None,
            "event_type": "connection_lost",
            "online_count": counts["online"],
            "degraded_count": counts["degraded"],
            "offline_count": counts["offline"],
            "unknown_count": counts["unknown"],
            "api_reachable": False,
            "message": message,
            "source": source,
        }
    )

    snapshots = []
    if _last_station_status:
        codes = _last_station_status
    else:
        codes = {s.code.lower(): "unknown" for s in ZIMBABWE_CORS_STATIONS}
    for code, prev in codes.items():
        if prev != "unknown":
            db.insert_event(
                {
                    "time": when,
                    "station_code": code,
                    "status": "unknown",
                    "previous_status": prev,
                    "event_type": "connection_lost",
                    "api_reachable": False,
                    "message": message,
                    "source": source,
                }
            )
        snapshots.append(
            {
                "time": when,
                "station_code": code,
                "status": "unknown",
                "api_reachable": False,
                "source": source,
            }
        )
        _last_station_status[code] = "unknown"

    db.insert_snapshots(snapshots)
    _api_reachable = False
    log.warning("CORS station-health unreachable — logged connection_lost (%s)", message)


def _log_connection_restored(*, source: str) -> None:
    global _api_reachable
    db = get_db()
    when = _now_iso()
    db.insert_event(
        {
            "time": when,
            "station_code": None,
            "status": "online",
            "previous_status": None,
            "event_type": "connection_restored",
            "api_reachable": True,
            "message": "CORS station-health API reachable again",
            "source": source,
        }
    )
    _api_reachable = True
    log.info("CORS station-health connection restored")


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
    Pull station-health from CORS API and update the status archive.
    Returns summary dict with poll outcome.
    """
    global _last_poll_at, _api_reachable

    now = time.monotonic()
    if not force and _last_poll_at is not None and (now - _last_poll_at) < _MIN_POLL_GAP_SEC:
        return {"skipped": True, "api_reachable": _api_reachable}

    _last_poll_at = now

    try:
        from zgiis.api.cors_client import fetch_station_health

        health = fetch_station_health(country="Zimbabwe")
    except Exception as exc:
        _log_connection_lost(source=source, message=str(exc))
        return {"ok": False, "api_reachable": False, "error": str(exc)}

    if health is None:
        _log_connection_lost(
            source=source,
            message="CORS station-health API returned no data (connection timeout or outage)",
        )
        return {"ok": False, "api_reachable": False}

    if not _api_reachable:
        _log_connection_restored(source=source)

    current = _parse_health_stations(health)
    changes = _log_status_changes(current, source=source, api_reachable=True)
    counts = _counts(current)

    return {
        "ok": True,
        "api_reachable": True,
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
    poll_and_log(source="startup", force=True)
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
    return {
        "logging": bool(_thread and _thread.is_alive()),
        "poll_interval_sec": float(os.getenv("STATION_STATUS_POLL_SEC", "60")),
        "api_reachable": _api_reachable,
        "event_count": db.event_count(),
        "snapshot_count": db.snapshot_count(),
        "tracked_stations": len(_last_station_status),
        "db_backend": "timescaledb" if os.getenv("TSDB_DSN") else "sqlite",
    }
