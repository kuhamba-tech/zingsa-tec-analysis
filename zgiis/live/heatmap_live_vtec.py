"""On-demand live NTRIP VTEC samples for the TEC heat map (no archive fallback)."""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_TTL_SEC = 90.0
# Persistent hosts can afford a wider sample; Vercel must finish inside maxDuration.
DEFAULT_LISTEN_SEC = 10.0
DEFAULT_MAX_STATIONS = 8
SERVERLESS_LISTEN_SEC = 6.0
SERVERLESS_MAX_STATIONS = 4
SERVERLESS_MAX_WORKERS = 4
# Spread across Zimbabwe so the Matamba surface is not a single-point copy.
DEFAULT_PRIORITY = (
    "zinh",
    "hara",
    "lupa",
    "beit",
    "kwek",
    "tsho",
    "masv",
    "karo",
    "gsu",
    "bula",
    "vicf",
    "muta",
    "chim",
)


def _is_serverless_runtime() -> bool:
    return bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0


def live_ntrip_heatmap_enabled() -> bool:
    raw = os.getenv("TEC_HEATMAP_LIVE_NTRIP", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _priority_codes(mountpoints: dict[str, str], *, max_stations: int) -> list[str]:
    env_codes = [
        code.strip().lower()
        for code in os.getenv("TEC_HEATMAP_LIVE_STATIONS", "").split(",")
        if code.strip()
    ]
    ordered: list[str] = []
    for code in env_codes + list(DEFAULT_PRIORITY) + sorted(mountpoints):
        if code in mountpoints and code not in ordered:
            ordered.append(code)
        if len(ordered) >= max_stations:
            break
    return ordered


def _warm_nav_cache():
    from zgiis.live.broadcast_ephemeris import fetch_gps_nav
    from zgiis.live.satellite_geometry import LiveNavCache

    nav = LiveNavCache()
    try:
        nav_by_sv = fetch_gps_nav()
        if nav_by_sv:
            updated = nav.bulk_update_gps(nav_by_sv)
            log.info("Heatmap live VTEC: warmed GPS ephemeris for %d SV(s)", updated)
    except Exception as exc:
        log.warning("Heatmap live VTEC: ephemeris warm failed (%s)", exc)
    return nav


def _sample_station(
    *,
    code: str,
    mountpoint: str,
    host: str,
    port: int,
    username: str,
    password: str,
    listen_sec: float,
    nav_cache,
) -> dict[str, Any]:
    from zgiis.live.ntrip_probe import probe_mountpoint

    row = probe_mountpoint(
        host=host,
        port=port,
        username=username,
        password=password,
        mountpoint=mountpoint,
        station_code=code,
        sample_vtec=True,
        listen_sec=listen_sec,
        nav_cache=nav_cache,
    )
    row["station"] = code
    return row


def sample_live_ntrip_vtec(
    *,
    refresh: bool = False,
    listen_sec: float | None = None,
    ttl_sec: float = DEFAULT_TTL_SEC,
    max_stations: int | None = None,
) -> dict[str, Any]:
    """Probe a geographic subset of CORS mountpoints and return live VTEC samples."""
    global _CACHE, _CACHE_TS

    if not live_ntrip_heatmap_enabled():
        return {
            "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stations": [],
            "error": "TEC heat-map live NTRIP sampling is disabled (TEC_HEATMAP_LIVE_NTRIP=0).",
        }

    age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
    if not refresh and _CACHE is not None and age is not None and age <= ttl_sec:
        return _CACHE

    from zgiis.live.mountpoints import parse_mountpoints
    from zgiis.live.ntrip_config import ntrip_host_from_env

    host = ntrip_host_from_env()
    port = int(os.getenv("NTRIP_PORT", "2101"))
    username = os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("NTRIP_PASSWORD", "").strip()
    mountpoints = parse_mountpoints()
    if not (host and username and password and mountpoints):
        payload = {
            "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stations": [],
            "error": "NTRIP credentials or mountpoints are not configured.",
        }
        _CACHE = payload
        _CACHE_TS = time.monotonic()
        return payload

    serverless = _is_serverless_runtime()
    default_listen = SERVERLESS_LISTEN_SEC if serverless else DEFAULT_LISTEN_SEC
    default_limit = SERVERLESS_MAX_STATIONS if serverless else DEFAULT_MAX_STATIONS
    default_workers = SERVERLESS_MAX_WORKERS if serverless else 4
    listen = float(
        listen_sec
        if listen_sec is not None
        else os.getenv("TEC_HEATMAP_LIVE_LISTEN_SEC", default_listen)
    )
    limit = int(
        max_stations
        if max_stations is not None
        else os.getenv("TEC_HEATMAP_LIVE_MAX_STATIONS", default_limit)
    )
    codes = _priority_codes(mountpoints, max_stations=max(1, limit))
    nav_cache = _warm_nav_cache()
    workers = max(
        1,
        min(len(codes), int(os.getenv("TEC_HEATMAP_LIVE_MAX_WORKERS", str(default_workers)))),
    )

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _sample_station,
                code=code,
                mountpoint=mountpoints[code],
                host=host,
                port=port,
                username=username,
                password=password,
                listen_sec=listen,
                nav_cache=nav_cache,
            ): code
            for code in codes
        }
        for fut in as_completed(futures):
            code = futures[fut]
            try:
                rows.append(fut.result())
            except Exception as exc:
                rows.append(
                    {
                        "station": code,
                        "mountpoint": mountpoints.get(code),
                        "verdict": "offline",
                        "error": str(exc),
                        "mean_vtec_tecu": None,
                    }
                )

    with_vtec = sum(1 for row in rows if float(row.get("mean_vtec_tecu") or 0) > 0)
    payload = {
        "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stations": rows,
        "summary": {
            "requested": len(codes),
            "returned": len(rows),
            "with_vtec": with_vtec,
        },
        "error": None if with_vtec else (
            "Live NTRIP connected but no VTEC samples decoded — "
            "need MSM observations plus broadcast ephemeris."
        ),
    }
    _CACHE = payload
    _CACHE_TS = time.monotonic()
    return payload


def rows_by_station(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not payload:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in payload.get("stations") or []:
        code = str(row.get("station", "")).lower().rstrip("_")
        if code:
            out[code] = row
    return out
