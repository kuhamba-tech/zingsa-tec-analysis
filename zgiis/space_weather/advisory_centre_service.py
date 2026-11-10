"""Live assessment + optional archive for the Advisory Centre."""
from __future__ import annotations

import logging
from typing import Any

from zgiis.space_weather.advisory_centre import assess_advisory

log = logging.getLogger(__name__)


def _solar_fields() -> dict[str, Any]:
    out: dict[str, Any] = {
        "bz": None,
        "bt": None,
        "density": None,
        "speed": None,
        "available": False,
    }
    try:
        from zgiis.space_weather.solar_activity import get_solar_activity

        sa = get_solar_activity(force_refresh=False) or {}
        wind = sa.get("solar_wind") or {}
        feed = sa.get("feed_status") or {}
        plasma_fresh = bool((feed.get("solar_wind_plasma") or {}).get("fresh"))
        mag_fresh = bool((feed.get("solar_wind_mag") or {}).get("fresh"))
        if plasma_fresh:
            out["speed"] = wind.get("speed")
            out["density"] = wind.get("density")
            out["available"] = True
        if mag_fresh:
            out["bz"] = wind.get("bz")
            out["bt"] = wind.get("bt")
            out["available"] = True
    except Exception as exc:
        log.debug("solar activity unavailable for advisory centre: %s", exc)
    return out


def build_live_advisory(*, persist_draft: bool = False) -> dict[str, Any]:
    from zgiis.space_weather.fetch_indices import get_space_weather

    sw = get_space_weather(use_third_party=False) or {}
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
        try:
            from zgiis.db.advisory_centre_db import AdvisoryCentreDB

            db = AdvisoryCentreDB()
            if db.ready:
                db.save_draft(assessment)
                assessment["archived"] = True
            else:
                assessment["archived"] = False
        except Exception as exc:
            log.warning("advisory draft archive failed: %s", exc)
            assessment["archived"] = False
    return assessment
