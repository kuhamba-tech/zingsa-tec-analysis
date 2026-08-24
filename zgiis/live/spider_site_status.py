"""Fetch live site online/offline status from Leica Spider Business Center.

Spider Site Status (Status==3 ⇒ online/blue, otherwise offline/red) is the
operational ground truth for the national CORS map. The public SiteMap page
does not expose live Status values; an authenticated session is required.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0
_DISK_LOADED = False
_FETCH_LOCK = threading.Lock()
DEFAULT_TTL_SEC = 60.0
DEFAULT_TIMEOUT_SEC = 12.0
# Keep last-good Spider rows across Vercel cold starts (catalog is not live).
DISK_MAX_AGE_SEC = float(os.getenv("SPIDER_STATUS_DISK_MAX_AGE_SEC", str(30 * 60)))

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


def _disk_cache_paths() -> list[Path]:
    """Prefer /tmp on serverless; also try repo static/data when writable."""
    paths: list[Path] = []
    env = (os.getenv("SPIDER_STATUS_CACHE_PATH") or "").strip()
    if env:
        paths.append(Path(env))
    paths.append(Path(tempfile_dir()) / "zgiis-spider-site-status.json")
    paths.append(
        Path(__file__).resolve().parents[2] / "static" / "data" / "spider_site_status.json"
    )
    # Deduplicate while preserving order.
    seen: set[str] = set()
    out: list[Path] = []
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        out.append(path)
    return out


def tempfile_dir() -> str:
    return os.getenv("TMPDIR") or os.getenv("TEMP") or "/tmp"


def _payload_has_rows(payload: dict[str, Any] | None) -> bool:
    return bool(payload and (payload.get("by_station") or {}))


def _read_disk_cache() -> dict[str, Any] | None:
    now = time.time()
    for path in _disk_cache_paths():
        try:
            if not path.is_file():
                continue
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or not _payload_has_rows(raw):
                continue
            saved_at = float(raw.get("disk_saved_at") or 0)
            if saved_at and (now - saved_at) > DISK_MAX_AGE_SEC:
                continue
            by_station = raw.get("by_station") or {}
            return {
                "fetched_at": raw.get("fetched_at"),
                "by_station": by_station,
                "error": None,
                "from_disk": True,
            }
        except Exception as exc:
            log.debug("Spider disk cache read failed (%s): %s", path, exc)
    return None


def _write_disk_cache(payload: dict[str, Any]) -> None:
    if not _payload_has_rows(payload):
        return
    body = {
        "fetched_at": payload.get("fetched_at"),
        "by_station": payload.get("by_station") or {},
        "disk_saved_at": time.time(),
    }
    text = json.dumps(body, separators=(",", ":"))
    for path in _disk_cache_paths():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            return
        except Exception as exc:
            log.debug("Spider disk cache write failed (%s): %s", path, exc)


def _ensure_memory_seeded_from_disk() -> None:
    """Load last-good Spider rows before catalog can paint a cold Vercel response."""
    global _CACHE, _CACHE_TS, _DISK_LOADED
    if _DISK_LOADED:
        return
    _DISK_LOADED = True
    if _payload_has_rows(_CACHE):
        return
    disk = _read_disk_cache()
    if disk:
        _CACHE = disk
        # Treat disk seed as immediately stale so a background refresh still runs.
        _CACHE_TS = time.monotonic() - DEFAULT_TTL_SEC - 1.0


def _store_cache(payload: dict[str, Any], *, keep_existing_on_empty: bool) -> None:
    global _CACHE, _CACHE_TS
    if _payload_has_rows(payload):
        _CACHE = payload
        _CACHE_TS = time.monotonic()
        _write_disk_cache(payload)
    elif keep_existing_on_empty and _payload_has_rows(_CACHE):
        log.warning(
            "Keeping stale Spider site status (%s)",
            payload.get("error") or "empty result",
        )
    else:
        _CACHE = payload
        _CACHE_TS = time.monotonic()


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
    On a cold start, seed from disk first; only then background-warm if still empty.
    """
    global _CACHE, _CACHE_TS

    if not spider_status_enabled():
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status is disabled",
        }

    _ensure_memory_seeded_from_disk()

    age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
    have_rows = _payload_has_rows(_CACHE)
    if not refresh and have_rows and age is not None and age <= ttl_sec:
        return _CACHE  # type: ignore[return-value]

    if not _FETCH_LOCK.acquire(blocking=False):
        return _CACHE or {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status fetch in progress",
        }

    if not refresh and have_rows:
        # Stale-while-revalidate: serve last good rows while refresh runs.
        def _background_refresh() -> None:
            try:
                payload = fetch_spider_site_statuses()
                _store_cache(payload, keep_existing_on_empty=True)
            except Exception as exc:
                log.warning("Spider background refresh failed: %s", exc)
            finally:
                _FETCH_LOCK.release()

        threading.Thread(
            target=_background_refresh,
            daemon=True,
            name="spider-status-refresh",
        ).start()
        return _CACHE  # type: ignore[return-value]

    def _blocking_fetch() -> None:
        try:
            payload = fetch_spider_site_statuses()
            _store_cache(payload, keep_existing_on_empty=have_rows)
        finally:
            _FETCH_LOCK.release()

    if refresh:
        try:
            _blocking_fetch()
        except Exception:
            log.exception("Spider site status refresh failed")
        return _CACHE or {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status unavailable",
        }

    # Cold cache — never block HTTP workers on Spider login here.
    # Callers that must avoid catalog fallback use ensure_spider_site_statuses().
    threading.Thread(
        target=_blocking_fetch,
        daemon=True,
        name="spider-status-warm",
    ).start()
    return _CACHE or {
        "fetched_at": None,
        "by_station": {},
        "error": "Spider site status warming",
    }


