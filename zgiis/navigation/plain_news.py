"""Short public copy shared by webpage, WhatsApp, Facebook and other channels."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=1)
def plain_news_templates() -> dict:
    path = Path(__file__).resolve().parents[2] / "static/data/navigation_news_plain.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _has_reading(sw: dict) -> bool:
    return any(isinstance(sw.get(key), (int, float)) and not isinstance(sw.get(key), bool)
               and math.isfinite(sw[key]) for key in ("kp", "dst", "s4"))


def news_timestamp(stamp: datetime | None) -> str:
    if stamp is None:
        return "Unavailable"
    utc = stamp.astimezone(timezone.utc)
    local = utc.astimezone(timezone(timedelta(hours=2)))
    utc_label = utc.strftime("%H:%M UTC" if utc.date() == local.date() else "%d %b %Y, %H:%M UTC")
    return f"{local:%d %b %Y, %H:%M} CAT · {utc_label}"


def news_time_lines(observed, generated, checked=None) -> list[str]:
    lines = [f"Data observed: {news_timestamp(observed)}"]
    if observed is None and checked is not None:
        lines.append(f"Data checked: {news_timestamp(checked)}")
    lines.append(f"Brief generated: {news_timestamp(generated)}")
    return lines


def news_time_fields(observed, generated, checked=None) -> dict:
    def iso(stamp):
        return stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if stamp else None
    return {"data_observed_at": iso(observed), "brief_generated_at": iso(generated), "data_checked_at": iso(checked)}


def plain_news_fields(audience: str, tone: str, computed_at: str, sw: dict | None,
                      *, forecasts=None, local_tec=None, city=None) -> dict:
    templates = plain_news_templates()
    source = sw or {}
    observed = _parse_time(source.get("updated_utc"))
    generated = _parse_time(computed_at)
    stale = observed is None or generated is None or abs((generated - observed).total_seconds()) > 1800
    state = "unknown" if stale or not _has_reading(source) else tone
    state_copy = templates["states"][state]
    audience_copy = templates["audiences"][audience]
    action = audience_copy["action"][state]
    script = "\n".join([
        "ZINGSA Navigation News | Zimbabwe",
        # updated_utc is a collection/check time, not an observation timestamp.
        *news_time_lines(None, generated, observed),
        audience_copy["title"],
        state_copy["headline"],
        state_copy["summary"],
        f"What to do: {action}",
        "#ZINGSA #Zimbabwe #SpaceWeather",
    ])
    fields = {
        "title": audience_copy["title"], "audience": audience_copy["title"],
        "headline": state_copy["headline"], "summary": state_copy["summary"],
        "action": action, "space_weather_today": state_copy["summary"],
        "space_weather_bullets": [], "bullets": [],
        "broadcast_script": script, "social_script": script,
        "status_tone": "moderate" if state == "unknown" else tone,
        **news_time_fields(None, generated, observed),
    }
    from zgiis.navigation.regional_news import regional_news_fields

    regional = regional_news_fields(audience, tone, computed_at, sw, forecasts, local_tec, city)
    if regional:
        fields.update(regional)
    return fields
