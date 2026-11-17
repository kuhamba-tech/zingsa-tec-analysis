"""One calibration scheduler/settings for independently fitted CORS receivers."""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone

from zgiis.processing.pytecgg_live import LivePytecgg, ENGINE, VERSION

log = logging.getLogger(__name__)
_lock = threading.Lock()
_networks: dict[str, tuple[LivePytecgg, list[dict]]] = {}
_started = False
_published: dict = {}


def calibration_session_seconds(value: str | None) -> float:
    """Both networks allow enough source observations for package arc fitting."""
    try:
        seconds = float(value or 600)
    except ValueError:
        seconds = 600
    return 0.0 if seconds == 0 else max(600.0, seconds)


def register_network(network: str, sites: list[dict]) -> LivePytecgg:
    global _started
    with _lock:
        engine = _networks.get(network, (None, []))[0] or LivePytecgg()
        _networks[network] = engine, sites
        if not _started:
            _started = True
            threading.Thread(target=_worker, daemon=True, name="cors-pytecgg").start()
        return engine


def register_zimbabwe(codes) -> LivePytecgg:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    wanted = {str(code).lower().rstrip("_") for code in codes}
    sites = [{"code": s.code, "lat": s.lat, "lon": s.lon, "height": getattr(s, "height_m", None) or 0.0}
             for s in ZIMBABWE_CORS_STATIONS if s.code.lower().rstrip("_") in wanted]
    return register_network("zimbabwe", sites)


def snapshot() -> dict:
    if os.getenv("VERCEL"):
        from zgiis.cors.trignet_store import load_snapshot
        return (load_snapshot() or {}).get("pytecgg_networks", {})
    with _lock:
        networks = dict(_networks)
        published = dict(_published)
    output = {}
    for name, (engine, sites) in networks.items():
        output[name] = {}
        for site in sites:
            code = str(site["code"]).lower().rstrip("_")
            current = engine.status(code)
            result = dict(published.get(name, {}).get(code, {}))
            # A cycle becomes visible for both networks together. Input counters
            # can advance independently without promoting an unfinished fit.
            if not result:
                result = {"gg_status": "awaiting_pytecgg_observations"}
            if result.get("gg_time"):
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(result["gg_time"].replace("Z", "+00:00"))).total_seconds()
                if age > 600 or age < -120 or not current.get("gg_vtec"):
                    result = {"gg_status": current.get("gg_status", "awaiting_fresh_pytecgg_result")}
            output[name][code] = {**result, "gg_engine": ENGINE, "gg_version": VERSION,
                                 "gg_input_epochs": current.get("gg_input_epochs", 0),
                                 "gg_input_signals": current.get("gg_input_signals", [])}
    return output


def ingest_zimbabwe(obs: dict) -> None:
    """Include real persistent-process probe observations in the same raw buffer."""
    if os.getenv("VERCEL"):
        return
    with _lock:
        registered = _networks.get("zimbabwe")
    if registered is None:
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
        engine = register_zimbabwe([site.code for site in ZIMBABWE_CORS_STATIONS])
    else:
        engine = registered[0]
    engine.ingest(obs)


def _worker() -> None:
    global _published
    from zgiis.live.broadcast_ephemeris import _download_brdc
    from zgiis.live.satellite_geometry import llh_to_ecef
    nav_path, nav_at = None, 0.0
    while True:
        try:
            if nav_path is None or time.monotonic() - nav_at > 3600:
                fresh = _download_brdc(datetime.now(timezone.utc), timeout=15)
                if fresh is not None:
                    if nav_path is not None:
                        nav_path.unlink(missing_ok=True)
                    nav_path, nav_at = fresh, time.monotonic()
            if nav_path is not None:
                with _lock:
                    networks = dict(_networks)
                cutoff = datetime.now(timezone.utc)
                completed = {}
                for name, (engine, sites) in networks.items():
                    completed[name] = {}
                    for site in sites:
                        code = str(site["code"]).lower().rstrip("_")
                        try:
                            engine.calibrate(code, llh_to_ecef(site["lat"], site["lon"], site.get("height", 0.0)),
                                             nav_path, cutoff=cutoff)
                        except Exception as exc:
                            engine.failed(code, "pytecgg_calibration_failed")
                            log.warning("%s PyTECGg unavailable for %s: %s", name, code, exc)
                        completed[name][code] = engine.status(code)
                with _lock:
                    _published = completed
        except Exception:
            log.exception("Shared CORS PyTECGg cycle failed")
        time.sleep(30)
