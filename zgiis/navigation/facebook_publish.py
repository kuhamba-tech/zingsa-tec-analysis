"""Publish Navigation News to the Stellar Aspirations Facebook Page."""
from __future__ import annotations

import logging
import os
from typing import Any

from zgiis.navigation.broadcast_agent.channels import FacebookPageChannel

log = logging.getLogger(__name__)

# Stellar Aspirations page — https://www.facebook.com/profile.php?id=61562022072713
STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID = "61562022072713"
STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL = (
    "https://www.facebook.com/profile.php?id=61562022072713"
)


def _dry_run(default: bool = True) -> bool:
    raw = os.getenv("BROADCAST_DRY_RUN", "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def resolve_facebook_page_id(*, token: str | None = None) -> str:
    from zgiis.navigation.facebook_credentials_file import resolve_facebook_page_id_from_credentials

    resolved = resolve_facebook_page_id_from_credentials(token=token)
    if resolved:
        return resolved
    return STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID


def resolve_facebook_page_url() -> str:
    return (
        os.getenv("FACEBOOK_PAGE_URL") or STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL
    ).strip()


def facebook_configured() -> bool:
    from zgiis.navigation.facebook_credentials_file import resolve_facebook_page_access_token

    token = resolve_facebook_page_access_token()
    if not token:
        return False
    return bool(resolve_facebook_page_id(token=token))


def facebook_enabled() -> bool:
    raw = os.getenv("FACEBOOK_BROADCAST_ENABLED", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _brief_field(b: Any, key: str, default: str = "") -> str:
    if isinstance(b, dict):
        val = b.get(key, default)
    else:
        val = getattr(b, key, default)
    return str(val) if val is not None else default


def build_facebook_post(briefs: list[Any], *, computed_at: str, language: str = "en") -> str:
    """National Navigation & Space Weather post for the Stellar Aspirations Facebook Page."""
    by_id = {_brief_field(b, "id"): b for b in briefs if _brief_field(b, "id")}
    citizen = by_id.get("citizen")
    if citizen:
        if language and language != "en":
            from zgiis.navigation.brief_renderer import render_brief_for_recipient

            # "social" script_kind doesn't localize (short-form, English-only by design) —
            # "broadcast" runs the brief through labels_for(language) for real translated
            # chrome/tone text. Headline/summary/bullets still come from the underlying
            # brief, which is only generated in English today.
            brief_dict = citizen.model_dump() if hasattr(citizen, "model_dump") else dict(citizen)
            social = render_brief_for_recipient(brief_dict, language=language, script_kind="broadcast")
        else:
            social = _brief_field(citizen, "social_script")
        if social.strip():
            text = social.strip()
            return text if len(text) <= 5000 else text[:4950] + "\n…"

    # Fallback if citizen brief missing
    lines = [
        "🇿🇼 ZINGSA Navigation News — Zimbabwe GNSS & Space Weather",
        f"Updated {computed_at.replace('T', ' ').replace('Z', ' UTC')[:22]}",
    ]
    text = "\n".join(lines)
    return text if len(text) <= 5000 else text[:4950] + "\n…"


def publish_navigation_news_to_facebook(
    *,
    dry_run: bool | None = None,
    refresh_ntrip: bool = False,
    language: str = "en",
) -> dict[str, Any]:
    """Post the latest Navigation News digest to the configured Facebook Page."""
    from backend.routers.navigation_news import get_navigation_news_bundle

    if not facebook_enabled():
        return {
            "ok": False,
            "skipped": True,
            "reason": "Facebook broadcast disabled (FACEBOOK_BROADCAST_ENABLED=false)",
            "page_id": resolve_facebook_page_id(),
            "page_url": resolve_facebook_page_url(),
            "dry_run": dry_run if dry_run is not None else _dry_run(),
        }

    bundle = get_navigation_news_bundle(refresh_ntrip=refresh_ntrip, force=False)
    text = build_facebook_post(bundle.briefs, computed_at=bundle.computed_at, language=language)
    if not text.strip():
        return {
            "ok": False,
            "skipped": True,
            "reason": "empty post text",
            "page_id": resolve_facebook_page_id(),
            "page_url": resolve_facebook_page_url(),
        }

    use_dry = _dry_run() if dry_run is None else dry_run
    from zgiis.navigation.facebook_credentials_file import resolve_facebook_page_access_token

    token = resolve_facebook_page_access_token()
    page_id = resolve_facebook_page_id(token=token if not use_dry else None)
    channel = FacebookPageChannel()
    citizen = next((b for b in bundle.briefs if b.id == "citizen"), bundle.briefs[0] if bundle.briefs else None)

    result = channel.send(
        audience="citizen",
        script_kind="social",
        text=text,
        brief={
            "headline": citizen.headline if citizen else bundle.input_summary,
            "social_script": text,
            "_computed_at": bundle.computed_at,
        },
        dry_run=use_dry,
        options={"page_id": page_id},
    )

    return {
        "ok": result.ok,
        "skipped": False,
        "dry_run": result.dry_run,
        "page_id": page_id,
        "page_url": resolve_facebook_page_url(),
        "detail": result.detail,
        "message_preview": text[:280] + ("…" if len(text) > 280 else ""),
        "message_length": len(text),
        "computed_at": bundle.computed_at,
    }
