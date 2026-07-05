"""Publish Navigation News to the ZINGSA Facebook Page."""
from __future__ import annotations

import logging
import os
from typing import Any

from zgiis.navigation.audience_roles import AUDIENCE_ROLES, audience_role_meta
from zgiis.navigation.broadcast_agent.channels import FacebookPageChannel

log = logging.getLogger(__name__)

# Official ZINGSA page — https://www.facebook.com/profile.php?id=61562022072713
ZINGSA_FACEBOOK_PAGE_ID = "61562022072713"
ZINGSA_FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61562022072713"


def _dry_run(default: bool = True) -> bool:
    raw = os.getenv("BROADCAST_DRY_RUN", "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def resolve_facebook_page_id() -> str:
    return (os.getenv("FACEBOOK_PAGE_ID") or ZINGSA_FACEBOOK_PAGE_ID).strip()


def facebook_configured() -> bool:
    token = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "").strip()
    return bool(token and resolve_facebook_page_id())


def facebook_enabled() -> bool:
    raw = os.getenv("FACEBOOK_BROADCAST_ENABLED", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _brief_field(b: Any, key: str, default: str = "") -> str:
    if isinstance(b, dict):
        val = b.get(key, default)
    else:
        val = getattr(b, key, default)
    return str(val) if val is not None else default


def build_facebook_post(briefs: list[Any], *, computed_at: str) -> str:
    """Digest post for the ZINGSA Facebook Page — all audience headlines + citizen social copy."""
    by_id = {_brief_field(b, "id"): b for b in briefs if _brief_field(b, "id")}
    lines = [
        "🇿🇼 ZINGSA Navigation News — Zimbabwe GNSS & Space Weather",
        f"Updated {computed_at.replace('T', ' ').replace('Z', ' UTC')[:22]}",
        "",
        "Tailored briefs for every navigation community:",
    ]

    for role in AUDIENCE_ROLES:
        brief = by_id.get(role["id"])
        if not brief:
            continue
        headline = _brief_field(brief, "headline")
        lines.append(f"{role['icon']} {role['role']}: {headline}")

    citizen = by_id.get("citizen")
    if citizen:
        social = _brief_field(citizen, "social_script")
        if social:
            lines.extend(["", "———", social.strip()])

    lines.extend(["", "#SpaceWeather #Zimbabwe #ZINGSA #NavigationNews #GNSS"])
    text = "\n".join(lines)
    return text if len(text) <= 5000 else text[:4950] + "\n…"


def publish_navigation_news_to_facebook(
    *,
    dry_run: bool | None = None,
    refresh_ntrip: bool = False,
) -> dict[str, Any]:
    """Post the latest Navigation News digest to the configured Facebook Page."""
    from backend.routers.navigation_news import get_navigation_news_bundle

    if not facebook_enabled():
        return {
            "ok": False,
            "skipped": True,
            "reason": "Facebook broadcast disabled (FACEBOOK_BROADCAST_ENABLED=false)",
            "page_id": resolve_facebook_page_id(),
            "page_url": ZINGSA_FACEBOOK_PAGE_URL,
            "dry_run": dry_run if dry_run is not None else _dry_run(),
        }

    bundle = get_navigation_news_bundle(refresh_ntrip=refresh_ntrip, force=False)
    text = build_facebook_post(bundle.briefs, computed_at=bundle.computed_at)
    if not text.strip():
        return {
            "ok": False,
            "skipped": True,
            "reason": "empty post text",
            "page_id": resolve_facebook_page_id(),
            "page_url": ZINGSA_FACEBOOK_PAGE_URL,
        }

    use_dry = _dry_run() if dry_run is None else dry_run
    page_id = resolve_facebook_page_id()
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
        "page_url": ZINGSA_FACEBOOK_PAGE_URL,
        "detail": result.detail,
        "message_preview": text[:280] + ("…" if len(text) > 280 else ""),
        "message_length": len(text),
        "computed_at": bundle.computed_at,
    }
