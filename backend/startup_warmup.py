"""Background cache warmup so the first HTTP requests stay fast after uvicorn starts."""
from __future__ import annotations

import logging
import os
import threading
import time

log = logging.getLogger(__name__)

_WARMUP_STARTED = False
_WARMUP_LOCK = threading.Lock()


def _live_start_delay_sec() -> float:
    raw = os.getenv("ZGIIS_LIVE_START_DELAY_SEC", "10").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 10.0


def _warm_space_weather() -> None:
    try:
        from zgiis.space_weather.fetch_indices import warm_space_weather_cache

        warm_space_weather_cache()
        log.info("Space weather cache warmed")
    except Exception:
        log.exception("Space weather warmup failed")


def _warm_spider_status() -> None:
    try:
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

        if not spider_status_enabled():
            return
        payload = get_cached_spider_site_statuses(refresh=True)
        count = len(payload.get("by_station") or {})
        if count:
            log.info("Spider site status warmed (%d stations)", count)
        elif payload.get("error"):
            log.warning("Spider warmup: %s", payload.get("error"))
    except Exception:
        log.exception("Spider status warmup failed")


def _delayed_live_start() -> None:
    delay = _live_start_delay_sec()
    if delay > 0:
        log.info("Deferring live NTRIP ingest for %.0fs so API routes stay responsive", delay)
        time.sleep(delay)
    try:
        from backend import live_manager

        if not live_manager._ingest_allowed():
            log.info(
                "Skipping API live NTRIP ingest — dedicated collector is active "
                "(or ZGIIS_EXTERNAL_COLLECTOR / ZGIIS_DISABLE_API_INGEST is set)"
            )
            return
        live_manager.start()
    except Exception:
        log.exception("Live pipeline start failed")


def _warm_heliospheric_monitor() -> None:
    try:
        from zgiis.space_weather.heliospheric_monitor import build_heliospheric_monitor

        payload = build_heliospheric_monitor(force_refresh=True)
        mode = payload.get("mode")
        log.info("Heliospheric monitor cache warmed (mode=%s)", mode)
    except Exception:
        log.exception("Heliospheric monitor warmup failed")


def _warm_solar_activity() -> None:
    try:
        from zgiis.space_weather.solar_activity import get_solar_activity

        payload = get_solar_activity(force_refresh=True)
        log.info("Solar activity cache warmed (mode=%s)", payload.get("mode"))
    except Exception:
        log.exception("Solar activity warmup failed")


def start_background_warmup(*, include_live_ingest: bool = True) -> None:
    """Start cache warmup (and optionally delayed live ingest) exactly once."""
    global _WARMUP_STARTED
    with _WARMUP_LOCK:
        if _WARMUP_STARTED:
            return
        _WARMUP_STARTED = True

    threading.Thread(
        target=_warm_space_weather,
        daemon=True,
        name="zgiis-warm-space-weather",
    ).start()
    threading.Thread(
        target=_warm_solar_activity,
        daemon=True,
        name="zgiis-warm-solar-activity",
    ).start()
    threading.Thread(
        target=_warm_heliospheric_monitor,
        daemon=True,
        name="zgiis-warm-heliospheric",
    ).start()
    threading.Thread(
        target=_warm_spider_status,
        daemon=True,
        name="zgiis-warm-spider",
    ).start()
    _warm_fresh_cors_count()
    if include_live_ingest:
        threading.Thread(
            target=_delayed_live_start,
            daemon=True,
            name="zgiis-live-pipeline-start",
        ).start()
        threading.Thread(
            target=_warm_vtec_chart_cache,
            daemon=True,
            name="zgiis-warm-vtec-charts",
        ).start()


def _warm_fresh_cors_count() -> None:
    try:
        from backend.routers.cors_network import start_fresh_cors_refresh

        start_fresh_cors_refresh()
    except Exception:
        log.exception("CORS connection count warmup failed")


def start_light_cache_warmup() -> None:
    """Warm read-mostly NOAA caches even when full background services are off."""
    try:
        from backend.live_manager import ensure_broadcast_ephemeris

        # Skyplot/IPP azimuth needs BRDC in this process. This does not open
        # an NTRIP socket or a second collector.
        ensure_broadcast_ephemeris(wait_s=0.0)
    except Exception:
        log.exception("Broadcast ephemeris warmup failed to start")
    threading.Thread(
        target=_warm_space_weather,
        daemon=True,
        name="zgiis-warm-space-weather-light",
    ).start()
    threading.Thread(
        target=_warm_solar_activity,
        daemon=True,
        name="zgiis-warm-solar-activity-light",
    ).start()
    threading.Thread(
        target=_warm_heliospheric_monitor,
        daemon=True,
        name="zgiis-warm-heliospheric-light",
    ).start()
    threading.Thread(
        target=_warm_spider_status,
        daemon=True,
        name="zgiis-warm-spider-light",
    ).start()
    _warm_fresh_cors_count()
    try:
        from zgiis.cors.trignet import start_trignet_tec

        # Public TrigNet FTP/RINEX only. Does not open the Zimbabwe NTRIP slot.
        start_trignet_tec()
    except Exception:
        log.exception("TrigNet TEC worker failed to start")


def _warm_vtec_chart_cache() -> None:
    """Pre-build the 24h station chart cache so the first dashboard load is fast."""
    time.sleep(20.0)
    try:
        from backend.routers import live as live_router

        live_router._build_live_vtec_by_station(hours=24.0, resample_minutes=15)
        log.info("24h VTEC chart cache warmed")
    except Exception:
        log.exception("VTEC chart cache warmup failed")
