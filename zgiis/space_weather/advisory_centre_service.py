"""Live assessment + optional archive for the Advisory Centre.

Observed indices/VTEC are taken from the same Live Space Weather snapshot
(`/space-weather/current` + CORS connected mean VTEC) so Advisory Centre,
the display board, and Live Space Weather stay aligned.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Callable

from zgiis.space_weather.advisory_centre import assess_advisory

log = logging.getLogger(__name__)

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


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _solar_imf_fields() -> dict[str, Any]:
    """IMF / density supplements — not shown on the main Live cards, but useful here."""
    out: dict[str, Any] = {"bz": None, "bt": None, "density": None, "available": False}

    def _load() -> dict[str, Any]:
        from zgiis.space_weather.solar_activity import get_solar_activity

        sa = get_solar_activity(force_refresh=False) or {}
        wind = sa.get("solar_wind") or {}
        payload = dict(out)
        payload["bz"] = _finite(wind.get("bz"))
        payload["bt"] = _finite(wind.get("bt"))
        payload["density"] = _finite(wind.get("density"))
        payload["available"] = any(payload[k] is not None for k in ("bz", "bt", "density"))
        return payload

    return _call_with_timeout("solar_imf", _load, _SOLAR_TIMEOUT_S, out)


def build_live_advisory(
    *,
    persist_draft: bool = False,
    observed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an advisory from the Live Space Weather observed snapshot.

    ``observed`` should carry the same fields the display board uses from
    ``/space-weather/current`` (and CORS connected mean VTEC when available):
    kp, dst, plasma_speed, mean_vtec, s4, gnss_risk, stations_online/total, updated_utc.
    """
    obs = dict(observed or {})
    solar = _solar_imf_fields()

    kp = _finite(obs.get("kp"))
    dst = _finite(obs.get("dst"))
    speed = _finite(obs.get("plasma_speed") or obs.get("solar_wind_speed"))
    vtec = _finite(obs.get("mean_vtec") or obs.get("vtec_tecu"))
    s4 = _finite(obs.get("s4"))
    density = _finite(obs.get("density"))
    if density is None:
        density = solar.get("density")
    risk = obs.get("gnss_risk")
    if isinstance(risk, str):
        risk = risk.strip() or None
    else:
        risk = None

    geo_ok = kp is not None or dst is not None
    local_ok = vtec is not None or s4 is not None
    solar_ok = speed is not None or bool(solar.get("available"))

    assessment = assess_advisory(
        kp=kp,
        dst=dst,
        plasma_speed=speed,
        bz=solar.get("bz"),
        bt=solar.get("bt"),
        density=density,
        mean_vtec=vtec,
        s4=s4,
        gnss_risk=risk if local_ok or risk else None,
        updated_utc=obs.get("updated_utc") or obs.get("updated"),
        solar_feed_available=solar_ok,
        geo_feed_available=geo_ok,
        local_feed_available=local_ok,
    )
    assessment["observations"]["stations_online"] = obs.get("stations_online")
    assessment["observations"]["stations_total"] = obs.get("stations_total")
    assessment["observations"]["vtec_source"] = obs.get("vtec_source") or "space_weather_current"
    assessment["observations"]["aligned_with"] = "live_space_weather_current"

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
