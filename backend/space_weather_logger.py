"""
Background logger for dashboard space-weather metrics.

Samples every SW_LOG_INTERVAL_SEC (default 60) and on manual refresh so
correlation analysis has a continuous local history even when NOAA APIs
only return sparse points.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_db = None
_thread: threading.Thread | None = None
_stop = threading.Event()
_last_logged_at: float | None = None

_MIN_LOG_GAP_SEC = float(os.getenv("SW_LOG_MIN_GAP_SEC", "45"))


def get_db():
    global _db
    if _db is None:
        from zgiis.db.space_weather_db import SpaceWeatherDB
        _db = SpaceWeatherDB()
    return _db


def _attach_mean_vtec(row: dict, hours: float = 1.0) -> None:
    """Optional network mean VTEC for space-weather / ionosphere correlation."""
    try:
        from zgiis.db.timescale import TecDB

        series = TecDB().mean_vtec_timeseries(hours=hours, resample="15min")
        if not series.empty:
            row["mean_vtec"] = float(series.iloc[-1])
    except Exception as exc:
        log.debug("mean_vtec attach skipped: %s", exc)


def log_snapshot(*, source: str = "scheduler", force: bool = False) -> bool:
    """
    Fetch current dashboard metrics and insert one row.
    Returns True if a row was written.
    """
    global _last_logged_at

    now = time.monotonic()
    if not force and _last_logged_at is not None and (now - _last_logged_at) < _MIN_LOG_GAP_SEC:
        return False

    try:
        from zgiis.space_weather.fetch_indices import get_space_weather
        from zgiis.db.space_weather_db import snapshot_from_sw_dict

        sw = get_space_weather(use_third_party=False)
        row = snapshot_from_sw_dict(sw, source=source)
        _attach_mean_vtec(row)
        get_db().insert_snapshot(row)
        _last_logged_at = now
        log.debug("space weather snapshot logged at %s", row.get("time"))
        return True
    except Exception as exc:
        log.warning("space weather log failed: %s", exc)
        return False


def _loop() -> None:
    interval = max(30.0, float(os.getenv("SW_LOG_INTERVAL_SEC", "60")))
    log.info("Space weather logger started (every %.0fs)", interval)
    log_snapshot(source="startup", force=True)
    while not _stop.wait(interval):
        if log_snapshot(source="scheduler"):
            try:
                from zgiis.space_weather.ekf_service import compute_ekf_status
                from zgiis.space_weather.fetch_indices import get_space_weather

                compute_ekf_status(get_space_weather(use_third_party=False), dispatch_notifications=True)
            except Exception as exc:
                log.debug("scheduled EKF notify skipped: %s", exc)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="space-weather-logger", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    global _thread
    if _thread:
        _thread.join(timeout=3.0)
        _thread = None


def status() -> dict:
    db = get_db()
    latest = db.latest_snapshot()
    return {
        "logging": bool(_thread and _thread.is_alive()),
        "interval_sec": float(os.getenv("SW_LOG_INTERVAL_SEC", "60")),
        "record_count": db.record_count(),
        "latest_time": latest.get("time") if latest else None,
        "db_backend": "timescaledb" if os.getenv("TSDB_DSN") else "sqlite",
    }
