"""Colorado real-time equatorial ionospheric electric-field model client."""
from __future__ import annotations

from datetime import date, datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import math
import re
import threading
import time
from typing import Any

import requests

MODEL_API_URL = "https://electric-field-dot-gbp-oit-rc-hdgmrt-app-s8g.appspot.com/ppefmL"
MODEL_PAGE_URL = (
    "https://geomag.colorado.edu/online-calculators/"
    "real-time-model-ionospheric-electric-fields"
)
_TARGET_LONGITUDE = 28.0
_CACHE_TTL_SECONDS = 60
_LIVE_FALLBACK_TTL_SECONDS = 3600
_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple[date | None, int | None], tuple[float, dict[str, Any]]] = {}


class _ModelText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "br":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _number(value: str) -> float | None:
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _section_longitudes(lines: list[str]) -> list[float]:
    for index, line in enumerate(lines):
        if "Geographic Longitudes" not in line:
            continue
        header_index = next(
            (i for i in range(index, min(index + 4, len(lines))) if "YR MO DA" in lines[i]),
            None,
        )
        if header_index is None:
            return []
        for candidate in lines[header_index + 1 : header_index + 4]:
            values = [_number(token) for token in candidate.split()]
            if values and all(value is not None for value in values):
                return [value for value in values if value is not None]
        return []
    return []


def _section_created(lines: list[str]) -> str | None:
    for line in lines:
        match = re.search(r":Created:\s*(.+)", line)
        if not match:
            continue
        try:
            return datetime.strptime(match.group(1).strip(), "%a %b %d %H:%M:%S UTC %Y").replace(
                tzinfo=timezone.utc
            ).isoformat().replace("+00:00", "Z")
        except ValueError:
            return None
    return None


def _section_velocity(lines: list[str]) -> float | None:
    for line in lines:
        match = re.search(r"Average Solar Wind Velocity\s*:\s*([^\s]+)", line, re.IGNORECASE)
        if match:
            return _number(match.group(1))
    return None


def _parse_component(
    lines: list[str],
    *,
    component: str,
    longitude: float,
) -> tuple[list[dict[str, Any]], str | None, float | None]:
    longitudes = _section_longitudes(lines)
    if not longitudes:
        return [], _section_created(lines), _section_velocity(lines)
    column = min(range(len(longitudes)), key=lambda index: abs(longitudes[index] - longitude))
    created = _section_created(lines)
    velocity = _section_velocity(lines)
    data: dict[datetime, dict[str, Any]] = {}
    for line in lines:
        tokens = line.split()
        if len(tokens) < 5 + len(longitudes):
            continue
        if not all(token.isdigit() for token in tokens[:5]):
            continue
        try:
            stamp = datetime(
                int(tokens[0]), int(tokens[1]), int(tokens[2]),
                int(tokens[3]), int(tokens[4]), tzinfo=timezone.utc,
            )
        except ValueError:
            continue
        value = _number(tokens[5 + column])
        row = data.setdefault(
            stamp,
            {
                "time": stamp.isoformat().replace("+00:00", "Z"),
                "prompt_penetration_mvm": None,
                "climatological_mvm": None,
            },
        )
        row[component] = value
    return [data[stamp] for stamp in sorted(data)], created, velocity


