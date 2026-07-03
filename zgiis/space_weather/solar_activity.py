"""NOAA SWPC + NASA DONKI solar activity feeds — ported from ZINGSA CORS_Program."""
from __future__ import annotations

import datetime
import os
from typing import Any, Dict, List, Optional

try:
    import requests

    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False

NOAA_XRAY_1D_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"
NOAA_PLASMA_1D_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"
NOAA_MAG_1D_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json"
NOAA_ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json"
NASA_DONKI_BASE_URL = "https://api.nasa.gov/DONKI"
# NASA issues free keys at https://api.nasa.gov/ — DEMO_KEY works for dev (rate-limited).
NASA_DEMO_KEY = "DEMO_KEY"
TIMEOUT_SECONDS = 15
DONKI_TIMEOUT_SECONDS = 45


def _nasa_api_key() -> tuple[str, bool]:
    """Return (api_key, is_demo). Empty env falls back to NASA DEMO_KEY."""
    key = os.environ.get("NASA_API_KEY", "").strip()
    if key:
        return key, key.upper() == NASA_DEMO_KEY
    return NASA_DEMO_KEY, True

_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 600        # 10 minutes for live data
_UNAVAILABLE_CACHE_TTL_SECONDS = 10  # retry unavailable results after 10 seconds
_NOAA_HEADERS = {"Accept": "application/json", "User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather dashboard)"}


def _cached(key: str, fetch_fn) -> Dict[str, Any]:
    import time

    entry = _CACHE.get(key)
    if entry:
        cached_data = entry["data"]
        ttl = (
            _UNAVAILABLE_CACHE_TTL_SECONDS
            if isinstance(cached_data, dict) and cached_data.get("mode") == "unavailable"
            else _CACHE_TTL_SECONDS
        )
        if time.time() - entry["ts"] < ttl:
            return cached_data
    data = fetch_fn()
    _CACHE[key] = {"ts": time.time(), "data": data}
    return data


def _fetch_json(url: str, *, timeout: int | None = None) -> Any:
    if not _REQUESTS_AVAILABLE:
        raise RuntimeError("requests not installed")
    import time
    wait = timeout if timeout is not None else TIMEOUT_SECONDS
    for attempt in range(2):
        try:
            res = requests.get(url, timeout=wait, headers=_NOAA_HEADERS)
            res.raise_for_status()
            return res.json()
        except Exception:
            if attempt == 0:
                time.sleep(0.25)
    raise RuntimeError(f"Failed to fetch {url} after 2 attempts")


def _iso_date(days_ago: int = 0) -> str:
    date = datetime.datetime.utcnow() - datetime.timedelta(days=days_ago)
    return date.strftime("%Y-%m-%d")