def ensure_spider_site_statuses(
    *,
    wait_sec: float = 12.0,
    max_age_sec: float = 15.0,
) -> dict[str, Any]:
    """Return Spider rows that are fresh enough to show as live status.

    Always blocks for a live Spider login when memory/disk rows are missing or
    older than ``max_age_sec``. Catalog must never be used as a substitute.
    """
    if not spider_status_enabled():
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "Spider site status is disabled",
        }

    _ensure_memory_seeded_from_disk()
    age = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
    if _payload_has_rows(_CACHE) and age is not None and age <= max_age_sec:
        return _CACHE  # type: ignore[return-value]

    # Prefer waiting on an in-flight fetch over starting a duplicate login.
    if not _FETCH_LOCK.acquire(blocking=False):
        deadline = time.monotonic() + max(0.0, wait_sec)
        while time.monotonic() < deadline:
            age_now = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
            if (
                _payload_has_rows(_CACHE)
                and age_now is not None
                and age_now <= max_age_sec
            ):
                return _CACHE  # type: ignore[return-value]
            time.sleep(0.2)
        if _payload_has_rows(_CACHE):
            return _CACHE  # type: ignore[return-value]
        acquired = _FETCH_LOCK.acquire(timeout=max(1.0, wait_sec))
        if not acquired:
            return _CACHE or {
                "fetched_at": None,
                "by_station": {},
                "error": "Spider site status fetch in progress",
            }
    else:
        acquired = True

    try:
        age_now = None if _CACHE is None else (time.monotonic() - _CACHE_TS)
        if (
            _payload_has_rows(_CACHE)
            and age_now is not None
            and age_now <= max_age_sec
        ):
            return _CACHE  # type: ignore[return-value]
        payload = fetch_spider_site_statuses()
        _store_cache(payload, keep_existing_on_empty=True)
        return _CACHE or {
            "fetched_at": None,
            "by_station": {},
            "error": payload.get("error") or "Spider site status unavailable",
        }
    finally:
        if acquired:
            _FETCH_LOCK.release()