def parse_equatorial_electric_field(text: str, *, longitude: float = _TARGET_LONGITUDE) -> dict[str, Any]:
    """Parse the model's HTML-wrapped five-minute component tables."""
    parser = _ModelText()
    parser.feed(text)
    plain_text = "".join(parser.parts).replace("\xa0", " ")
    parts = re.split(r"(?=:Data type:)", plain_text)
    merged: dict[datetime, dict[str, Any]] = {}
    created_at: str | None = None
    average_velocity: float | None = None
    invalid_prompt = False

    for part in parts:
        lines = [line.strip() for line in part.splitlines() if line.strip()]
        heading = next((line.lower() for line in lines if line.lower().startswith(":data type:")), "")
        if "prompt penetration" in heading:
            component = "prompt_penetration_mvm"
        elif "climatological" in heading:
            component = "climatological_mvm"
        else:
            continue

        rows, section_created, velocity = _parse_component(lines, component=component, longitude=longitude)
        if section_created:
            created_at = max(created_at or section_created, section_created)
        if component == "prompt_penetration_mvm":
            average_velocity = velocity
            invalid_prompt = velocity is None
        for row in rows:
            stamp = datetime.fromisoformat(row["time"].replace("Z", "+00:00"))
            target = merged.setdefault(
                stamp,
                {
                    "time": row["time"],
                    "prompt_penetration_mvm": None,
                    "climatological_mvm": None,
                },
            )
            target[component] = row[component]

    if invalid_prompt:
        for row in merged.values():
            row["prompt_penetration_mvm"] = None

    points = [merged[stamp] for stamp in sorted(merged)]
    return {
        "mode": "live" if any(
            row["prompt_penetration_mvm"] is not None or row["climatological_mvm"] is not None
            for row in points
        ) else "unavailable",
        "source": "University of Colorado Real-Time Equatorial Ionospheric Electric Field Model",
        "source_url": MODEL_PAGE_URL,
        "longitude_deg": longitude,
        "updated_utc": created_at,
        "average_solar_wind_velocity_km_s": average_velocity,
        "points": points,
        "note": (
            "Prompt-penetration output is unavailable because the model reports no valid "
            "solar-wind velocity."
            if invalid_prompt else None
        ),
    }


def build_equatorial_electric_field(*, start: date | None = None, days: int | None = None, force_refresh: bool = False) -> dict[str, Any]:
    cache_key = (start, days)
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and not force_refresh and now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]
    params = {}
    if start is not None:
        params.update(year=start.year, month=start.month, day=start.day, utc=0, nDays=days)
    def fetch(component: str) -> dict[str, Any]:
        response = requests.get(
            MODEL_API_URL,
            params={**params, "startlong": int(_TARGET_LONGITUDE), "deltalong": 18, "comp": component, "sat": "auto"},
            timeout=(6, 25),
            headers={"Accept": "text/html", "User-Agent": "ZGIIS/1.0 (space-weather dashboard)"},
        )
        response.raise_for_status()
        payload = parse_equatorial_electric_field(response.text)
        if payload["mode"] == "unavailable":
            raise ValueError("The Colorado model returned no usable electric-field rows.")
        return payload

    try:
        try:
            payload = fetch("all")
        except (requests.RequestException, ValueError):
            if start is None:
                raise

            def fetch_component(component: str) -> dict[str, Any] | None:
                try:
                    return fetch(component)
                except (requests.RequestException, ValueError):
                    return None

            with ThreadPoolExecutor(max_workers=2) as pool:
                penetration, quiet = pool.map(fetch_component, ("pp", "cl"))
            if penetration is None and quiet is None:
                raise

            parts = [part for part in (penetration, quiet) if part is not None]
            merged = {}
            for part in parts:
                for row in part["points"]:
                    point = merged.setdefault(row["time"], dict(row))
                    for key in ("prompt_penetration_mvm", "climatological_mvm"):
                        if row[key] is not None:
                            point[key] = row[key]
            payload = {
                **parts[0],
                "updated_utc": max((part["updated_utc"] for part in parts if part["updated_utc"]), default=None),
                "points": [merged[stamp] for stamp in sorted(merged)],
                "note": ("Quiet component unavailable from the Colorado model." if quiet is None else
                         "Prompt-penetration component unavailable from the Colorado model." if penetration is None else None),
            }
    except (requests.RequestException, ValueError):
        if start is not None or force_refresh:
            raise
        with _CACHE_LOCK:
            cached = _CACHE.get(cache_key)
        if (
            cached
            and time.monotonic() - cached[0] < _LIVE_FALLBACK_TTL_SECONDS
            and cached[1]["mode"] == "live"
        ):
            note = "The Colorado model could not be refreshed. Showing the last available model output."
            if cached[1]["note"]:
                note += " " + cached[1]["note"]
            return {**cached[1], "note": note}
        raise
    with _CACHE_LOCK:
        if cache_key not in _CACHE and len(_CACHE) >= 32:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[cache_key] = (time.monotonic(), payload)
    return payload
