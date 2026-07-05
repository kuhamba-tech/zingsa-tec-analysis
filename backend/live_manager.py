"""
Owns the live NTRIP -> STEC/VTEC -> TimescaleDB pipeline as a process-wide
singleton, started/stopped from FastAPI's lifespan.

Config comes from env vars (see backend/.env.example) rather than
st.secrets, since this runs inside the FastAPI process, not Streamlit.
"""
from __future__ import annotations

import logging
import os
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


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _runtime_mode() -> str:
    return "vercel-serverless" if os.getenv("VERCEL") else "persistent-process"


def _parse_mountpoints() -> dict[str, str]:
    from zgiis.live.mountpoints import parse_mountpoints

    return parse_mountpoints()


def _default_station_mountpoints() -> Dict[str, str]:
    from zgiis.live.mountpoints import default_station_mountpoints

    return default_station_mountpoints()


def get_nav_cache():
    global _nav_cache
    if _nav_cache is None:
        from zgiis.live.satellite_geometry import LiveNavCache

        _nav_cache = LiveNavCache()
    return _nav_cache


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
    mgr = _ntrip_manager
    db_backend = "unknown"
    try:
        db = _db
        db_backend = db.backend if db is not None else ("timescaledb" if os.getenv("TSDB_DSN") else "sqlite")
    except Exception:
        db_backend = "unknown"
    return {
        "configured": _configured,
        "active_streams": mgr.active_count if mgr else 0,
        "streams": mgr.status() if mgr else {},
        "db_backend": db_backend,
        "runtime_mode": _runtime_mode(),
        "ingest_enabled": _env_enabled("ENABLE_NTRIP_INGEST", default=not os.getenv("VERCEL")),
        "message": _status_message,
    }


def start() -> None:
    """Start the live pipeline if NTRIP credentials are configured. No-op otherwise."""
    global _pipeline, _ntrip_manager, _configured, _status_message

    if os.getenv("VERCEL") and not _env_enabled("ENABLE_NTRIP_INGEST"):
        _status_message = (
            "NTRIP ingest is disabled on Vercel serverless. Run the collector in a "
            "persistent worker and use Vercel for dashboard/API reads."
        )
        log.info(_status_message)
        return

    host = os.getenv("NTRIP_HOST", "").strip()
    username = os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("NTRIP_PASSWORD", "").strip()
    mountpoints = _parse_mountpoints()

    if not (host and username and password and mountpoints):
        _status_message = "NTRIP credentials or mountpoints are not configured."
        log.info("%s Live pipeline stays off; dashboard uses stored data.", _status_message)
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

    pipeline = LiveVtecPipeline(db=db, on_vtec=_on_vtec, nav_cache=nav_cache)

    def _on_observation(obs: dict) -> None:
        pipeline.ingest(obs)

    ntrip_cfg = {
        "host": host,
        "port": int(os.getenv("NTRIP_PORT", "2101")),
        "username": username,
        "password": password,
        "connection": os.getenv("NTRIP_CONNECTION", "TCP"),
    }

    max_concurrent_raw = os.getenv("NTRIP_LIVE_MAX_CONCURRENT", "").strip()
    max_concurrent = int(max_concurrent_raw) if max_concurrent_raw else None

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
    log.info("Live NTRIP pipeline started for %d station(s): %s", len(mountpoints), mountpoints)


def stop() -> None:
    global _pipeline, _ntrip_manager, _configured
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