def _donki_url(product: str) -> str:
    api_key, _ = _nasa_api_key()
    params = {
        "startDate": _iso_date(6),
        "endDate": _iso_date(0),
        "api_key": api_key,
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{NASA_DONKI_BASE_URL}/{product}?{qs}"


def xray_class(flux: float) -> str:
    value = float(flux) if flux else 0.0
    if value >= 1e-4:
        return f"X{(value / 1e-4):.1f}"
    if value >= 1e-5:
        return f"M{(value / 1e-5):.1f}"
    if value >= 1e-6:
        return f"C{(value / 1e-6):.1f}"
    if value >= 1e-7:
        return f"B{(value / 1e-7):.1f}"
    return f"A{max(value / 1e-8, 0.1):.1f}"


def activity_level(flare_class: str, alert_count: int) -> Dict[str, str]:
    letter = (flare_class or "A")[0]
    if letter == "X":
        return {"label": "Extreme", "color": "#a855f7", "gnss": "Severe radio/GNSS watch"}
    if letter == "M":
        return {"label": "High", "color": "#f97316", "gnss": "HF radio and GNSS watch"}
    if letter == "C" or alert_count > 0:
        return {"label": "Moderate", "color": "#eab308", "gnss": "Minor GNSS impact possible"}
    return {"label": "Low", "color": "#22c55e", "gnss": "Minimal impact"}


def _parse_table_product(rows: Any) -> Dict[str, List]:
    if not isinstance(rows, list) or len(rows) < 2:
        return {"header": [], "data": []}
    return {"header": rows[0], "data": rows[1:]}


def _value_from_table(row: list, header: list, key: str) -> Any:
    index = next((i for i, h in enumerate(header) if key in str(h).lower()), -1)
    return row[index] if index >= 0 else None


def _float_or_zero(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _latest_product_row(rows: Any) -> dict | list | None:
    if not isinstance(rows, list) or not rows:
        return None
    if all(isinstance(row, dict) for row in rows):
        ordered = sorted(
            (row for row in rows if row.get("time_tag")),
            key=lambda row: str(row["time_tag"]),
        )
        return next((row for row in reversed(ordered) if row.get("active") is not False), None) or (ordered[-1] if ordered else None)
    table = _parse_table_product(rows)
    return table["data"][-1] if table["data"] else None


def _product_value(rows: Any, row: dict | list | None, *keys: str) -> Any:
    if row is None:
        return None
    if isinstance(row, dict):
        for key in keys:
            if row.get(key) is not None:
                return row.get(key)
        return None
    if isinstance(row, list):
        table = _parse_table_product(rows)
        for key in keys:
            value = _value_from_table(row, table["header"], key)
            if value is not None:
                return value
    return None


def format_utc_short(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        d = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d.strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return "—"


def build_donki_cme_rows(cmes: List[Dict]) -> List[Dict]:
    rows = []
    for cme in (cmes or [])[:8]:
        analyses = cme.get("cmeAnalyses") or []
        analysis = next((a for a in analyses if a.get("isMostAccurate")), analyses[0] if analyses else {})
        half_angle = float(analysis.get("halfAngle") or 0)
        if half_angle >= 360:
            halo = "Yes"
        elif half_angle >= 120:
            halo = "Partial"
        else:
            halo = "No"
        linked = bool(cme.get("linkedEvents"))
        rows.append({
            "date": format_utc_short(cme.get("startTime")),
            "speed": round(float(analysis.get("speed"))) if analysis.get("speed") else "—",
            "width": f"{half_angle}°" if half_angle else "—",
            "halo": halo,
            "impact": "Possible" if linked or half_angle >= 120 else "Unlikely",
            "id": cme.get("activityID") or cme.get("catalog") or "CME",
        })
    return rows


def build_donki_active_regions(flares: List[Dict]) -> List[Dict]:
    region_map: Dict[str, Dict] = {}
    for flare in flares or []:
        rid = (
            f"AR {flare['activeRegionNum']}"
            if flare.get("activeRegionNum")
            else f"AR {flare['sourceLocation']}"
            if flare.get("sourceLocation")
            else flare.get("flrID")
        )
        if not rid:
            continue
        letter = str(flare.get("classType") or "A")[0]
        cls = "Beta-Gamma" if letter in ("X", "M") else "Beta" if letter == "C" else "Alpha"
        mag = "BGD" if letter in ("X", "M") else "B" if letter == "C" else "A"
        current = region_map.get(rid, {"id": rid, "cls": cls, "mag": mag, "spots": 0, "latest": flare.get("classType")})
        current["spots"] += 1
        if flare.get("classType") and str(flare["classType"])[0] >= str(current.get("latest") or "A")[0]:
            current["latest"] = flare["classType"]
        region_map[rid] = current
    return list(region_map.values())[:6]


def build_donki_radio_bursts(flares: List[Dict]) -> List[Dict]:
    rows = []
    for flare in (flares or [])[:6]:
        letter = str(flare.get("classType") or "A")[0]
        rows.append({
            "time": format_utc_short(flare.get("beginTime") or flare.get("peakTime")),
            "type": "Type II" if letter in ("M", "X") else "Type III",
            "freq": "410 MHz" if letter == "X" else "245 MHz" if letter == "M" else "150 MHz",
            "intensity": "Strong" if letter == "X" else "Moderate" if letter == "M" else "Weak",
            "loc": flare.get("sourceLocation") or "—",
        })
    return rows


def get_unavailable_solar_activity(error: str) -> Dict[str, Any]:
    """Return explicit unavailable fields; never generate solar observations."""
    return {
        "mode": "unavailable",
        "updated": datetime.datetime.utcnow().isoformat() + "Z",
        "flareClass": "N/A",
        "flux": None,
        "xraySeries": [],
        "solarWind": {
            "speed": None,
            "density": None,
            "temperature": None,
            "bt": None,
            "bz": None,
        },
        "alerts": [],
        "donki": {
            "flares": [],
            "cmes": [],
            "storms": [],
            "dateRange": {"start": _iso_date(6), "end": _iso_date(0)},
        },
        "level": {
            "label": "Unavailable",
            "color": "#ffffff",
            "gnss": "Live solar data unavailable",
        },
        "api_routes": ["Live NOAA/NASA feeds unavailable"],
        "error": error,
    }


def fetch_solar_activity() -> Dict[str, Any]:
    """Live NOAA + NASA DONKI fetch — mirrors spaceWeatherApi.js fetchSolarActivity()."""

    def _load() -> Dict[str, Any]:
        xrays = _fetch_json(NOAA_XRAY_1D_URL)
        plasma_rows = _fetch_json(NOAA_PLASMA_1D_URL)
        mag_rows = _fetch_json(NOAA_MAG_1D_URL)
        alerts = _fetch_json(NOAA_ALERTS_URL)

        donki_status = "unavailable"
        _, using_demo = _nasa_api_key()
        donki_note = (
            "NASA DONKI via DEMO_KEY (rate-limited). Set NASA_API_KEY in backend/.env — free at https://api.nasa.gov/"
            if using_demo
            else "NASA DONKI live feed."
        )
        flares: list[dict] = []
        cmes: list[dict] = []
        storms: list[dict] = []
        try:
            flares = _fetch_json(_donki_url("FLR"), timeout=DONKI_TIMEOUT_SECONDS)
            cmes = _fetch_json(_donki_url("CME"), timeout=DONKI_TIMEOUT_SECONDS)
            storms = _fetch_json(_donki_url("GST"), timeout=DONKI_TIMEOUT_SECONDS)
            donki_status = "live"
            if not using_demo:
                donki_note = "NASA DONKI live feed."
        except Exception as exc:
            hint = " Check internet access to api.nasa.gov or set your own NASA_API_KEY in backend/.env."
            donki_note = f"NASA DONKI unavailable: {exc}.{hint if using_demo else ''}"

        xray_latest = xrays[-1] if isinstance(xrays, list) and xrays else {}
        flux = float(xray_latest.get("flux") or 0)
        flare_class = xray_class(flux)
        xray_series = [
            float(row.get("flux") or 0)
            for row in (xrays or [])
            if row.get("energy") == "0.1-0.8nm"
        ][-36:]

        plasma_latest = _latest_product_row(plasma_rows)
        speed = _float_or_zero(_product_value(plasma_rows, plasma_latest, "proton_speed", "speed"))
        density = _float_or_zero(_product_value(plasma_rows, plasma_latest, "proton_density", "density"))
        temperature = _float_or_zero(_product_value(plasma_rows, plasma_latest, "proton_temperature", "temperature"))

        mag_latest = _latest_product_row(mag_rows)
        bt = _float_or_zero(_product_value(mag_rows, mag_latest, "bt"))
        bz = _float_or_zero(_product_value(mag_rows, mag_latest, "bz_gsm", "bz"))

        alert_list = list(reversed(alerts[-5:])) if isinstance(alerts, list) else []
        level = activity_level(flare_class, len(alert_list))

        return {
            "mode": "live",
            "updated": (
                (plasma_latest or {}).get("time_tag")
                if isinstance(plasma_latest, dict)
                else xray_latest.get("time_tag")
            )
            or xray_latest.get("time_tag")
            or datetime.datetime.utcnow().isoformat() + "Z",
            "flareClass": flare_class,
            "flux": flux,
            "xraySeries": xray_series,
            "solarWind": {"speed": speed, "density": density, "temperature": temperature, "bt": bt, "bz": bz},
            "alerts": alert_list,
            "donki": {
                "flares": flares if isinstance(flares, list) else [],
                "cmes": cmes if isinstance(cmes, list) else [],
                "storms": storms if isinstance(storms, list) else [],
                "dateRange": {"start": _iso_date(6), "end": _iso_date(0)},
            },
            "donki_status": donki_status,
            "donki_note": donki_note,
            "level": level,
            "api_routes": [
                "NOAA SWPC goes/primary/xrays-1-day",
                "NOAA SWPC solar-wind/plasma + mag",
                "NOAA SWPC alerts.json",
            ]
            + (["NASA DONKI FLR / CME / GST"] if donki_status == "live" else []),
        }

    try:
        return _cached("solar_activity", _load)
    except Exception as exc:
        return get_unavailable_solar_activity(str(exc))


def get_solar_activity(force_refresh: bool = False) -> Dict[str, Any]:
    if force_refresh:
        _CACHE.pop("solar_activity", None)
    return fetch_solar_activity()
