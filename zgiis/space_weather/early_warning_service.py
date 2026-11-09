"""Orchestrate early-warning evaluation, persistence and summary payloads."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import requests

from zgiis.db.config import DatabaseUnavailable
from zgiis.db.early_warning_db import EarlyWarningDB
from zgiis.space_weather.early_warning import (
    Sample,
    evaluate_geomagnetic_observed,
    evaluate_solar_activity_events,
    evaluate_solar_wind_imf,
    evaluate_zimbabwe_gnss,
    parse_sample_time,
    should_suppress,
    summarise_alerts,
)
from zgiis.space_weather.solar_activity import (
    NOAA_MAG_1D_URL,
    NOAA_PLASMA_1D_URL,
    _NOAA_HEADERS,
    TIMEOUT_SECONDS,
    get_solar_activity,
)

log = logging.getLogger(__name__)


def _float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN guard


def _fetch_json(url: str) -> Any:
    response = requests.get(url, headers=_NOAA_HEADERS, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def _plasma_samples(rows: Any) -> list[Sample]:
    samples: list[Sample] = []
    if not isinstance(rows, list):
        return samples
    for row in rows:
        if not isinstance(row, dict) or row.get("active") is False:
            continue
        stamp = parse_sample_time(row.get("time_tag"))
        speed = _float(row.get("proton_speed") if row.get("proton_speed") is not None else row.get("speed"))
        if stamp is None or speed is None or speed <= 0:
            continue
        samples.append(Sample(time=stamp, value=speed))
    return samples


def _bz_samples(rows: Any) -> list[Sample]:
    samples: list[Sample] = []
    if not isinstance(rows, list):
        return samples
    for row in rows:
        if not isinstance(row, dict) or row.get("active") is False:
            continue
        stamp = parse_sample_time(row.get("time_tag"))
        bz = _float(row.get("bz_gsm") if row.get("bz_gsm") is not None else row.get("bz"))
        if stamp is None or bz is None:
            continue
        samples.append(Sample(time=stamp, value=bz))
    return samples


def _space_weather_bundle() -> dict[str, Any]:
    try:
        from zgiis.space_weather.fetch_indices import get_space_weather

        return get_space_weather(use_third_party=False, fetch_ionosphere=False) or {}
    except Exception as exc:
        log.warning("early-warning space-weather bundle unavailable: %s", exc)
        return {}


def run_early_warning_cycle(*, persist: bool = True) -> dict[str, Any]:
    """Evaluate all early-warning rules and optionally persist to Postgres."""
    now = datetime.now(timezone.utc)
    candidates = []
    diagnostics: dict[str, Any] = {
        "evaluated_at": now.isoformat().replace("+00:00", "Z"),
        "plasma_samples": 0,
        "bz_samples": 0,
        "persist": persist,
    }

    try:
        plasma_rows = _fetch_json(NOAA_PLASMA_1D_URL)
        mag_rows = _fetch_json(NOAA_MAG_1D_URL)
        speed_samples = _plasma_samples(plasma_rows)
        bz_samples = _bz_samples(mag_rows)
        diagnostics["plasma_samples"] = len(speed_samples)
        diagnostics["bz_samples"] = len(bz_samples)
        candidates.extend(evaluate_solar_wind_imf(speed_samples, bz_samples, now=now))
    except Exception as exc:
        diagnostics["rtsw_error"] = str(exc)
        log.warning("early-warning RTSW evaluation failed: %s", exc)

    sw = _space_weather_bundle()
    candidates.extend(
        evaluate_geomagnetic_observed(
            kp=_float(sw.get("kp")),
            dst=_float(sw.get("dst")),
            sym_h=_float(sw.get("sym_h")),
            kp_time=parse_sample_time(sw.get("updated_utc") or sw.get("time")),
            dst_time=parse_sample_time(sw.get("updated_utc") or sw.get("time")),
            now=now,
        )
    )
    candidates.extend(
        evaluate_zimbabwe_gnss(
            mean_vtec=_float(sw.get("mean_vtec")),
            s4=_float(sw.get("s4")),
            observation_time=parse_sample_time(sw.get("updated_utc") or sw.get("time")),
            now=now,
        )
    )

    solar = get_solar_activity(force_refresh=False) or {}
    candidates.extend(
        evaluate_solar_activity_events(
            swpc_alerts=solar.get("alerts") if isinstance(solar.get("alerts"), list) else [],
            donki_cmes=solar.get("donki_cmes") if isinstance(solar.get("donki_cmes"), list) else [],
            donki_flares=solar.get("donki_flares") if isinstance(solar.get("donki_flares"), list) else [],
            now=now,
        )
    )

    inserted = 0
    touched = 0
    resolved = 0
    active_payload = [alert.to_dict() for alert in candidates]

    if persist:
        db = None
        try:
            db = EarlyWarningDB()
            active_rules: set[str] = set()
            for alert in candidates:
                active_rules.add(alert.rule_id)
                existing = db.latest_for_rule(alert.rule_id)
                if should_suppress(existing, alert, now=now):
                    if existing and existing.get("status") in {"active", "watch"}:
                        db.touch_active(
                            alert.rule_id,
                            last_updated=alert.last_updated,
                            observed_value=alert.observed_value,
                        )
                        touched += 1
                    continue
                db.insert_alert(alert.to_dict())
                inserted += 1
            resolved = db.resolve_missing(active_rules, resolved_at=now.isoformat().replace("+00:00", "Z"))
            active_payload = db.active_alerts()
            history = db.list_alerts(hours=168)
        except DatabaseUnavailable as exc:
            diagnostics["db_error"] = str(exc)
            history = active_payload
            log.warning("early-warning persistence unavailable: %s", exc)
        finally:
            if db is not None:
                db.close()
    else:
        history = active_payload

    summary = summarise_alerts(active_payload)
    diagnostics.update({"inserted": inserted, "touched": touched, "resolved": resolved})
    return {
        "summary": summary,
        "active": [row for row in active_payload if row.get("status") in {"active", "watch"}],
        "history": history,
        "diagnostics": diagnostics,
        "authority_legend": {
            "official_noaa": "International catalogue bulletins and observed G-scale from measured Kp.",
            "zingsa_experimental": "ZINGSA L1 solar-wind and IMF sustained thresholds. Driver risk only — not a storm declaration.",
            "zimbabwe_gnss": "Measured Zimbabwe CORS VTEC and S4. Not inferred from L1 solar wind alone.",
        },
    }


def get_early_warning_snapshot(*, hours: float = 168.0, evaluate: bool = False) -> dict[str, Any]:
    if evaluate:
        return run_early_warning_cycle(persist=True)
    db = None
    try:
        db = EarlyWarningDB()
        active = db.active_alerts()
        history = db.list_alerts(hours=hours)
        return {
            "summary": summarise_alerts(active),
            "active": active,
            "history": history,
            "diagnostics": {"evaluated_at": None, "source": "database"},
            "authority_legend": {
                "official_noaa": "International catalogue bulletins and observed G-scale from measured Kp.",
                "zingsa_experimental": "ZINGSA L1 solar-wind and IMF sustained thresholds. Driver risk only — not a storm declaration.",
                "zimbabwe_gnss": "Measured Zimbabwe CORS VTEC and S4. Not inferred from L1 solar wind alone.",
            },
        }
    except DatabaseUnavailable:
        return run_early_warning_cycle(persist=False)
    finally:
        if db is not None:
            db.close()
