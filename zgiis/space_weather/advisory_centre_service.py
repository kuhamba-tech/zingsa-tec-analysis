"""Live assessment + optional archive for the Advisory Centre."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Callable

from zgiis.space_weather.advisory_centre import assess_advisory

log = logging.getLogger(__name__)

_SW_TIMEOUT_S = 6.0
_SOLAR_TIMEOUT_S = 4.0
_IONO_TIMEOUT_S = 4.0
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
        plasma = feed.get("solar_wind_plasma") or {}
        mag = feed.get("solar_wind_mag") or {}
        plasma_ok = bool(plasma.get("fresh") or plasma.get("ok") or wind.get("speed") is not None)
        mag_ok = bool(mag.get("fresh") or mag.get("ok") or wind.get("bz") is not None or wind.get("bt") is not None)
        payload = dict(out)
        # Use last measured samples when present. Freshness is disclosed in evidence
        # elsewhere; hiding Bt/Bz/density while speed is shown is not useful.
        if plasma_ok or wind.get("speed") is not None or wind.get("density") is not None:
            payload["speed"] = _finite(wind.get("speed"))
            payload["density"] = _finite(wind.get("density"))
            payload["available"] = payload["speed"] is not None or payload["density"] is not None
        if mag_ok or wind.get("bz") is not None or wind.get("bt") is not None:
            payload["bz"] = _finite(wind.get("bz"))
            payload["bt"] = _finite(wind.get("bt"))
            payload["available"] = payload["available"] or payload["bz"] is not None or payload["bt"] is not None
        return payload

    return _call_with_timeout("solar_activity", _load, _SOLAR_TIMEOUT_S, out)


def _zimbabwe_iono_fields() -> dict[str, Any]:
    """Reuse Live Space Weather VTEC/S4 sources without blocking the page."""
    out: dict[str, Any] = {"mean_vtec": None, "s4": None, "source": None}

    def _load() -> dict[str, Any]:
        payload = dict(out)

        # 1) In-process / collector live station means (local API / VPS).
        try:
            from backend.live_manager import latest_vtec_by_station

            vals = [
                float(v)
                for v in latest_vtec_by_station().values()
                if v is not None and float(v) > 1.0
            ]
            if vals:
                payload["mean_vtec"] = round(sum(vals) / len(vals), 2)
                payload["source"] = "live_station_samples"
        except Exception:
            pass

        if payload["mean_vtec"] is None:
            try:
                from backend.live_manager import get_db

                fast = get_db().network_mean_vtec(minutes=5)
                if fast is not None and float(fast) > 1.0:
                    payload["mean_vtec"] = round(float(fast), 2)
                    payload["source"] = "live_manager_network_mean"
            except Exception:
                pass

        if payload["mean_vtec"] is None:
            try:
                from backend.routers.cors_network import _safe_station_live_vtec

                vals = [
                    float(v)
                    for v in _safe_station_live_vtec(0.25, allow_db=True).values()
                    if v is not None and float(v) > 1.0
                ]
                if vals:
                    payload["mean_vtec"] = round(sum(vals) / len(vals), 2)
                    payload["source"] = "cors_station_live_vtec"
            except Exception:
                pass

        # 2) Logged dashboard snapshot (works on Vercel serverless).
        if payload["mean_vtec"] is None:
            try:
                from backend.space_weather_logger import get_db as get_sw_db

                db = get_sw_db()
                latest = None
                if hasattr(db, "latest_snapshot_with_vtec"):
                    latest = db.latest_snapshot_with_vtec()
                if latest is None:
                    latest = db.latest_snapshot()
                if latest is not None:
                    raw = latest.get("mean_vtec") if isinstance(latest, dict) else None
                    if raw is None and hasattr(latest, "get"):
                        raw = latest.get("mean_vtec")
                    value = _finite(raw)
                    if value is not None and value > 1.0:
                        payload["mean_vtec"] = round(value, 2)
                        payload["source"] = "space_weather_log_snapshot"
                    s4_raw = latest.get("s4") if isinstance(latest, dict) else None
                    if s4_raw is None and hasattr(latest, "get"):
                        s4_raw = latest.get("s4")
                    s4_val = _finite(s4_raw)
                    if s4_val is not None:
                        payload["s4"] = round(s4_val, 2)
            except Exception:
                pass

        if payload["mean_vtec"] is None:
            try:
                from zgiis.space_weather.fetch_indices import _load_persisted_snapshot

                snap = _load_persisted_snapshot() or {}
                value = _finite(snap.get("mean_vtec"))
                if value is not None and value > 1.0:
                    payload["mean_vtec"] = round(value, 2)
                    payload["source"] = "persisted_space_weather_snapshot"
                s4_val = _finite(snap.get("s4"))
                if s4_val is not None and payload["s4"] is None:
                    payload["s4"] = round(s4_val, 2)
            except Exception:
                pass

        # 3) Cached ionosphere status (S4 / VTEC when available, non-blocking cache).
        try:
            from zgiis.space_weather.fetch_indices import derive_s4_from_iono
            from zgiis.space_weather.ionosphere_status_cache import get_cached_ionosphere_status

            iono = get_cached_ionosphere_status(station="HARA") or {}
            if payload["mean_vtec"] is None:
                value = _finite(iono.get("vtec_tecu") or iono.get("mean_vtec"))
                if value is not None and value > 1.0:
                    payload["mean_vtec"] = round(value, 2)
                    payload["source"] = "ionosphere_status_cache"
            if payload["s4"] is None:
                s4, _delta, status, _note = derive_s4_from_iono(iono if iono else None)
                if s4 is not None and status == "observed_archive":
                    payload["s4"] = round(float(s4), 2)
        except Exception:
            pass

        return payload

    return _call_with_timeout("zimbabwe_iono", _load, _IONO_TIMEOUT_S, out)


def build_live_advisory(*, persist_draft: bool = False) -> dict[str, Any]:
    def _load_sw() -> dict[str, Any]:
        from zgiis.space_weather.fetch_indices import get_space_weather

        # Skip slow CORS_Program ionosphere HTTP; VTEC/S4 come from local/log sources below.
        return get_space_weather(use_third_party=False, fetch_ionosphere=False) or {}

    sw = _call_with_timeout("space_weather", _load_sw, _SW_TIMEOUT_S, {})
    solar = _solar_fields()
    iono = _zimbabwe_iono_fields()

    speed = solar.get("speed")
    if speed is None:
        speed = sw.get("solar_wind_speed") or sw.get("plasma_speed")
    density = solar.get("density")
    if density is None:
        density = _finite(sw.get("solar_wind_density"))

    kp = sw.get("kp")
    dst = sw.get("dst")
    vtec = iono.get("mean_vtec")
    if vtec is None:
        vtec = _finite(sw.get("mean_vtec") or sw.get("vtec_tecu"))
    s4 = iono.get("s4")
    if s4 is None:
        s4 = _finite(sw.get("s4"))
    risk = sw.get("gnss_risk")

    geo_ok = kp is not None or dst is not None
    # Local GNSS availability requires measured TEC/S4 — not a Kp-derived risk label alone.
    local_ok = vtec is not None or s4 is not None
    solar_ok = bool(solar.get("available")) or speed is not None

    assessment = assess_advisory(
        kp=kp,
        dst=dst,
        plasma_speed=speed,
        bz=solar.get("bz"),
        bt=solar.get("bt"),
        density=density,
        mean_vtec=vtec,
        s4=s4,
        gnss_risk=risk if local_ok else None,
        updated_utc=sw.get("updated_utc") or sw.get("updated"),
        solar_feed_available=solar_ok,
        geo_feed_available=geo_ok,
        local_feed_available=local_ok,
    )
    assessment["observations"]["vtec_source"] = iono.get("source")

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
