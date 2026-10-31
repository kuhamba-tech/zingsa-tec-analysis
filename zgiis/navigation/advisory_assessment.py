"""Traceable current GNSS assessments, independent of wording and old forecast heuristics.

Production risk thresholds are deliberately unset until locally calibrated.
Station-mean VTEC rate is never relabelled as same-satellite ROT or ROTI.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
from typing import Any

RANK = {"insufficient_data": -1, "favourable": 0, "caution": 1, "high_risk": 2}
LABELS = {"insufficient_data": "INSUFFICIENT DATA", "favourable": "FAVOURABLE", "caution": "CAUTION", "high_risk": "HIGH RISK"}


def get(item, key, default=None):
    return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)


def stamp(value):
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@lru_cache(maxsize=1)
def advisory_rules():
    return json.loads(Path(__file__).with_name("advisory_rules.json").read_text(encoding="utf-8"))


def fresh(when, now, quality):
    time = stamp(when)
    return bool(time and -quality["future_clock_tolerance_seconds"] <= (now - time).total_seconds() <= quality["max_age_seconds"])


def distance_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def _calibrated(policy, station, now):
    start, end = stamp(policy.get("valid_from")), stamp(policy.get("valid_until"))
    return bool(policy.get("validated") is True and policy.get("calibration_id")
                and policy.get("dataset_ref") and policy.get("validation_report")
                and station in policy.get("station_codes", [])
                and start and end and start <= now <= end and policy.get("criteria")
                and isinstance(policy.get("min_samples"), int) and policy["min_samples"] > 0)


def _evaluate(policy, values, station, now, sample_count):
    if not _calibrated(policy, station, now) or sample_count < policy["min_samples"]:
        return "insufficient_data", ["No applicable validated local thresholds and sufficient samples."]
    result, reasons = "favourable", []
    for rule in policy["criteria"]:
        metric, caution, high = rule.get("metric"), rule.get("caution"), rule.get("high")
        value = values.get(metric)
        direction = rule.get("direction")
        if not all(finite(v) for v in (value, caution, high)) or direction not in ("above", "below"):
            return "insufficient_data", [f"Missing measurement or threshold for {metric}."]
        if (direction == "above" and caution >= high) or (direction == "below" and caution <= high):
            return "insufficient_data", ["Invalid calibrated threshold ordering."]
        level = ("high_risk" if value >= high else "caution" if value >= caution else "favourable") if direction == "above" else (
            "high_risk" if value <= high else "caution" if value <= caution else "favourable")
        if RANK[level] > RANK[result]:
            result = level
        reasons.append(f"{metric}: {value}; rule {policy['calibration_id']}; {level}.")
    return result, reasons


def _measured(record, station, now, quality):
    return bool(record and record.get("kind") == "observed" and record.get("quality") == "good"
                and record.get("source") and record.get("station") == station
                and fresh(record.get("observed_at"), now, quality)
                and isinstance(record.get("sample_count"), int) and record["sample_count"] > 0)


def _windows(day, now, current, config, forecast, city):
    cat = timezone(timedelta(hours=2))
    rows = []
    approved = (config.get("enabled") is True and config.get("model_id") and config.get("validation_id")
                and forecast and forecast.get("model_id") == config["model_id"]
                and forecast.get("validation_id") == config["validation_id"]
                and forecast.get("location") == city and fresh(forecast.get("issued_at"), now, {"max_age_seconds":900,"future_clock_tolerance_seconds":60}))
    for hour in (6, 9, 12, 15, 18):
        start = datetime(day.year, day.month, day.day, hour, tzinfo=cat)
        end = start + timedelta(hours=3)
        row = {"start": iso(start), "end": iso(end), "time_cat": f"{hour:02d}:00–{hour+3:02d}:00 CAT",
               "basis": "pending" if end > now else "not_assessed", "risk_level": "insufficient_data",
               "conditions": "Awaiting a validated forecast." if start > now else "No archived assessment for this interval.",
               "recommendation": "Pending — no recommended working window.", "confidence": None}
        if start <= now < end:
            row.update(basis="current_observation", risk_level=current,
                       conditions="Current assessment only; it does not cover the whole interval.",
                       recommendation="Check present observations and your equipment; the rest of this interval is not forecast.")
        if approved and start > now:
            for item in forecast.get("windows", []):
                confidence = item.get("confidence")
                if (stamp(item.get("start")) == start.astimezone(timezone.utc)
                    and stamp(item.get("end")) == end.astimezone(timezone.utc)
                    and item.get("risk_level") in ("favourable", "caution", "high_risk")
                    and finite(confidence) and 0 <= confidence <= 1):
                    row.update(basis="validated_forecast", risk_level=item["risk_level"],
                               conditions=str(item.get("conditions") or "Validated model forecast."),
                               recommendation=str(item.get("recommendation") or "Subject to continued monitoring."),
                               confidence=confidence)
        rows.append(row)
    return rows, bool(approved)


def build_advisory_assessment(*, city, local_tec, stations, sw=None, now=None, day=None,
                              rules=None, signal_metrics=None, performance=None, baseline=None, forecast=None):
    """Only observed, fresh, station-scoped evidence can support a current classification."""
    from zgiis.navigation.plain_news import plain_news_templates
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    now = stamp(now) or datetime.now(timezone.utc)
    rules = rules or advisory_rules()
    quality = rules["quality"]
    locations = plain_news_templates()["locations"]
    location = next((x for x in locations if x["city"] == str(city or "HARARE").upper()), None)
    if location is None:
        raise ValueError("Unsupported advisory location")
    registry = {s.code.lower().rstrip("_"): s for s in ZIMBABWE_CORS_STATIONS}
    reference = next((registry[c] for c in location["stations"] if c in registry), None)
    origin = (reference.lat, reference.lon) if reference else None
    candidates, last_known, conflicts = [], None, []
    # Merge records before checking conflicts: duplicate sources for one station
    # must not evade the identical-timestamp consistency check.
    merged = {}
    for series in local_tec or []:
        code = str(get(series, "station", "")).lower().rstrip("_")
        merged.setdefault(code, []).extend(get(series, "points", []) or [])
    for code, station_points in merged.items():
        site = registry.get(code)
        if not site or origin is None:
            continue
        distance = distance_km(origin, (site.lat, site.lon))
        if distance > quality["max_station_distance_km"]:
            continue
        values, conflict = {}, False
        for point in station_points:
            time, value = stamp(get(point, "time")), get(point, "vtec_tecu")
            count = get(point, "obs_count", 0)
            if not time or not finite(value) or value <= 0 or not finite(count) or count <= 0 or (time-now).total_seconds() > quality["future_clock_tolerance_seconds"]:
                continue
            last_known = max(time, last_known or time)
            if time in values and values[time] != float(value):
                conflict = True
            values[time] = float(value)
        ordered = sorted(values.items())
        if conflict:
            conflicts.append(code)
        if ordered and fresh(ordered[-1][0], now, quality) and not conflict:
            candidates.append({"code":code,"name":site.name,"lat":site.lat,"lon":site.lon,
                               "distance_km":round(distance,1),"points":ordered})
    candidates.sort(key=lambda x: (x["distance_km"], -x["points"][-1][0].timestamp()))
    selected = candidates[0] if candidates else None
    station = selected["code"] if selected else None
    observed_at, vtec = selected["points"][-1] if selected else (None, None)
    rate, span = None, None
    if selected:
        points = [(t,v) for t,v in selected["points"] if 0 <= (observed_at-t).total_seconds() <= 1800]
        if (len(points) >= quality["min_rate_points"]
            and all(0 < (b[0]-a[0]).total_seconds() <= quality["max_rate_gap_seconds"] for a,b in zip(points,points[1:]))):
            span = (points[-1][0]-points[0][0]).total_seconds()/60
            rate = round((points[-1][1]-points[0][1])/span,4) if span else None
    delta = None
    if (selected and baseline and baseline.get("validated") is True and baseline.get("reference_id")
        and baseline.get("station") == station and baseline.get("utc_hour") == observed_at.hour
        and finite(baseline.get("vtec")) and stamp(baseline.get("valid_from")) and stamp(baseline.get("valid_until"))
        and stamp(baseline["valid_from"]) <= observed_at <= stamp(baseline["valid_until"])):
        delta = round(vtec-baseline["vtec"],4)
    signal_ok = _measured(signal_metrics, station, now, quality) and signal_metrics.get("arc_consistent") is True
    signal_values = {key: signal_metrics.get(key) if signal_ok and finite(signal_metrics.get(key)) else None for key in ("rot", "roti", "spatial_gradient")}
    iono, iono_reasons = _evaluate(rules.get("ionosphere", {}), signal_values, station, now,
                                  signal_metrics["sample_count"] if signal_ok else 0)
    if not selected or conflicts:
        iono = "insufficient_data"
        iono_reasons = ["Missing, stale, or conflicting local observations."]
    perf_ok = _measured(performance, station, now, quality)
    sectors = {}
    for sector in ("citizen", "farmer", "surveyor"):
        policy = rules.get("sectors", {}).get(sector, {})
        values = performance if perf_ok else {}
        perf_risk, reasons = _evaluate(policy, values, station, now, performance["sample_count"] if perf_ok else 0)
        if sector == "surveyor" and not (perf_ok and performance.get("known_control") is True):
            perf_risk, reasons = "insufficient_data", ["RTK accuracy has not been checked against known control."]
        if not selected or conflicts:
            perf_risk, reasons = "insufficient_data", ["Usable local coverage is missing or conflicting."]
        perf_state = "not_verified" if perf_risk == "insufficient_data" else "verified" if perf_risk == "favourable" else "degraded"
        if perf_risk == "high_risk":
            risk = "high_risk"
        elif perf_risk == "caution" or iono in ("caution", "high_risk"):
            risk = "caution"
        elif perf_risk == "favourable" and iono == "favourable":
            risk = "favourable"
        else:
            risk = "insufficient_data"
        answer = {"insufficient_data":"GNSS performance cannot currently be verified. Check your equipment before precise work.",
                  "favourable":"Current local checks meet the configured limits. Continue normal accuracy checks.",
                  "caution":"Additional positioning checks are needed; pause precise work if checks fail.",
                  "high_risk":"Measured performance is outside the configured limits. Pause precision work until checks pass."}[risk]
        sectors[sector] = {"risk_level":risk,"risk_label":LABELS[risk],"gnss_performance":perf_state,
                           "can_continue":answer,"confidence":None,"reasons":reasons,
                           "calibration_id":policy.get("calibration_id") if _calibrated(policy,station,now) else None}
    overall = max((s["risk_level"] for s in sectors.values()), key=lambda x:RANK[x])
    if any(s["risk_level"] == "insufficient_data" for s in sectors.values()) and overall == "favourable":
        overall = "insufficient_data"
    checked = stamp((sw or {}).get("updated_utc"))
    global_fresh = fresh(checked, now, {**quality,"max_age_seconds":1800})
    geomagnetic = {key:(sw or {}).get(key) if global_fresh and finite((sw or {}).get(key)) else None for key in ("kp","dst","sym_h","plasma_speed")}
    geomagnetic.update(checked_at=iso(checked),scope="global_context",note="Global indices do not establish local GNSS performance.")
    chosen_day = day if isinstance(day,date) else date.fromisoformat(day) if day else (now+timedelta(hours=2)).date()
    windows, enabled = _windows(chosen_day,now,overall,rules.get("forecast",{}),forecast,location["city"])
    sources = [{"id":"local-code-tec","kind":"station_observation","station":c["code"],"observed_at":iso(c["points"][-1][0]),
                "method":"SQL-binned live code TEC; no interpolation","distance_km":c["distance_km"]} for c in candidates]
    if checked:
        sources.append({"id":"space-weather-feeds","kind":"global_context","checked_at":iso(checked)})
    if signal_ok:
        sources.append({"id":signal_metrics["source"],"kind":"observed_signal_metrics","observed_at":signal_metrics["observed_at"]})
    if perf_ok:
        sources.append({"id":performance["source"],"kind":"observed_gnss_performance","observed_at":performance["observed_at"]})
    identity = json.dumps({"place":location["city"],"station":station,"observed":iso(observed_at),"issued":iso(now),"rules":rules["version"]},sort_keys=True)
    return {"assessment_id":hashlib.sha256(identity.encode()).hexdigest()[:20],"rules_version":rules["version"],
            "location":location["name"],"location_key":location["city"],"issued_at":iso(now),
            "observation_time":iso(observed_at),"last_observation_time":iso(last_known),
            "valid_until":iso(min(now+timedelta(minutes=2),observed_at+timedelta(seconds=quality["max_age_seconds"]))) if observed_at else iso(now+timedelta(minutes=2)),
            "next_update":iso(now+timedelta(minutes=2)),"vtec":vtec,"delta_tec":delta,
            "tec_rate_tecu_per_min":rate,"tec_rate_window_minutes":span,"rot":signal_values["rot"],"roti":signal_values["roti"],
            "spatial_gradient":signal_values["spatial_gradient"],"geomagnetic_conditions":geomagnetic,
            "ionospheric_risk":iono,"ionospheric_reasons":iono_reasons,"risk_level":overall,"confidence":None,
            "gnss_performance":"degraded" if any(s["gnss_performance"]=="degraded" for s in sectors.values()) else "not_verified" if any(s["gnss_performance"]=="not_verified" for s in sectors.values()) else "verified",
            "sectors":sectors,"coverage":{"status":"station_only" if selected else "insufficient_data",
                "reference_station":reference.code if reference else None,"contributors":[{k:v for k,v in c.items() if k!="points"} for c in candidates],
                "conflicting_stations":conflicts,"interpolation":"none",
                "warning":"Station observations do not establish conditions at every nearby field or survey site." if selected else "No fresh, consistent station readings within the configured coverage radius."},
            "freshness":"fresh" if observed_at else "stale" if last_known else "missing",
            "data_sources":sources,"forecast_enabled":enabled,"working_day":chosen_day.isoformat(),"working_windows":windows,
            "limitations":["VTEC magnitude alone does not verify GNSS reliability.","Station-mean TEC rate is not per-satellite ROT or ROTI.",
                "Fix rate, cycle slips, loss of lock and positioning errors need measured telemetry; model proxies are excluded.",
                "Future working windows require an approved model and validation record."]}
