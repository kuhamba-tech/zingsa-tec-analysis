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
NOAA_FLARES_7D_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json"
NOAA_KP_FORECAST_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
NASA_DONKI_BASE_URL = "https://api.nasa.gov/DONKI"
# NASA issues free keys at https://api.nasa.gov/ — DEMO_KEY works for dev (rate-limited).
NASA_DEMO_KEY = "DEMO_KEY"
# Keep per-feed timeouts short; feeds run in parallel so wall-clock ≈ max, not sum.
TIMEOUT_SECONDS = 12
DONKI_TIMEOUT_SECONDS = 18


def _nasa_api_key() -> tuple[str, bool]:
    """Return (api_key, is_demo). Empty env falls back to NASA DEMO_KEY."""
    key = os.environ.get("NASA_API_KEY", "").strip()
    if key:
        return key, key.upper() == NASA_DEMO_KEY
    return NASA_DEMO_KEY, True

_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 600        # 10 minutes for live data
_UNAVAILABLE_CACHE_TTL_SECONDS = 10  # retry unavailable results after 10 seconds
_LAST_GOOD: Dict[str, Any] | None = None
_LAST_GOOD_TS: float = 0.0
_LAST_GOOD_MAX_AGE_SECONDS = 3600  # serve stale-but-real solar for up to 1h if refresh fails
_NOAA_HEADERS = {"Accept": "application/json", "User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather dashboard)"}
_NOAA_MAX_AGE_MINUTES = 20.0


def _utc_age_minutes(value: Any) -> float | None:
    if not value:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=datetime.timezone.utc)
        now = datetime.datetime.now(datetime.timezone.utc)
        return max(0.0, (now - stamp.astimezone(datetime.timezone.utc)).total_seconds() / 60.0)
    except (TypeError, ValueError):
        return None


def _feed_state(*, reachable: bool, timestamp: Any = None, max_age_minutes: float | None = None) -> Dict[str, Any]:
    age = _utc_age_minutes(timestamp)
    fresh = reachable and (max_age_minutes is None or (age is not None and age <= max_age_minutes))
    return {
        "status": "live" if fresh else "stale" if reachable and timestamp else "available" if reachable else "unavailable",
        "reachable": reachable,
        "fresh": fresh,
        "timestamp": timestamp,
        "age_minutes": round(age, 1) if age is not None else None,
    }


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


def _soft_fetch_json(url: str, *, timeout: int | None = None) -> Any | None:
    """Same as _fetch_json but returns None on failure (for partial solar payloads)."""
    try:
        return _fetch_json(url, timeout=timeout)
    except Exception:
        return None


