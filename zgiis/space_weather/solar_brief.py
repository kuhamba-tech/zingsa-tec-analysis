"""Earth-facing solar brief: NOAA flare chances and SolarHam's daily pictures.

The C, M, and X percentages are the NOAA SWPC 3-day prediction that SolarHam
posts. C-flaring is the sum of the per-region C chances. M-flaring and
X-flaring are the whole-disk chances for the first forecast day. The pictures
are SolarHam's dated disk, magnetogram, and coronal-hole frames, with NASA
SDO frames kept for when a SolarHam file is missing.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

DAYPRE_URL = "https://services.swpc.noaa.gov/text/3-day-solar-geomag-predictions.txt"
DISCUSSION_URL = "https://services.swpc.noaa.gov/text/discussion.txt"
FORECAST_URL = "https://services.swpc.noaa.gov/text/3-day-forecast.txt"
FLARES_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json"
EVENTS_URL = "https://services.swpc.noaa.gov/json/edited_events.json"
SRS_URL = "https://services.swpc.noaa.gov/text/srs.txt"
SOLARHAM_HOME = "https://solarham.com/"

_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_ISSUED = re.compile(r":Issued:\s*(.+)", re.IGNORECASE)
_CLASS_M = re.compile(r"Class_M\s+(\d+)")
_CLASS_X = re.compile(r"Class_X\s+(\d+)")
_REGION = re.compile(r"^\s*(\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$")
_EXPECTED_KP = re.compile(
    r"greatest expected 3 hr Kp for (.+?) is ([0-9]+(?:\.[0-9]+)?)\s*"
    r"\(NOAA Scale\s*(G\d|below NOAA Scale levels)\)",
    re.IGNORECASE | re.DOTALL,
)
_STORM_WINDOW = re.compile(
    r"reach (G\d) \([^)]+\)[^.]*?on (\d{1,2} \w{3}(?:-\d{1,2} \w{3})?)",
    re.IGNORECASE | re.DOTALL,
)
_POLARITY = re.compile(r"(positive|negative) polarity CH HSS", re.IGNORECASE)
_CACHE_S = 5 * 60
_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}


def build_solar_brief(*, force_refresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE["payload"]
        if cached and not force_refresh and (now - float(_CACHE["ts"])) < _CACHE_S:
            return cached
    payload = _load()
    with _LOCK:
        previous = _CACHE["payload"]
        better = payload.get("mode") == "live" and payload.get("monitor_regions")
        if better or not previous:
            _CACHE["ts"] = time.monotonic() if better else time.monotonic() - (_CACHE_S - 30)
            _CACHE["payload"] = payload
            return payload
        if previous.get("mode") == "live" and previous.get("monitor_regions"):
            return previous
        _CACHE["ts"] = time.monotonic() - (_CACHE_S - 30)
        _CACHE["payload"] = payload
    return payload


def parse_daypre(text: str) -> dict[str, Any]:
    """Whole-disk M/X chances and the summed region C chance."""
    issued = None
    found = _ISSUED.search(text or "")
    if found:
        issued = found.group(1).strip()
    m_match = _CLASS_M.search(text or "")
    x_match = _CLASS_X.search(text or "")
    regions: list[dict[str, int]] = []
    in_regions = False
    for raw in (text or "").splitlines():
        if raw.strip().startswith(":Reg_Prob:"):
            in_regions = True
            continue
        if not in_regions:
            continue
        if raw.startswith(":") or raw.startswith("#"):
            break
        match = _REGION.match(raw)
        if not match:
            continue
        regions.append(
            {
                "number": int(match.group(1)),
                "c_percent": int(match.group(2)),
                "m_percent": int(match.group(3)),
                "x_percent": int(match.group(4)),
            }
        )
    c_percent = min(100, sum(row["c_percent"] for row in regions)) if regions else None
    return {
        "issued": issued,
        "c_percent": c_percent,
        "m_percent": int(m_match.group(1)) if m_match else None,
        "x_percent": int(x_match.group(1)) if x_match else None,
        "regions": regions,
        "region_count": len(regions),
    }


def parse_forecast_outlook(forecast_text: str, discussion_text: str) -> dict[str, Any]:
    """Structured forecast facts. The wording is written by the page, not copied."""
    expected_kp = None
    expected_scale = None
    expected_window = None
    kp_match = _EXPECTED_KP.search(forecast_text or "")
    if kp_match:
        expected_window = re.sub(r"\s+", " ", kp_match.group(1)).strip()
        expected_kp = float(kp_match.group(2))
        scale = kp_match.group(3)
        expected_scale = None if scale.lower().startswith("below") else scale.upper()
    discussion = discussion_text or ""
    if re.search(r"No Earth-directed CMEs", discussion, re.IGNORECASE):
        earth_directed = False
    elif re.search(r"Earth-directed CME", discussion, re.IGNORECASE):
        earth_directed = True
    else:
        earth_directed = None
    polarity_match = _POLARITY.search(discussion)
    storm_window = None
    storm_scale = None
    storm_match = _STORM_WINDOW.search(discussion)
    if storm_match:
        storm_scale = storm_match.group(1).upper()
        storm_window = re.sub(r"\s+", " ", storm_match.group(2)).strip()
    return {
        "earth_directed_cme": earth_directed,
        "coronal_hole_stream": bool(re.search(r"CH HSS|coronal hole", discussion, re.IGNORECASE)),
        "stream_polarity": polarity_match.group(1).lower() if polarity_match else None,
        "expected_kp": expected_kp,
        "expected_kp_scale": expected_scale or storm_scale,
        "expected_kp_window": expected_window,
        "storm_window": storm_window,
    }


def flare_day_label(c_count: int, m_count: int, x_count: int) -> str:
    parts: list[str] = []
    if c_count:
        parts.append(f"{c_count} C")
    if m_count:
        parts.append(f"{m_count} M")
    if x_count:
        parts.append(f"{x_count} X")
    return ", ".join(parts) if parts else "No C-flares or higher"


def count_flare_days(events: list[dict[str, Any]] | None, now: datetime) -> dict[str, Any]:
    """GOES X-ray flares of class C or higher for today and yesterday, UTC."""
    moment = now.astimezone(timezone.utc)
    today = moment.date()
    yesterday = today - timedelta(days=1)
    buckets = {today: {"c": 0, "m": 0, "x": 0}, yesterday: {"c": 0, "m": 0, "x": 0}}
    for event in events or []:
        stamp = str(event.get("max_time") or event.get("time_tag") or "")
        try:
            when = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            continue
        bucket = buckets.get(when.date())
        if bucket is None:
            continue
        letter = str(event.get("max_class") or "")[:1].lower()
        if letter in bucket:
            bucket[letter] += 1

    def pack(day: datetime.date, counts: dict[str, int]) -> dict[str, Any]:
        return {
            "date": day.isoformat(),
            "c_count": counts["c"],
            "m_count": counts["m"],
            "x_count": counts["x"],
            "label": flare_day_label(counts["c"], counts["m"], counts["x"]),
        }

    return {"today": pack(today, buckets[today]), "yesterday": pack(yesterday, buckets[yesterday])}


def _class_rank(label: str) -> tuple[int, float]:
    text = (label or "").strip().upper()
    if not text:
        return -1, 0.0
    order = {"A": 0, "B": 1, "C": 2, "M": 3, "X": 4}.get(text[0], -1)
    try:
        size = float(text[1:])
    except ValueError:
        size = 0.0
    return order, size


def assign_region_flares(events: list[dict[str, Any]] | None, now: datetime) -> dict[int, dict[str, str | None]]:
    """Strongest NOAA-assigned X-ray flare for each region, today and yesterday UTC."""
    moment = now.astimezone(timezone.utc)
    today = moment.date()
    yesterday = today - timedelta(days=1)
    best: dict[int, dict[str, tuple[tuple[int, float], str]]] = {}
    for event in events or []:
        if str(event.get("type") or "").upper() != "XRA":
            continue
        try:
            number = int(event.get("region"))
        except (TypeError, ValueError):
            continue
        if number <= 0:
            continue
        label = str(event.get("particulars1") or "").strip()
        if not label or label in {"-", "None"}:
            continue
        stamp = str(event.get("max_datetime") or event.get("begin_datetime") or "")
        try:
            when = datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        day = when.astimezone(timezone.utc).date()
        if day == today:
            key = "today"
        elif day == yesterday:
            key = "yesterday"
        else:
            continue
        rank = _class_rank(label)
        if rank[0] < 0:
            continue
        text = f"{label} ({when.astimezone(timezone.utc).strftime('%H:%M')} UTC)"
        slot = best.setdefault(number, {})
        current = slot.get(key)
        if current is None or rank > current[0]:
            slot[key] = (rank, text)
    packed: dict[int, dict[str, str | None]] = {}
    for number, values in best.items():
        packed[number] = {
            "today": values["today"][1] if "today" in values else None,
            "yesterday": values["yesterday"][1] if "yesterday" in values else None,
        }
    return packed


def _location_parts(location: str) -> tuple[str, str]:
    match = re.match(r"([NS])(\d{2})([EW])(\d{2})", location or "")
    if not match:
        return "—", "—"
    return f"{match.group(2)} {match.group(1)}", f"{match.group(4)} {match.group(3)}"


def monitor_region_rows(parsed: dict[str, Any], events: list[dict[str, Any]] | None, now: datetime) -> list[dict[str, Any]]:
    """NOAA spotted regions, then plages, with the strongest assigned flare each UTC day."""
    flares = assign_region_flares(events, now)
    rows: list[dict[str, Any]] = []
    for source in (parsed.get("regions") or [], parsed.get("plages") or []):
        for row in source:
            latitude, longitude = _location_parts(str(row.get("location") or ""))
            peaks = flares.get(int(row["number"]), {})
            cmd = float(row.get("central_meridian_deg") or 0)
            rows.append(
                {
                    "number": int(row["number"]),
                    "kind": row.get("kind") or "spot",
                    "latitude": latitude,
                    "longitude": longitude,
                    "central_meridian_deg": cmd,
                    "spot_count": row.get("spot_count"),
                    "area_millionths": row.get("area_millionths"),
                    "magnetic_class": None if row.get("magnetic_class") is None else str(row["magnetic_class"]).lower(),
                    "limb": abs(cmd) >= 75,
                    "draw_x": row.get("draw_x"),
                    "draw_y": row.get("draw_y"),
                    "label_x": row.get("draw_label_x"),
                    "label_y": row.get("draw_label_y"),
                    "flare_today": peaks.get("today"),
                    "flare_yesterday": peaks.get("yesterday"),
                }
            )
    return rows


def solarham_images(day: datetime) -> list[dict[str, str]]:
    """SolarHam's three daily frames, plus the NASA picture used if one is missing."""
    moment = day.astimezone(timezone.utc)
    stem = f"{_MONTHS[moment.month - 1]}{moment.day}_{moment.year}"
    base = f"https://solarham.com/pictures/{moment.year}/{stem}"
    frames = (
        ("disk", "Earth-facing disk", f"{base}_disk.jpg", "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIF.jpg"),
        ("mag", "Magnetogram", f"{base}_mag.jpg", "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg"),
        ("ch", "Coronal hole", f"{base}_ch.jpg", "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg"),
    )
    return [
        {"key": key, "title": title, "url": url, "fallback_url": fallback, "credit": "SolarHam"}
        for key, title, url, fallback in frames
    ]


