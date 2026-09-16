"""NOAA heliospheric monitor series inspired by KNMI spaceweather panels.

Provides downsampled timelines for:
  - GOES integral proton flux (selected MeV channels)
  - RTSW IMF Bt / By / Bz (GSM)
  - RTSW solar-wind speed
  - NOAA planetary Kp observed + estimated + predicted

All values are genuine NOAA SWPC products — never fabricated.
"""
from __future__ import annotations

import datetime
import math
import threading
import time
from collections import defaultdict
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

NOAA_PROTONS_3D_URL = (
    "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-3-day.json"
)
NOAA_XRAY_1D_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"
NOAA_MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json"
NOAA_WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"
NOAA_KP_FORECAST_URL = (
    "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
)
NOAA_DST_URL = "https://services.swpc.noaa.gov/products/kyoto-dst.json"

# Match KNMI-style energy bands (subset of GOES integral channels).
PROTON_ENERGIES = (">=10 MeV", ">=50 MeV", ">=100 MeV", ">=500 MeV")

_HEADERS = {"Accept": "application/json", "User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather dashboard)"}
_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECONDS = 300


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    # NOAA sentinel for bad RTSW samples
    if number <= -9990:
        return None
    return number


def _parse_utc(value: Any) -> datetime.datetime | None:
    if not value:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    return stamp.astimezone(datetime.timezone.utc)


def _label_hour(stamp: datetime.datetime) -> str:
    return stamp.strftime("%m-%d %H:%MZ")


def downsample(points: list[dict[str, Any]], *, max_points: int = 288) -> list[dict[str, Any]]:
    """Keep chronological order (oldest → newest) and thin to max_points."""
    if not points:
        return points
    points = sorted(
        points,
        key=lambda p: (
            p.get("epoch_ms")
            if isinstance(p.get("epoch_ms"), (int, float))
            else str(p.get("t") or "")
        ),
    )
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    sampled = points[::step]
    if sampled[-1] is not points[-1]:
        sampled.append(points[-1])
    return sampled


def parse_proton_series(rows: list[Any], *, energies: tuple[str, ...] = PROTON_ENERGIES) -> dict[str, Any]:
    """Pivot GOES integral proton rows into per-energy timelines aligned by time."""
    wanted = set(energies)
    by_time: dict[str, dict[str, float]] = defaultdict(dict)
    stamps: dict[str, datetime.datetime] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        energy = str(row.get("energy") or "").strip()
        if energy not in wanted:
            continue
        stamp = _parse_utc(row.get("time_tag"))
        flux = _float_or_none(row.get("flux"))
        if stamp is None or flux is None or flux < 0:
            continue
        key = stamp.isoformat().replace("+00:00", "Z")
        by_time[key][energy] = flux
        stamps[key] = stamp

    ordered_keys = sorted(by_time.keys())
    points = []
    for key in ordered_keys:
        stamp = stamps[key]
        values = by_time[key]
        points.append(
            {
                "t": key,
                "label": _label_hour(stamp),
                "fluxes": {energy: values.get(energy) for energy in energies},
            }
        )
    points = downsample(points)
    series = {
        energy: [p["fluxes"].get(energy) for p in points]
        for energy in energies
    }
    return {
        "labels": [p["label"] for p in points],
        "times": [p["t"] for p in points],
        "epoch_ms": [
            int(_parse_utc(p["t"]).timestamp() * 1000) if _parse_utc(p["t"]) else None
            for p in points
        ],
        "series": series,
        "unit": "pfu",
    }


