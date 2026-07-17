"""
Owns the live NTRIP -> STEC/VTEC -> TimescaleDB pipeline as a process-wide
singleton, started/stopped from FastAPI's lifespan.

Config comes from env vars (see backend/.env.example) rather than
st.secrets, since this runs inside the FastAPI process, not Streamlit.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Dict

log = logging.getLogger(__name__)

_db = None
_monitor = None
_pipeline = None
_ntrip_manager = None
_nav_cache = None
_configured = False
_status_message = "Live pipeline has not been started."
_ingest_lock = threading.Lock()
_flush_stop = threading.Event()
_flush_thread: threading.Thread | None = None
_ephemeris_stop = threading.Event()
_ephemeris_thread: threading.Thread | None = None


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _runtime_mode() -> str:
    return "vercel-serverless" if os.getenv("VERCEL") else "persistent-process"


def _ingest_allowed() -> bool:
    return not (os.getenv("VERCEL") and not _env_enabled("ENABLE_NTRIP_INGEST"))


def _parse_mountpoints(*, priority_codes: list[str] | None = None) -> dict[str, str]:
    from zgiis.live.mountpoints import order_mountpoints, parse_mountpoints

    return order_mountpoints(parse_mountpoints(), priority_codes)


def _db_flush_n() -> int:
    raw = os.getenv("ZGIIS_DB_FLUSH_N", "1").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 1


def _priority_codes_from_env() -> list[str]:
    raw = os.getenv("NTRIP_LIVE_PRIORITY_STATIONS", "").strip()
    if not raw:
        return []
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _start_flush_thread() -> None:
    global _flush_thread
    _flush_stop.clear()
    if _flush_thread is not None and _flush_thread.is_alive():
        return

    def _loop() -> None:
        while not _flush_stop.wait(30.0):
            pipeline = _pipeline
            if pipeline is None:
                continue
            try:
                pipeline.flush_db()
            except Exception as exc:
                log.warning("Periodic live pipeline DB flush failed: %s", exc)

    _flush_thread = threading.Thread(target=_loop, daemon=True, name="zgiis-live-db-flush")
    _flush_thread.start()


def _stop_flush_thread() -> None:
    _flush_stop.set()


def _ephemeris_refresh_interval_s() -> float:
    raw = os.getenv("ZGIIS_EPHEMERIS_REFRESH_S", "3600").strip()
    try:
        return max(300.0, float(raw))
    except ValueError:
        return 3600.0


def _start_ephemeris_thread() -> None:
    """
    Periodically refresh GPS broadcast ephemeris from BKG's public BRDC
    mirror into the shared LiveNavCache. The CORS casters relay MSM
    observations but never emit RTCM 1019 (confirmed by direct capture), so
    satellite elevation — required before any VTEC value can be computed —
    would otherwise never resolve. See zgiis/live/broadcast_ephemeris.py.
    """
    global _ephemeris_thread
    _ephemeris_stop.clear()
    if _ephemeris_thread is not None and _ephemeris_thread.is_alive():
        return

    def _loop() -> None:
        from zgiis.live.broadcast_ephemeris import fetch_gps_nav

        nav_cache = get_nav_cache()
        while True:
            try:
                nav_by_sv = fetch_gps_nav()
                updated = nav_cache.bulk_update_gps(nav_by_sv)
                log.info("Broadcast ephemeris refresh: %d GPS satellite(s) updated.", updated)
            except Exception as exc:
                log.warning("Broadcast ephemeris refresh failed: %s", exc)
            if _ephemeris_stop.wait(_ephemeris_refresh_interval_s()):
                break

    _ephemeris_thread = threading.Thread(target=_loop, daemon=True, name="zgiis-live-ephemeris")
    _ephemeris_thread.start()


def _stop_ephemeris_thread() -> None:
    _ephemeris_stop.set()


def get_nav_cache():
    global _nav_cache
    if _nav_cache is None:
        from zgiis.live.satellite_geometry import LiveNavCache

        _nav_cache = LiveNavCache()
    return _nav_cache


def get_pipeline():
    return _pipeline


def latest_vtec_by_station() -> dict[str, float]:
    """In-memory latest VTEC per station from the live ingest pipeline."""
    pipeline = _pipeline
    if pipeline is None:
        return {}
    return pipeline.latest_by_station()


def diagnostics_by_station() -> dict[str, dict]:
    """In-memory per-station ingest counters from the live ingest pipeline."""
    pipeline = _pipeline
    if pipeline is None:
        return {}
    try:
        return pipeline.diagnostics_by_station()
    except AttributeError:
        return {}


def get_db():
    """Shared TecDB instance (TimescaleDB if TSDB_DSN is set, else SQLite)."""
    global _db
    if _db is None:
        from zgiis.db.timescale import TecDB

        _db = TecDB()
    return _db


def get_monitor():
    """Shared RTKMonitor instance — must be the same object the pipeline feeds."""
    global _monitor
    if _monitor is None:
        from zgiis.live.rtk_monitor import RTKMonitor

        _monitor = RTKMonitor()
    return _monitor


def is_configured() -> bool:
    return _configured


def status() -> dict:
    from zgiis.db.config import configured_database_env_key, database_dsn, database_host_kind

    mgr = _ntrip_manager
    db_backend = "timescaledb" if os.getenv("TSDB_DSN") else "sqlite"
    dsn = database_dsn()
    recent_records = None
    try:
        db = get_db()
        db_backend = db.backend
    except Exception as exc:
        log.debug("Live pipeline DB backend unavailable: %s", exc)
    try:
        db = _db or get_db()
        recent_records = db.record_count(hours=1.0)
    except Exception as exc:
        log.debug("Live pipeline recent record count unavailable: %s", exc)
    diagnostics = diagnostics_by_station()
    if _nav_cache is not None:
        diagnostics["gps_ephemeris_svs"] = _nav_cache.gps_sv_count()
        diagnostics["gps_ephemeris_last_refresh"] = (
            _nav_cache.last_bulk_update.isoformat() if _nav_cache.last_bulk_update else None
        )
    return {
        "configured": _configured,
        "active_streams": mgr.active_count if mgr else 0,
        "streams": mgr.status() if mgr else {},
        "db_backend": db_backend,
        "db_env_key": configured_database_env_key(),
        "db_host_kind": database_host_kind(dsn),
        "recent_vtec_records_1h": recent_records,
        "diagnostics": diagnostics,
        "runtime_mode": _runtime_mode(),
        "ingest_enabled": _ingest_allowed(),
        "message": _status_message,
    }


def start(*, priority_codes: list[str] | None = None) -> None:
    """Start the live pipeline if NTRIP credentials are configured. No-op otherwise."""
    global _pipeline, _ntrip_manager, _configured, _status_message

    if not _ingest_allowed():
        if _env_enabled("ENABLE_NTRIP_PROBE"):
            _status_message = (
                "Vercel is connected for NTRIP probe/API reads. Long-running ingest "
                "stays on the persistent collector."
            )
        else:
            _status_message = (
                "NTRIP ingest is disabled on Vercel serverless. Run the collector in a "
                "persistent worker and use Vercel for dashboard/API reads."
            )
        log.info(_status_message)
        return

    from zgiis.live.ntrip_config import ntrip_host_from_env

    host = ntrip_host_from_env()
    username = os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("NTRIP_PASSWORD", "").strip()
    merged_priority = _priority_codes_from_env()
    for code in priority_codes or []:
        key = code.lower().strip()
        if key and key not in merged_priority:
            merged_priority.append(key)
    mountpoints = _parse_mountpoints(priority_codes=merged_priority or None)

    if not (host and username and password and mountpoints):
        _status_message = "NTRIP credentials or mountpoints are not configured."
        log.info("%s Live pipeline stays off; dashboard uses stored data.", _status_message)
        return

    if _configured and _ntrip_manager is not None:
        missing = {code: mp for code, mp in mountpoints.items() if code not in _ntrip_manager._streams}
        if missing:
            _ntrip_manager.start(missing)
            log.info("Added %d live ingest stream(s): %s", len(missing), list(missing))
        return

    try:
        from zgiis.live.ntrip_stream import LiveNtripManager
        from zgiis.live.stec_vtec import LiveVtecPipeline
    except ImportError as exc:
        _status_message = f"Live pipeline dependencies are missing: {exc}"
        log.warning("Live pipeline deps missing: %s", exc)
        return

    db = get_db()
    monitor = get_monitor()
    nav_cache = get_nav_cache()

    def _on_vtec(vtec: dict) -> None:
        epoch = vtec.get("epoch")
        latency_ms = (
            (datetime.now(tz=timezone.utc) - epoch).total_seconds() * 1000.0
            if isinstance(epoch, datetime)
            else 0.0
        )
        monitor.record(vtec["station"], max(latency_ms, 0.0))

    pipeline = LiveVtecPipeline(
        db=db,
        on_vtec=_on_vtec,
        nav_cache=nav_cache,
        db_flush_n=_db_flush_n(),
    )

    def _on_observation(obs: dict) -> None:
        pipeline.ingest(obs)

    ntrip_cfg = {
        "host": host,
        "port": int(os.getenv("NTRIP_PORT", "2101")),
        "username": username,
        "password": password,
        "connection": os.getenv("NTRIP_CONNECTION", "TCP"),
    }

    max_concurrent_raw = os.getenv("NTRIP_LIVE_MAX_CONCURRENT", "4").strip()
    try:
        max_concurrent = max(1, int(max_concurrent_raw)) if max_concurrent_raw else 4
    except ValueError:
        max_concurrent = 4

    manager = LiveNtripManager(
        ntrip_cfg,
        on_observation=_on_observation,
        max_concurrent=max_concurrent,
        nav_cache=nav_cache,
    )
    manager.start(mountpoints)

    _pipeline = pipeline
    _ntrip_manager = manager
    _configured = True
    _status_message = f"Live NTRIP pipeline started for {len(mountpoints)} station(s)."
    _start_flush_thread()
    if _env_enabled("ZGIIS_EPHEMERIS_REFRESH_ENABLED"):
        _start_ephemeris_thread()
    else:
        log.info("Broadcast ephemeris refresh disabled. Set ZGIIS_EPHEMERIS_REFRESH_ENABLED=1 to compute live VTEC.")
    log.info("Live NTRIP pipeline started for %d station(s): %s", len(mountpoints), list(mountpoints))


def ensure_ingest_for_stations(station_codes: list[str]) -> None:
    """Start or extend live ingest, prioritising stations that are online on the caster."""
    codes = [code.lower().strip() for code in station_codes if code and code.strip()]
    if not codes or not _ingest_allowed():
        return
    with _ingest_lock:
        if not _configured:
            log.info("Starting live ingest for probed-online station(s): %s", codes)
            start(priority_codes=codes)
            return
        if _ntrip_manager is not None:
            mountpoints = _parse_mountpoints(priority_codes=codes)
            missing = {code: mp for code, mp in mountpoints.items() if code in codes and code not in _ntrip_manager._streams}
            if missing:
                _ntrip_manager.start(missing)
                log.info("Extended live ingest for online station(s): %s", list(missing))


def stop() -> None:
    global _pipeline, _ntrip_manager, _configured
    _stop_flush_thread()
    _stop_ephemeris_thread()
    if _pipeline is not None:
        try:
            _pipeline.flush_db()
        except Exception as exc:
            log.warning("Live pipeline DB flush on stop failed: %s", exc)
    if _ntrip_manager is not None:
        _ntrip_manager.stop()
        _ntrip_manager = None
    _pipeline = None
    _configured = False