def _image_status(head, url: str) -> int:
    try:
        response = head(url)
        return int(getattr(response, "status_code", 0) or 0)
    except Exception:
        return 0


def choose_solarham_images(head, now: datetime) -> list[dict[str, str]]:
    """Keep today's SolarHam set unless the disk file is confirmed missing."""
    today = solarham_images(now)
    if _image_status(head, today[0]["url"]) == 404:
        return solarham_images(now - timedelta(days=1))
    return today


def _empty() -> dict[str, Any]:
    return {
        "mode": "unavailable",
        "issued": None,
        "source": "NOAA SWPC 3-day prediction, the figures SolarHam posts",
        "source_url": DAYPRE_URL,
        "solarham_url": SOLARHAM_HOME,
        "region_count": None,
        "earth_facing_region_count": None,
        "sunspot_number": None,
        "c_percent": None,
        "m_percent": None,
        "x_percent": None,
        "regions": [],
        "flares_today": None,
        "flares_yesterday": None,
        "earth_directed_cme": None,
        "coronal_hole_stream": None,
        "stream_polarity": None,
        "expected_kp": None,
        "expected_kp_scale": None,
        "expected_kp_window": None,
        "storm_window": None,
        "spotted_region_count": None,
        "plage_count": None,
        "monitor_issued": None,
        "monitor_images": [],
        "monitor_regions": [],
        "images": [],
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "error": None,
    }