def parse_imf_series(rows: list[Any]) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("active") is False:
            continue
        stamp = _parse_utc(row.get("time_tag"))
        bt = _float_or_none(row.get("bt"))
        by = _float_or_none(row.get("by_gsm"))
        bz = _float_or_none(row.get("bz_gsm"))
        if stamp is None or (bt is None and by is None and bz is None):
            continue
        points.append(
            {
                "t": stamp.isoformat().replace("+00:00", "Z"),
                "label": _label_hour(stamp),
                "bt": bt,
                "by": by,
                "bz": bz,
                "epoch_ms": int(stamp.timestamp() * 1000),
            }
        )
    points = downsample(points)
    return {
        "labels": [p["label"] for p in points],
        "times": [p["t"] for p in points],
        "epoch_ms": [p["epoch_ms"] for p in points],
        "bt": [p["bt"] for p in points],
        "by": [p["by"] for p in points],
        "bz": [p["bz"] for p in points],
        "unit": "nT",
    }


def parse_solar_wind_speed_series(rows: list[Any]) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("active") is False:
            continue
        stamp = _parse_utc(row.get("time_tag"))
        speed = _float_or_none(row.get("proton_speed") or row.get("speed"))
        density = _float_or_none(row.get("proton_density") or row.get("density"))
        if stamp is None or (speed is None and density is None):
            continue
        if speed is not None and speed <= 0:
            speed = None
        if density is not None and density < 0:
            density = None
        if speed is None and density is None:
            continue
        points.append(
            {
                "t": stamp.isoformat().replace("+00:00", "Z"),
                "label": _label_hour(stamp),
                "speed": speed,
                "density": density,
                "epoch_ms": int(stamp.timestamp() * 1000),
            }
        )
    points = downsample(points)
    return {
        "labels": [p["label"] for p in points],
        "times": [p["t"] for p in points],
        "epoch_ms": [p["epoch_ms"] for p in points],
        "speed": [p["speed"] for p in points],
        "density": [p["density"] for p in points],
        "unit": "km/s · cm⁻³",
    }


def parse_xray_series(rows: list[Any]) -> dict[str, Any]:
    """GOES 0.1–0.8 nm long-band flux with ISO times (W/m²)."""
    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("energy") or "") != "0.1-0.8nm":
            continue
        stamp = _parse_utc(row.get("time_tag"))
        flux = _float_or_none(row.get("flux"))
        if stamp is None or flux is None or flux <= 0:
            continue
        points.append(
            {
                "t": stamp.isoformat().replace("+00:00", "Z"),
                "label": _label_hour(stamp),
                "flux": flux,
                "epoch_ms": int(stamp.timestamp() * 1000),
            }
        )
    points = downsample(points, max_points=360)
    return {
        "labels": [p["label"] for p in points],
        "times": [p["t"] for p in points],
        "epoch_ms": [p["epoch_ms"] for p in points],
        "flux": [p["flux"] for p in points],
        "unit": "W/m²",
    }


def parse_dst_series(rows: list[Any]) -> dict[str, Any]:
    """Kyoto Dst product — supports dict rows ({time_tag, dst}) or legacy [time, dst] lists."""
    points: list[dict[str, Any]] = []
    if not isinstance(rows, list) or not rows:
        return {"labels": [], "times": [], "epoch_ms": [], "dst": [], "unit": "nT"}

    for row in rows:
        stamp = None
        dst = None
        if isinstance(row, dict):
            stamp = _parse_utc(row.get("time_tag") or row.get("time"))
            dst = _float_or_none(row.get("dst"))
        elif isinstance(row, (list, tuple)) and len(row) >= 2:
            # Skip header row like ["time_tag", "dst"]
            if str(row[0]).lower().startswith("time"):
                continue
            stamp = _parse_utc(row[0])
            dst = _float_or_none(row[1])
        if stamp is None or dst is None:
            continue
        points.append(
            {
                "t": stamp.isoformat().replace("+00:00", "Z"),
                "label": _label_hour(stamp),
                "dst": dst,
                "epoch_ms": int(stamp.timestamp() * 1000),
            }
        )
    points = downsample(points, max_points=360)
    return {
        "labels": [p["label"] for p in points],
        "times": [p["t"] for p in points],
        "epoch_ms": [p["epoch_ms"] for p in points],
        "dst": [p["dst"] for p in points],
        "unit": "nT",
    }


