"""Fetch live site online/offline status from Leica Spider Business Center.

Spider Site Status (Status==3 ⇒ online/blue, otherwise offline/red) is the
operational ground truth for the national CORS map. The public SiteMap page
does not expose live Status values; an authenticated session is required.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0
DEFAULT_TTL_SEC = 60.0

# Spider Status codes used by SiteMap JS (getSiteStatusClass):
#   0 = unavailable, 3 = online/connected, anything else = offline/disconnected
_SPIDER_ONLINE = 3


def _spider_base_url() -> str:
    configured = os.getenv("SPIDER_BASE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    host = os.environ.get("NTRIP_HOST", "").strip()
    if not host:
        return ""
    return f"http://{host}/sbc"


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


def fetch_spider_site_statuses(*, timeout: float = 30.0) -> dict[str, Any]:
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
    global _CACHE, _CACHE_TS
    if not spider_status_enabled():
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status is disabled",
        }
    age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
    if refresh or _CACHE is None or age is None or age > ttl_sec:
        _CACHE = fetch_spider_site_statuses()
        _CACHE_TS = time.monotonic()
    return _CACHE
