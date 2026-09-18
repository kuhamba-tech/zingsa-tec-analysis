"""Load Facebook Page credentials from a private server-side JSON file."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_DEFAULT_FILE = Path(__file__).resolve().parents[2] / "static" / "data" / "facebook_credentials.private.json"

# Cached Graph API page id from the active token (profile.php ids often differ).
_resolved_page_id_cache: str | None = None
_page_feed_cache: tuple[str, str] | None = None  # (page_id, page_access_token)


def _fetch_managed_pages(token: str) -> list[dict[str, Any]]:
    import requests

    if not token:
        return []
    try:
        res = requests.get(
            "https://graph.facebook.com/v19.0/me/accounts",
            params={"fields": "id,name,access_token", "access_token": token},
            timeout=15,
        )
        if res.status_code >= 400:
            log.warning("Facebook /me/accounts lookup failed: %s", res.text[:240])
            return []
        payload = res.json()
        data = payload.get("data")
        return data if isinstance(data, list) else []
    except Exception as exc:
        log.warning("Facebook managed pages lookup failed: %s", exc)
        return []


def resolve_page_feed_access_token(
    *,
    token: str | None = None,
    page_id: str | None = None,
) -> tuple[str, str]:
    """Return (page_id, page_access_token) for /{page-id}/feed posts.

    Accepts either a Page access token or a User token with pages_show_list —
    in the latter case, resolves the Page token via GET /me/accounts.
    """
    global _page_feed_cache, _resolved_page_id_cache

    user_token = (token or resolve_facebook_page_access_token()).strip()
    preferred_id = (page_id or os.getenv("FACEBOOK_PAGE_ID") or "").strip()

    if _page_feed_cache:
        cached_id, cached_token = _page_feed_cache
        if not preferred_id or cached_id == preferred_id:
            return cached_id, cached_token

    pages = _fetch_managed_pages(user_token)
    if pages:
        chosen: dict[str, Any] | None = None
        if preferred_id:
            chosen = next((p for p in pages if str(p.get("id") or "") == preferred_id), None)
        if not chosen:
            chosen = next(
                (p for p in pages if "stellar aspirations" in str(p.get("name") or "").lower()),
                None,
            )
        if not chosen and len(pages) == 1:
            chosen = pages[0]
        if chosen:
            pid = str(chosen.get("id") or "").strip()
            page_token = str(chosen.get("access_token") or "").strip()
            if pid and page_token:
                log.info("Facebook page feed token resolved for %s (%s)", pid, chosen.get("name"))
                _page_feed_cache = (pid, page_token)
                _resolved_page_id_cache = pid
                return pid, page_token

    api_id = lookup_graph_page_id_from_token(user_token)
    pid = api_id or preferred_id
    if pid and user_token:
        _page_feed_cache = (pid, user_token)
        if api_id:
            _resolved_page_id_cache = api_id
        return pid, user_token
    return preferred_id, user_token


def credentials_file_path() -> Path:
    raw = os.getenv("FACEBOOK_CREDENTIALS_FILE", "").strip()
    return Path(raw) if raw else _DEFAULT_FILE


def load_facebook_credentials(path: Path | None = None) -> dict[str, Any]:
    """Return credentials from the private JSON file (empty dict if missing)."""
    file_path = path or credentials_file_path()
    if not file_path.is_file():
        return {}
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read Facebook credentials file %s: %s", file_path, exc)
        return {}
    return payload if isinstance(payload, dict) else {}


def resolve_facebook_page_access_token() -> str:
    """Env var first, then private JSON file — never exposed on the public web UI."""
    token = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "").strip()
    if token:
        return token
    creds = load_facebook_credentials()
    return str(creds.get("page_access_token") or creds.get("access_token") or "").strip()


def lookup_graph_page_id_from_token(token: str) -> str | None:
    """Return the Page Graph ID for a Page access token (GET /me)."""
    import requests

    if not token:
        return None
    try:
        res = requests.get(
            "https://graph.facebook.com/v19.0/me",
            params={"fields": "id,name", "access_token": token},
            timeout=15,
        )
        if res.status_code >= 400:
            log.warning("Facebook /me page lookup failed: %s", res.text[:240])
            return None
        payload = res.json()
        page_id = str(payload.get("id") or "").strip()
        if page_id:
            name = payload.get("name")
            if name:
                log.info("Facebook page token maps to %s (%s)", page_id, name)
            return page_id
    except Exception as exc:
        log.warning("Facebook page ID lookup failed: %s", exc)
    return None


def resolve_facebook_page_id_from_credentials(*, token: str | None = None) -> str:
    """Resolve the Graph API page id: token /me → env → credentials file → empty.

    The token-derived id wins over a configured FACEBOOK_PAGE_ID/page_id because
    it's the only one guaranteed to match what the token can actually post as.
    Facebook Pages under the "New Pages Experience" have a public "global id"
    (the number in facebook.com/profile.php?id=...) that is *not* accepted by
    the Graph API's /{page-id}/feed — posting with it fails with
    "(#100) The global id ... is not allowed for this call". A stale or
    hand-copied FACEBOOK_PAGE_ID commonly holds that wrong id, so it must not
    override a fresh, working token lookup.
    """
    global _resolved_page_id_cache

    active_token = (token or resolve_facebook_page_access_token()).strip()
    if active_token:
        if _resolved_page_id_cache:
            return _resolved_page_id_cache
        page_id, _ = resolve_page_feed_access_token(token=active_token)
        if page_id:
            return page_id
        api_id = lookup_graph_page_id_from_token(active_token)
        if api_id:
            _resolved_page_id_cache = api_id
            return api_id

    env_id = os.getenv("FACEBOOK_PAGE_ID", "").strip()
    if env_id:
        return env_id

    creds = load_facebook_credentials()
    file_id = str(creds.get("page_id") or "").strip()
    return file_id


def clear_facebook_page_id_cache() -> None:
    global _resolved_page_id_cache, _page_feed_cache
    _resolved_page_id_cache = None
    _page_feed_cache = None


def credentials_source() -> str:
    """Where the active token would be loaded from (for ops logging only)."""
    if os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "").strip():
        return "environment"
    file_path = credentials_file_path()
    if file_path.is_file() and resolve_facebook_page_access_token():
        return f"file:{file_path.name}"
    return "none"