def parse_kp_forecast_series(rows: list[Any]) -> dict[str, Any]:
    """Split NOAA Kp forecast product into observed / estimated / predicted bars."""
    labels: list[str] = []
    times: list[str] = []
    observed: list[float | None] = []
    estimated: list[float | None] = []
    predicted: list[float | None] = []
    kinds: list[str] = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        stamp = _parse_utc(row.get("time_tag"))
        kp = _float_or_none(row.get("kp"))
        kind = str(row.get("observed") or "").strip().lower() or "unknown"
        if stamp is None or kp is None:
            continue
        iso = stamp.isoformat().replace("+00:00", "Z")
        labels.append(stamp.strftime("%m-%d %HZ"))
        times.append(iso)
        kinds.append(kind)
        observed.append(kp if kind == "observed" else None)
        estimated.append(kp if kind == "estimated" else None)
        predicted.append(kp if kind == "predicted" else None)

    return {
        "labels": labels,
        "times": times,
        "epoch_ms": [
            int(_parse_utc(t).timestamp() * 1000) if _parse_utc(t) else None for t in times
        ],
        "kinds": kinds,
        "observed": observed,
        "estimated": estimated,
        "predicted": predicted,
        "unit": "Kp",
    }


def _fetch_json(url: str, *, timeout: int = 20) -> Any:
    if not _REQUESTS_OK:
        raise RuntimeError("requests not installed")
    resp = requests.get(url, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()


def _soft_fetch(url: str) -> tuple[Any | None, str | None]:
    try:
        return _fetch_json(url), None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def build_heliospheric_monitor(*, force_refresh: bool = False) -> dict[str, Any]:
    cache_key = "heliospheric_monitor"
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if (
            not force_refresh
            and cached
            and now - cached["ts"] < _CACHE_TTL_SECONDS
            and isinstance(cached.get("data"), dict)
        ):
            return cached["data"]

    protons_raw, protons_err = _soft_fetch(NOAA_PROTONS_3D_URL)
    xray_raw, xray_err = _soft_fetch(NOAA_XRAY_1D_URL)
    mag_raw, mag_err = _soft_fetch(NOAA_MAG_URL)
    wind_raw, wind_err = _soft_fetch(NOAA_WIND_URL)
    kp_raw, kp_err = _soft_fetch(NOAA_KP_FORECAST_URL)
    dst_raw, dst_err = _soft_fetch(NOAA_DST_URL)

    protons = parse_proton_series(protons_raw if isinstance(protons_raw, list) else [])
    xray = parse_xray_series(xray_raw if isinstance(xray_raw, list) else [])
    imf = parse_imf_series(mag_raw if isinstance(mag_raw, list) else [])
    wind = parse_solar_wind_speed_series(wind_raw if isinstance(wind_raw, list) else [])
    kp = parse_kp_forecast_series(kp_raw if isinstance(kp_raw, list) else [])
    dst = parse_dst_series(dst_raw if isinstance(dst_raw, list) else [])

    has_any = bool(
        protons["labels"]
        or xray["labels"]
        or imf["labels"]
        or wind["labels"]
        or kp["labels"]
        or dst["labels"]
    )
    payload = {
        "mode": "live" if has_any else "unavailable",
        "source": "NOAA SWPC GOES X-ray/protons · RTSW mag/wind · planetary Kp · Kyoto Dst",
        "updated_utc": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "xray": xray,
        "protons": protons,
        "imf": imf,
        "solar_wind": wind,
        "kp": kp,
        "dst": dst,
        "errors": {
            "xray": xray_err,
            "protons": protons_err,
            "imf": mag_err,
            "solar_wind": wind_err,
            "kp": kp_err,
            "dst": dst_err,
        },
    }
    with _CACHE_LOCK:
        _CACHE[cache_key] = {"ts": now, "data": payload}
    return payload


def clear_heliospheric_monitor_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
