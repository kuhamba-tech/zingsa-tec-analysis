"""Local, measured TEC context. No invented recovery times or TEC danger cutoffs."""
from __future__ import annotations

from datetime import timedelta
import math
from typing import Any


def _get(item: Any, key: str, default=None):
    return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)


def regional_news_fields(audience, tone, computed_at, sw, forecasts, local_tec, city=None):
    from zgiis.navigation.plain_news import _parse_time, _has_reading, plain_news_templates, news_time_lines, news_time_fields

    if not forecasts and not city:
        return None
    templates = plain_news_templates()
    now = _parse_time(computed_at)
    if now is None:
        return None
    cities = {item["city"]: item for item in templates["locations"]}
    selected = city.strip().upper() if city else None
    if selected and selected not in cities:
        raise ValueError("Unknown Navigation News city")
    by_station = {str(_get(row, "station", "")).lower().rstrip("_"): row for row in local_tec or []}
    by_city = {_get(row, "city"): row for row in forecasts or []}
    rank = {"excellent": 0, "moderate": 1, "warning": 2}
    readings = []
    known_times = {}
    for location in cities.values():
        candidates = []
        for station in location["stations"]:
            points = {}
            for point in _get(by_station.get(station), "points", []) or []:
                stamp = _parse_time(_get(point, "time"))
                value = _get(point, "vtec_tecu")
                count = _get(point, "obs_count", 1)
                if (stamp is not None and isinstance(value, (int, float)) and not isinstance(value, bool)
                        and math.isfinite(value) and 0 < value < 200 and isinstance(count, (int, float)) and count > 0
                        and (now - stamp).total_seconds() >= -60):
                    key = location["city"]
                    known_times[key] = max(stamp, known_times.get(key, stamp))
                    if (now - stamp).total_seconds() <= 3600:
                        points[stamp] = float(value)
            ordered = sorted(points.items())
            if not ordered or (now - ordered[-1][0]).total_seconds() > 900:
                continue
            latest_time, latest = ordered[-1]
            nearby = [(t, v) for t, v in ordered if 0 <= (latest_time - t).total_seconds() <= 1800]
            baseline = None
            if len(nearby) >= 3 and all((b[0] - a[0]).total_seconds() <= 600 for a, b in zip(nearby, nearby[1:])):
                previous = [(t, v) for t, v in nearby if 600 <= (latest_time - t).total_seconds() <= 1200]
                if previous:
                    baseline = min(previous, key=lambda p: abs((latest_time - p[0]).total_seconds() - 900))
            candidates.append({"location": location, "station": station, "time": latest_time,
                               "value": latest, "baseline": baseline})
        if candidates:
            readings.append(max(candidates, key=lambda item: item["time"]))

    def priority(item):
        forecast = by_city.get(item["location"]["city"])
        change = abs(item["value"] - item["baseline"][1]) if item["baseline"] else 0
        return rank.get(_get(forecast, "status"), 0), change

    reading = next((item for item in readings if item["location"]["city"] == selected), None) if selected else max(readings, key=priority, default=None)
    location = cities[selected] if selected else reading["location"] if reading else None
    name = location["name"] if location else "Zimbabwe"
    forecast = by_city.get(location["city"]) if location else None
    global_time = _parse_time((sw or {}).get("updated_utc"))
    global_fresh = global_time is not None and -60 <= (now - global_time).total_seconds() <= 1800 and _has_reading(sw or {})
    fields = {_get(field, "label"): _get(field, "value") for field in _get(forecast, "fields", [])}
    local_state = _get(forecast, "status", "excellent") if fields.get("CORS site") else "excellent"
    state = max([tone if global_fresh else "excellent", local_state], key=lambda s: rank[s])
    if not reading and not global_fresh:
        state = "unknown"
    feed = _get(forecast, "feed_reliability")
    network_unconfirmed = bool(fields.get("CORS site")) and isinstance(feed, (int, float)) and feed < 50
    if reading:
        value = reading["value"]
        local = f"Near {name}, TEC is {value:.1f} TEC units."
        if reading["baseline"]:
            earlier_time, earlier = reading["baseline"]
            minutes = round((reading["time"] - earlier_time).total_seconds() / 60)
            delta = round(value - earlier, 1)
            if delta:
                local = f"Near {name}, TEC {'rose' if delta > 0 else 'fell'} from {earlier:.1f} to {value:.1f} TEC units in {minutes} minutes."
            else:
                local += f" It changed little over {minutes} minutes."
    else:
        local = templates["regional"]["missing"]
    headline = f"{name}: {'GPS accuracy watch' if state in ('moderate', 'warning') else 'latest TEC and GPS advice'}"
    if state == "unknown":
        headline = f"{name}: waiting for fresh local readings"
    effect = templates["regional"]["network"] if network_unconfirmed else templates["regional"]["effects"][audience]
    summary = f"{local} {templates['regional']['explanation']} {effect}"
    if global_fresh and tone != "excellent":
        kp = (sw or {}).get("kp")
        key = "global_storm" if isinstance(kp, (int, float)) and kp >= 5 else "global_watch"
        summary += " " + templates["regional"][key]
    timing = templates["regional"]["timing"][audience]
    cat = now + timedelta(hours=2, minutes=15)
    notes = [f"When to work: {timing}", f"Check again: {cat:%d %b, %H:%M} CAT."
             + (" Recovery time is unconfirmed." if state != "excellent" else "")]
    observed = reading["time"] if reading else known_times.get(location["city"]) if location else None
    action = templates["audiences"][audience]["action"][state]
    script = "\n".join([
        f"ZINGSA Navigation News | {name}", *news_time_lines(observed, now, global_time),
        templates["audiences"][audience]["title"], headline, summary,
        f"What to do: {action}", *notes, "#ZINGSA #Zimbabwe #GPS",
    ])
    return {"headline": headline, "summary": summary, "space_weather_today": summary,
            "space_weather_bullets": [], "bullets": notes, "action": action,
            "broadcast_script": script, "social_script": script,
            "status_tone": "moderate" if state == "unknown" else state,
            **news_time_fields(observed, now, global_time)}
