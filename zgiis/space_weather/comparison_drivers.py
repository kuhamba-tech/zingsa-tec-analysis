"""Date-selected heliospheric observations for the source comparison page."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import math

import requests

from .source_cache import read_source, write_source

OMNI_ROOT = "https://spdf.gsfc.nasa.gov/pub/data/omni/low_res_omni/"
# Zero-based words from https://omniweb.gsfc.nasa.gov/html/ow_data.html
FIELDS = {
    "bt": (8, 999.9), "by": (15, 999.9), "bz": (16, 999.9),
    "temperature": (22, 9999999), "density": (23, 999.9), "speed": (24, 9999),
    "omni_p10": (45, 99999.99), "omni_p30": (46, 99999.99), "omni_p60": (47, 99999.99),
    "dst": (40, 99999),
}
STORED = {
    "xray_flux": "goes_xray_long", "xray_short_flux": "goes_xray_short",
    "dst": "dst",
    "proton_ge10mev": "goes_p10", "proton_ge50mev": "goes_p50",
    "proton_ge100mev": "goes_p100", "proton_ge500mev": "goes_p500",
    "imf_bt": "bt", "imf_by": "by", "imf_bz": "bz",
    "solar_wind_speed": "speed", "solar_wind_density": "density",
    "solar_wind_temperature": "temperature",
}


def parse_omni(text: str, start: date, end: date) -> list[dict]:
    rows = []
    for line in text.splitlines():
        words = line.split()
        if len(words) < 48:
            continue
        try:
            year, doy, hour = map(int, words[:3])
            stamp = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1, hours=hour)
            if not 1 <= doy <= (366 if date(year, 12, 31).timetuple().tm_yday == 366 else 365) or not 0 <= hour < 24:
                continue
        except ValueError:
            continue
        if not start <= stamp.date() <= end:
            continue
        row = {"time": stamp.isoformat().replace("+00:00", "Z"), "source": "NASA OMNI hourly"}
        for key, (index, fill) in FIELDS.items():
            try:
                value = float(words[index])
                valid = math.isfinite(value) and abs(value) < fill
                if key not in ("by", "bz", "dst"):
                    valid = valid and value >= 0
                row[key] = value if valid else None
            except ValueError:
                row[key] = None
        rows.append(row)
    return rows


def _year(year: int) -> str:
    url = f"{OMNI_ROOT}omni2_{year}.dat"
    cached = read_source("comparison-omni", url, max_age=3600)
    if cached is not None:
        return cached.decode("ascii")
    with requests.get(url, timeout=(8, 35), stream=True) as response:
        response.raise_for_status()
        raw = bytearray()
        for chunk in response.iter_content(65536):
            raw.extend(chunk)
            if len(raw) > 5_000_000:
                raise ValueError("OMNI file exceeds expected size")
    text = raw.decode("ascii")
    if not parse_omni(text, date(year, 1, 1), date(year, 12, 31)):
        raise ValueError("OMNI response contains no valid hourly records")
    write_source("comparison-omni", url, bytes(raw))
    return text


def _noaa(start: date, end: date) -> tuple[list[dict], list[str]]:
    from .graph_archive import _database, _db_lock
    rows: dict[str, dict] = {}
    notes = []
    left = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    right = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if right >= now - timedelta(days=90):
        if _db_lock.acquire(timeout=1):
            try:
                saved = _database().read_timeline_bins(list(STORED), since=left, before=right, bin_minutes=15)
                for metric, samples in saved.items():
                    for stamp, value in samples:
                        if not left <= stamp < right:
                            continue
                        key = stamp.isoformat().replace("+00:00", "Z")
                        rows.setdefault(key, {"time": key, "source": "Stored NOAA, 15-minute means"})[STORED[metric]] = value
            except Exception:
                notes.append("Stored NOAA history could not be read; other sources remain available.")
            finally:
                _db_lock.release()
        else:
            notes.append("Stored NOAA history is busy; retry to include archived samples.")
    if right >= now - timedelta(days=7) and left <= now:
        from .heliospheric_monitor import build_heliospheric_monitor
        try:
            payload = build_heliospheric_monitor()
            for panel_name, mapping in [
                ("xray", {"flux": "goes_xray_long", "short_flux": "goes_xray_short"}),
                ("dst", {"dst": "dst"}),
                ("imf", {"bt": "bt", "by": "by", "bz": "bz"}),
                ("solar_wind", {"speed": "speed", "density": "density", "temperature": "temperature"}),
                ("protons", {">=10 MeV": "goes_p10", ">=50 MeV": "goes_p50", ">=100 MeV": "goes_p100", ">=500 MeV": "goes_p500"}),
            ]:
                panel = payload.get(panel_name) or {}
                arrays = panel.get("series", panel) if panel_name == "protons" else panel
                for index, key in enumerate(panel.get("times") or []):
                    stamp = datetime.fromisoformat(key.replace("Z", "+00:00"))
                    if not left <= stamp < right:
                        continue
                    row = rows.setdefault(key, {"time": key, "source": "NOAA SWPC recent feed / stored history"})
                    for field, target in mapping.items():
                        values = arrays.get(field) or []
                        if index < len(values) and values[index] is not None:
                            row[target] = values[index]
        except Exception:
            notes.append("Recent NOAA feeds could not refresh; only stored observations are shown.")
    return list(rows.values()), notes


def build_comparison_drivers(start: date, end: date) -> dict:
    if end < start:
        raise ValueError("Start date must not be after end date")
    if (end - start).days > 1096:
        raise ValueError("Select at most three years per request")
    now = datetime.now(timezone.utc)
    if start > now.date():
        return {"start": start.isoformat(), "end": end.isoformat(), "rows": [], "notes": ["The selected dates are in the future; no observations exist."]}
    last = min(end, now.date())
    rows, notes = [], []
    with ThreadPoolExecutor(max_workers=5) as pool:
        noaa = pool.submit(_noaa, start, last)
        years = {year: pool.submit(_year, year) for year in range(max(1963, start.year), last.year + 1)}
        for year, future in years.items():
            try:
                rows.extend(parse_omni(future.result(), start, last))
            except Exception:
                notes.append(f"NASA OMNI hourly observations for {year} could not be retrieved.")
        try:
            saved, messages = noaa.result()
            rows.extend(saved)
            notes.extend(messages)
        except Exception:
            notes.append("NOAA history could not be retrieved.")
    rows.sort(key=lambda row: row["time"])
    return {"start": start.isoformat(), "end": end.isoformat(), "rows": rows, "notes": notes,
            "source_url": "https://omniweb.gsfc.nasa.gov/html/ow_data.html",
            "fetched_at": now.isoformat()}