def _donki_list(value: Any) -> list[dict] | None:
    """Accept a DONKI JSON array; reject error payloads and non-lists."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and value.get("error"):
        return None
    return None


def _noaa_flares_to_donki(rows: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(rows, list):
        return out
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        begin = row.get("begin_time") or row.get("time_tag")
        out.append(
            {
                "flrID": f"NOAA-GOES-{begin or i}",
                "beginTime": begin,
                "peakTime": row.get("max_time") or begin,
                "classType": row.get("max_class") or row.get("begin_class") or "A",
                "sourceLocation": "GOES",
            }
        )
    return out


def _noaa_alerts_to_cme(alerts: Any) -> list[dict]:
    import re

    out: list[dict] = []
    if not isinstance(alerts, list):
        return out
    seen: set[str] = set()
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        msg = str(alert.get("message") or "")
        if not re.search(r"\bCME\b|coronal mass ejection", msg, re.I):
            continue
        key = str(alert.get("issue_datetime") or alert.get("product_id") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        earth = bool(re.search(r"earth[- ]direct|geo-effective|impact", msg, re.I))
        half = 360.0 if re.search(r"\bhalo\b", msg, re.I) else 120.0 if earth else 60.0
        out.append(
            {
                "activityID": f"NOAA-{alert.get('product_id', 'CME')}-{key[:10]}",
                "startTime": alert.get("issue_datetime"),
                "cmeAnalyses": [{"halfAngle": half, "speed": None, "isMostAccurate": True}],
                "linkedEvents": earth,
            }
        )
    return out


def _noaa_kp_to_storms(kp_rows: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(kp_rows, list):
        return out
    for row in kp_rows:
        if not isinstance(row, dict) or row.get("observed") != "observed":
            continue
        try:
            kp = float(row.get("kp") or 0)
        except (TypeError, ValueError):
            continue
        if kp < 5:
            continue
        tag = row.get("time_tag")
        g = min(5, max(1, int(kp) - 4))
        out.append(
            {
                "gstID": f"NOAA-G{g}-{tag}",
                "startTime": tag,
                "allKpIndex": [{"kpIndex": int(round(kp))}],
            }
        )
    return out


def _resolve_event_feeds(
    *,
    using_demo: bool,
    results: dict[str, Any],
    alerts: Any,
) -> tuple[list[dict], list[dict], list[dict], list[str], str, str]:
    """Return flares, cmes, storms, sources used, donki_status, donki_note."""
    sources: list[str] = []

    flares = _donki_list(results.get("flares"))
    cmes = _donki_list(results.get("cmes"))
    storms = _donki_list(results.get("storms"))

    if flares is not None:
        sources.append("nasa_flares")
    if cmes is not None:
        sources.append("nasa_cmes")
    if storms is not None:
        sources.append("nasa_storms")

    need_noaa = using_demo or flares is None or cmes is None or storms is None
    noaa_flares_raw = results.get("noaa_flares")
    noaa_kp_raw = results.get("noaa_kp")

    if need_noaa:
        if noaa_flares_raw is None and (using_demo or flares is None):
            noaa_flares_raw = _soft_fetch_json(NOAA_FLARES_7D_URL)
        if noaa_kp_raw is None and (using_demo or storms is None):
            noaa_kp_raw = _soft_fetch_json(NOAA_KP_FORECAST_URL)

    if flares is None:
        flares = _noaa_flares_to_donki(noaa_flares_raw)
        if flares:
            sources.append("noaa_flares")
    if cmes is None:
        cmes = _noaa_alerts_to_cme(alerts)
        if cmes:
            sources.append("noaa_cme_alerts")
    if storms is None:
        storms = _noaa_kp_to_storms(noaa_kp_raw)
        if storms:
            sources.append("noaa_kp")

    flares = flares or []
    cmes = cmes or []
    storms = storms or []

    has_events = bool(flares or cmes or storms)
    noaa_used = any(s.startswith("noaa_") for s in sources)

    if has_events and not using_demo and not noaa_used:
        donki_status = "live"
        donki_note = "NASA DONKI live feed."
    elif has_events:
        donki_status = "live"
        if using_demo or noaa_used:
            donki_note = (
                "NOAA SWPC live feed (GOES flares, SWPC alerts, Kp index). "
                "Set NASA_API_KEY in backend/.env for NASA DONKI catalog — free at https://api.nasa.gov/"
            )
        else:
            donki_note = "NASA DONKI live feed."
    else:
        donki_status = "unavailable"
        donki_note = "Solar event feeds unavailable."
        if using_demo:
            donki_note += " Check internet access to services.swpc.noaa.gov."

    return flares, cmes, storms, sources, donki_status, donki_note


def _event_feed_source(sources: list[str], donki_status: str) -> str:
    if donki_status != "live":
        return "unavailable"
    nasa = any(s.startswith("nasa_") for s in sources)
    noaa = any(s.startswith("noaa_") for s in sources)
    if nasa and noaa:
        return "mixed"
    if noaa:
        return "noaa_swpc"
    if nasa:
        return "nasa_donki"
    return "unavailable"


def _remember_good(payload: Dict[str, Any]) -> Dict[str, Any]:
    global _LAST_GOOD, _LAST_GOOD_TS
    import time

    if payload.get("mode") == "live":
        _LAST_GOOD = dict(payload)
        _LAST_GOOD_TS = time.time()
    return payload


def _stale_good_or_unavailable(error: str) -> Dict[str, Any]:
    import time

    if _LAST_GOOD and (time.time() - _LAST_GOOD_TS) <= _LAST_GOOD_MAX_AGE_SECONDS:
        stale = dict(_LAST_GOOD)
        stale["mode"] = "stale"
        stale["error"] = f"Serving last good solar snapshot ({error})"
        note = stale.get("donki_note") or ""
        stale["donki_note"] = f"{note} · refresh failed, showing cached live data".strip(" ·")
        return stale
    return get_unavailable_solar_activity(error)


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
    if not flares:
        return []
    noaa_goes = all(
        str(f.get("flrID", "")).startswith("NOAA-") or str(f.get("sourceLocation") or "") == "GOES"
        for f in flares
    )
    if noaa_goes:
        rows: List[Dict] = []
        ordered = sorted(
            flares,
            key=lambda f: str(f.get("peakTime") or f.get("beginTime") or ""),
            reverse=True,
        )
        for flare in ordered[:6]:
            cls_type = str(flare.get("classType") or "A")
            letter = cls_type[0]
            cls = "Beta-Gamma" if letter in ("X", "M") else "Beta" if letter == "C" else "Alpha"
            mag = "BGD" if letter in ("X", "M") else "B" if letter == "C" else "A"
            when = format_utc_short(flare.get("beginTime") or flare.get("peakTime"))
            rows.append(
                {
                    "id": f"{cls_type} · {when}",
                    "cls": cls,
                    "mag": mag,
                    "spots": 1,
                    "latest": cls_type,
                }
            )
        return rows

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
        "flareClass": "Unavailable",
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
        "feed_status": {},
        "error": error,
    }


def fetch_solar_activity() -> Dict[str, Any]:
    """Live NOAA + NASA DONKI fetch — parallel soft fetches so one feed can't block all."""

    def _load() -> Dict[str, Any]:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        _, using_demo = _nasa_api_key()
        jobs: dict[str, tuple[str, int]] = {
            "xrays": (NOAA_XRAY_1D_URL, TIMEOUT_SECONDS),
            "plasma": (NOAA_PLASMA_1D_URL, TIMEOUT_SECONDS),
            "mag": (NOAA_MAG_1D_URL, TIMEOUT_SECONDS),
            "alerts": (NOAA_ALERTS_URL, TIMEOUT_SECONDS),
            "noaa_flares": (NOAA_FLARES_7D_URL, TIMEOUT_SECONDS),
            "noaa_kp": (NOAA_KP_FORECAST_URL, TIMEOUT_SECONDS),
        }
        if not using_demo:
            jobs["flares"] = (_donki_url("FLR"), DONKI_TIMEOUT_SECONDS)
            jobs["cmes"] = (_donki_url("CME"), DONKI_TIMEOUT_SECONDS)
            jobs["storms"] = (_donki_url("GST"), DONKI_TIMEOUT_SECONDS)
        results: dict[str, Any] = {name: None for name in jobs}

        with ThreadPoolExecutor(max_workers=max(7, len(jobs))) as pool:
            futures = {
                pool.submit(_soft_fetch_json, url, timeout=timeout): name
                for name, (url, timeout) in jobs.items()
            }
            for fut in as_completed(futures):
                results[futures[fut]] = fut.result()

        xrays = results["xrays"]
        plasma_rows = results["plasma"]
        mag_rows = results["mag"]
        alerts = results["alerts"]
        flares, cmes, storms, event_sources, donki_status, donki_note = _resolve_event_feeds(
            using_demo=using_demo,
            results=results,
            alerts=alerts,
        )
        event_feed_source = _event_feed_source(event_sources, donki_status)

        noaa_ok = any(results[k] is not None for k in ("xrays", "plasma", "mag", "alerts"))
        donki_parts = [name for name in ("flares", "cmes", "storms") if results.get(name) is not None]
        if not noaa_ok and not event_sources:
            raise RuntimeError("All NOAA/NASA solar feeds failed or timed out")

        # GOES publishes both X-ray bands interleaved.  The operational flare
        # class is defined from the 0.1–0.8 nm band, so never use whichever
        # band happens to be the final array item.
        long_band_rows = [
            row for row in (xrays or [])
            if isinstance(row, dict) and row.get("energy") == "0.1-0.8nm" and row.get("time_tag")
        ]
        xray_latest = max(long_band_rows, key=lambda row: str(row["time_tag"])) if long_band_rows else {}
        flux = float(xray_latest.get("flux") or 0) if xray_latest else 0.0
        flare_class = xray_class(flux) if xray_latest else "Unavailable"
        xray_series = [
            float(row.get("flux") or 0)
            for row in (xrays or [])
            if isinstance(row, dict) and row.get("energy") == "0.1-0.8nm"
        ][-36:]

        plasma_latest = _latest_product_row(plasma_rows)
        speed = _float_or_zero(_product_value(plasma_rows, plasma_latest, "proton_speed", "speed"))
        density = _float_or_zero(_product_value(plasma_rows, plasma_latest, "proton_density", "density"))
        temperature = _float_or_zero(
            _product_value(plasma_rows, plasma_latest, "proton_temperature", "temperature")
        )

        mag_latest = _latest_product_row(mag_rows)
        bt = _float_or_zero(_product_value(mag_rows, mag_latest, "bt"))
        bz = _float_or_zero(_product_value(mag_rows, mag_latest, "bz_gsm", "bz"))

        alert_list = list(reversed(alerts[-5:])) if isinstance(alerts, list) else []

        xray_time = xray_latest.get("time_tag") if xray_latest else None
        plasma_time = plasma_latest.get("time_tag") if isinstance(plasma_latest, dict) else None
        mag_time = mag_latest.get("time_tag") if isinstance(mag_latest, dict) else None
        feed_status = {
            "goes_xray": _feed_state(
                reachable=results["xrays"] is not None,
                timestamp=xray_time,
                max_age_minutes=_NOAA_MAX_AGE_MINUTES,
            ),
            "solar_wind_plasma": _feed_state(
                reachable=results["plasma"] is not None,
                timestamp=plasma_time,
                max_age_minutes=_NOAA_MAX_AGE_MINUTES,
            ),
            "solar_wind_mag": _feed_state(
                reachable=results["mag"] is not None,
                timestamp=mag_time,
                max_age_minutes=_NOAA_MAX_AGE_MINUTES,
            ),
            # An empty alerts list is a valid current response.
            "swpc_alerts": _feed_state(reachable=results["alerts"] is not None),
            "nasa_donki": _feed_state(reachable=donki_status == "live"),
        }
        xray_fresh = bool(feed_status["goes_xray"]["fresh"])
        plasma_fresh = bool(feed_status["solar_wind_plasma"]["fresh"])
        mag_fresh = bool(feed_status["solar_wind_mag"]["fresh"])
        if not xray_fresh:
            flare_class = "Unavailable"
            flux = 0.0
            xray_series = []
        if not plasma_fresh:
            speed = density = temperature = 0.0
            plasma_latest = None
        if not mag_fresh:
            bt = bz = 0.0
            mag_latest = None
        level = (
            activity_level(flare_class, len(alert_list))
            if xray_fresh
            else {"label": "Unavailable", "color": "#ffffff", "gnss": "Current GOES X-ray data unavailable"}
        )

        routes = []
        if results["xrays"] is not None:
            routes.append("NOAA SWPC goes/primary/xrays-1-day")
        if results["plasma"] is not None or results["mag"] is not None:
            routes.append("NOAA SWPC solar-wind/plasma + mag")
        if results["alerts"] is not None:
            routes.append("NOAA SWPC alerts.json")
        if donki_status == "live":
            routes.append("NASA DONKI FLR / CME / GST")

        return {
            "mode": "live" if xray_fresh else "partial" if noaa_ok or event_sources else "unavailable",
            "updated": (
                (plasma_latest or {}).get("time_tag")
                if isinstance(plasma_latest, dict)
                else xray_latest.get("time_tag")
            )
            or xray_latest.get("time_tag")
            or datetime.datetime.utcnow().isoformat() + "Z",
            "flareClass": flare_class,
            "flux": flux if xray_latest else None,
            "xraySeries": xray_series,
            "solarWind": {
                "speed": speed if plasma_latest is not None else None,
                "density": density if plasma_latest is not None else None,
                "temperature": temperature if plasma_latest is not None else None,
                "bt": bt if mag_latest is not None else None,
                "bz": bz if mag_latest is not None else None,
            },
            "alerts": alert_list,
            "donki": {
                "flares": flares,
                "cmes": cmes,
                "storms": storms,
                "dateRange": {"start": _iso_date(6), "end": _iso_date(0)},
            },
            "donki_status": donki_status,
            "donki_note": donki_note,
            "event_feed_source": event_feed_source,
            "level": level,
            "api_routes": routes or ["Live NOAA/NASA feeds unavailable"],
            "feed_status": feed_status,
        }

    try:
        payload = _cached("solar_activity", _load)
        if payload.get("mode") == "live":
            return _remember_good(payload)
        # Don't cache hard-unavailable over a recent good snapshot.
        return _stale_good_or_unavailable(str(payload.get("error") or "solar feeds unavailable"))
    except Exception as exc:
        return _stale_good_or_unavailable(str(exc))


def get_solar_activity(force_refresh: bool = False) -> Dict[str, Any]:
    if force_refresh:
        _CACHE.pop("solar_activity", None)
    return fetch_solar_activity()