def _load() -> dict[str, Any]:
    payload = _empty()
    try:
        import requests
    except ImportError:
        payload["error"] = "The solar brief reader is unavailable."
        return payload
    now = datetime.now(timezone.utc)

    def get_text(url: str, read_s: float = 25.0) -> str | None:
        for attempt in range(2):
            try:
                response = requests.get(url, timeout=(6.0, read_s))
                response.raise_for_status()
                return response.text
            except Exception:
                if attempt == 0:
                    time.sleep(0.6)
        return None

    def get_json(url: str) -> Any:
        for attempt in range(2):
            try:
                response = requests.get(url, timeout=(6.0, 25.0))
                response.raise_for_status()
                return response.json()
            except Exception:
                if attempt == 0:
                    time.sleep(0.6)
        return None

    from concurrent.futures import ThreadPoolExecutor

    from zgiis.space_weather.solar_disk import latest_labeled_frames

    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = {
            "daypre": pool.submit(get_text, DAYPRE_URL),
            "discussion": pool.submit(get_text, DISCUSSION_URL),
            "forecast": pool.submit(get_text, FORECAST_URL),
            "flares": pool.submit(get_json, FLARES_URL),
            "events": pool.submit(get_json, EVENTS_URL),
            "srs": pool.submit(get_text, SRS_URL),
            "frames": pool.submit(latest_labeled_frames, lambda url: get_text(url) or ""),
            "ham": pool.submit(
                choose_solarham_images,
                lambda url: requests.head(url, timeout=(3.0, 8.0), allow_redirects=True),
                now,
            ),
        }
        fetched = {name: job.result() for name, job in pending.items()}
    daypre = fetched["daypre"]
    discussion = fetched["discussion"]
    forecast = fetched["forecast"]
    flares = fetched["flares"]
    events = fetched["events"]
    srs = fetched["srs"]
    if daypre:
        parsed = parse_daypre(daypre)
        payload.update(
            {
                "issued": parsed["issued"],
                "c_percent": parsed["c_percent"],
                "m_percent": parsed["m_percent"],
                "x_percent": parsed["x_percent"],
                "regions": parsed["regions"],
                "region_count": parsed["region_count"],
            }
        )
    if srs:
        from zgiis.space_weather.solar_disk import parse_solar_region_summary

        disk = parse_solar_region_summary(srs)
        payload["earth_facing_region_count"] = disk["active_region_count"]
        payload["sunspot_number"] = disk["sunspot_number"]
        payload["spotted_region_count"] = len(disk["regions"])
        payload["plage_count"] = len(disk.get("plages") or [])
        payload["monitor_issued"] = disk["issued"]
        payload["monitor_regions"] = monitor_region_rows(
            disk, events if isinstance(events, list) else None, now
        )
    if forecast or discussion:
        payload.update(parse_forecast_outlook(forecast or "", discussion or ""))
    if isinstance(flares, list):
        counted = count_flare_days(flares, now)
        payload["flares_today"] = counted["today"]
        payload["flares_yesterday"] = counted["yesterday"]
    payload["images"] = fetched["ham"]
    payload["monitor_images"] = fetched["frames"]
    has_chances = payload["c_percent"] is not None or payload["m_percent"] is not None
    has_disk = payload["earth_facing_region_count"] is not None
    if has_chances and has_disk and payload["flares_today"] is not None:
        payload["mode"] = "live"
    elif has_chances or has_disk or payload["images"]:
        payload["mode"] = "partial"
        if not has_chances:
            payload["error"] = "The NOAA flare-probability table could not be read."
    else:
        payload["error"] = "The solar brief could not be read."
    payload["updated_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return payload
