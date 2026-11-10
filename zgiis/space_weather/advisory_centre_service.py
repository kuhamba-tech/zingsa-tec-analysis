"""Live assessment + optional archive for the Advisory Centre."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Callable

from zgiis.space_weather.advisory_centre import assess_advisory

log = logging.getLogger(__name__)

_SW_TIMEOUT_S = 6.0
_SOLAR_TIMEOUT_S = 4.0
_DB_TIMEOUT_S = 3.0


def _call_with_timeout(label: str, fn: Callable[[], Any], timeout_s: float, default: Any) -> Any:
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(fn).result(timeout=timeout_s)
    except FuturesTimeout:
        log.warning("advisory centre %s timed out after %.1fs", label, timeout_s)
        return default
    except Exception as exc:
        log.warning("advisory centre %s failed: %s", label, exc)
        return default


def _solar_fields() -> dict[str, Any]:
    out: dict[str, Any] = {
        "bz": None,
        "bt": None,
        "density": None,
        "speed": None,
        "available": False,
    }

    def _load() -> dict[str, Any]:
        from zgiis.space_weather.solar_activity import get_solar_activity

        sa = get_solar_activity(force_refresh=False) or {}
        wind = sa.get("solar_wind") or {}
        feed = sa.get("feed_status") or {}
        plasma_fresh = bool((feed.get("solar_wind_plasma") or {}).get("fresh"))
        mag_fresh = bool((feed.get("solar_wind_mag") or {}).get("fresh"))
        payload = dict(out)
        if plasma_fresh:
            payload["speed"] = wind.get("speed")
            payload["density"] = wind.get("density")
            payload["available"] = True
        if mag_fresh:
            payload["bz"] = wind.get("bz")
            payload["bt"] = wind.get("bt")
            payload["available"] = True
        return payload

    return _call_with_timeout("solar_activity", _load, _SOLAR_TIMEOUT_S, out)


def build_live_advisory(*, persist_draft: bool = False) -> dict[str, Any]:
    def _load_sw() -> dict[str, Any]:
        from zgiis.space_weather.fetch_indices import get_space_weather

        # Match Early Warning: skip slow ionosphere/third-party enrichments on the page path.
        return get_space_weather(use_third_party=False, fetch_ionosphere=False) or {}

    sw = _call_with_timeout("space_weather", _load_sw, _SW_TIMEOUT_S, {})
    solar = _solar_fields()
    speed = solar.get("speed")
    if speed is None:
        speed = sw.get("solar_wind_speed") or sw.get("plasma_speed")

    kp = sw.get("kp")
    dst = sw.get("dst")
    vtec = sw.get("mean_vtec")
    s4 = sw.get("s4")
    risk = sw.get("gnss_risk")

    geo_ok = kp is not None or dst is not None
    local_ok = vtec is not None or s4 is not None or bool(risk)
    solar_ok = bool(solar.get("available")) or speed is not None

    assessment = assess_advisory(
        kp=kp,
        dst=dst,
        plasma_speed=speed,
        bz=solar.get("bz"),
        bt=solar.get("bt"),
        density=solar.get("density"),
        mean_vtec=vtec,
        s4=s4,
        gnss_risk=risk,
        updated_utc=sw.get("updated_utc") or sw.get("updated"),
        solar_feed_available=solar_ok,
        geo_feed_available=geo_ok,
        local_feed_available=local_ok,
    )

    if persist_draft:
        def _archive() -> bool:
            from zgiis.db.advisory_centre_db import AdvisoryCentreDB

            db = AdvisoryCentreDB()
            if not db.ready:
                return False
            db.save_draft(assessment)
            return True

        assessment["archived"] = bool(
            _call_with_timeout("archive_draft", _archive, _DB_TIMEOUT_S, False)
        )
    return assessment
