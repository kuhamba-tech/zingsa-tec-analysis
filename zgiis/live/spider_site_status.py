"""Fetch live site online/offline status from Leica Spider Business Center.

Spider Site Status (Status==3 ⇒ online/blue, otherwise offline/red) is the
operational ground truth for the national CORS map. The public SiteMap page
does not expose live Status values; an authenticated session is required.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0
_FETCH_LOCK = threading.Lock()
DEFAULT_TTL_SEC = 60.0
DEFAULT_TIMEOUT_SEC = 12.0

# Spider Status codes used by SiteMap JS (getSiteStatusClass):
#   0 = unavailable, 3 = online/connected, anything else = offline/disconnected
_SPIDER_ONLINE = 3


def _spider_base_url() -> str:
    configured = os.getenv("SPIDER_BASE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    host = os.environ.get("NTRIP_HOST", "").strip().strip('"').strip("'").rstrip("/")
    if not host:
        return ""
    # NTRIP_HOST is accepted elsewhere as either a bare hostname/IP or a URL.
    # Preserve an existing scheme; prepending ``http://`` to a URL produces
    # ``http://http://...`` and makes requests resolve a host literally named
    # "http" in production.
    base = host if "://" in host else f"http://{host}"
    if base.lower().endswith("/sbc"):
        return base
    return f"{base}/sbc"


def _spider_credentials() -> tuple[str, str]:
    user = os.getenv("SPIDER_USERNAME", "").strip() or os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("SPIDER_PASSWORD", "").strip() or os.getenv("NTRIP_PASSWORD", "").strip()
    return user, password


def spider_status_enabled() -> bool:
    raw = os.getenv("SPIDER_SITE_STATUS_ENABLED", "1").strip().lower()
    if raw in {"0", "false", "no", "off"}:
        return False
    base = _spider_base_url()
    user, password = _spider_credentials()
    return bool(base and user and password)


def _station_code_from_site_code(site_code: str) -> str:
    return (site_code or "").strip().lower().rstrip("_")


def spider_status_to_map(status_code: int | None) -> str:
    if status_code == _SPIDER_ONLINE:
        return "online"
    return "offline"


def _parse_sites_json(html: str) -> list[dict[str, Any]]:
    match = re.search(r"var\s+Sites\s*=\s*(\[.*?\]);", html, re.S)
    if not match:
        match = re.search(r"window\.Sites\s*=\s*(\[.*?\]);", html, re.S)
    if not match:
        return []
    import json

    data = json.loads(match.group(1))
    return data if isinstance(data, list) else []


def _extract_antiforgery(html: str) -> str | None:
    match = re.search(
        r'name="__RequestVerificationToken"[^>]*value="([^"]+)"',
        html,
    )
    return match.group(1) if match else None


def fetch_spider_site_statuses(*, timeout: float = DEFAULT_TIMEOUT_SEC) -> dict[str, Any]:
    """Return {by_station: {code: {status, spider_status, site_code}}, error}."""
    base = _spider_base_url()
    user, password = _spider_credentials()
    if not (base and user and password):
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider base URL or credentials are not configured",
        }

    session = requests.Session()
    session.headers.update({"User-Agent": "ZGIIS-SpiderSiteStatus/1.0"})
    try:
        login_page = session.get(f"{base}/Account/Index", timeout=timeout, allow_redirects=True)
        login_page.raise_for_status()
        token = _extract_antiforgery(login_page.text)
        payload = {
            "UserName": user,
            "Password": password,
            "RememberMe": "false",
        }
        if token:
            payload["__RequestVerificationToken"] = token
        session.post(
            f"{base}/Account/Index",
            data=payload,
            timeout=timeout,
            allow_redirects=True,
        )
        sitemap = session.get(
            f"{base}/User/SiteMap/SiteMap",
            timeout=timeout,
            allow_redirects=True,
        )
        sitemap.raise_for_status()
        sites = _parse_sites_json(sitemap.text)
        if not sites:
            return {
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "by_station": {},
                "error": "Logged in but SiteMap did not include a Sites array",
            }

        by_station: dict[str, dict[str, Any]] = {}
        for row in sites:
            site_code = str(row.get("SiteCode") or "").strip()
            if not site_code:
                continue
            code = _station_code_from_site_code(site_code)
            try:
                spider_status = int(row.get("Status"))
            except (TypeError, ValueError):
                spider_status = -1
            by_station[code] = {
                "site_code": site_code,
                "spider_status": spider_status,
                "status": spider_status_to_map(spider_status),
                "last_update": row.get("LastUpdateDateTime"),
            }

        return {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "by_station": by_station,
            "error": None,
        }
    except Exception as exc:
        log.warning("Spider site status fetch failed: %s", exc)
        return {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "by_station": {},
            "error": str(exc),
        }


def get_cached_spider_site_statuses(
    *,
    refresh: bool = False,
    ttl_sec: float = DEFAULT_TTL_SEC,
) -> dict[str, Any]:
    """Return cached Spider statuses; refresh in-process with a single-flight lock.

    Stale cache is preferred over blocking the API when Spider is slow/unreachable.
    """
    global _CACHE, _CACHE_TS
    del refresh  # callers may pass refresh; TTL + single-flight decide when to hit Spider
    if not spider_status_enabled():
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status is disabled",
        }

    age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
    have_rows = bool(_CACHE and (_CACHE.get("by_station") or {}))
    if have_rows and age is not None and age <= ttl_sec:
        return _CACHE  # type: ignore[return-value]

    if not _FETCH_LOCK.acquire(blocking=False):
        if have_rows:
            return _CACHE  # type: ignore[return-value]
        acquired = _FETCH_LOCK.acquire(timeout=DEFAULT_TIMEOUT_SEC + 2.0)
        if not acquired:
            return _CACHE or {
                "fetched_at": None,
                "by_station": {},
                "error": "Spider site status fetch busy",
            }
        try:
            return _CACHE or {
                "fetched_at": None,
                "by_station": {},
                "error": "Spider site status fetch busy",
            }
        finally:
            _FETCH_LOCK.release()

    try:
        age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
        have_rows = bool(_CACHE and (_CACHE.get("by_station") or {}))
        if have_rows and age is not None and age <= ttl_sec:
            return _CACHE  # type: ignore[return-value]

        payload = fetch_spider_site_statuses()
        if payload.get("by_station"):
            _CACHE = payload
            _CACHE_TS = time.monotonic()
            return _CACHE
        if have_rows:
            log.warning(
                "Keeping stale Spider site status (%s)",
                payload.get("error") or "empty result",
            )
            return _CACHE  # type: ignore[return-value]
        _CACHE = payload
        _CACHE_TS = time.monotonic()
        return _CACHE
    finally:
        _FETCH_LOCK.release()
