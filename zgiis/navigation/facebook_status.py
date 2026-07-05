"""Shared Facebook status helper for broadcast scheduler and API routes."""
from __future__ import annotations


def facebook_status_payload() -> dict:
    from zgiis.navigation.facebook_publish import (
        ZINGSA_FACEBOOK_PAGE_URL,
        _dry_run,
        facebook_configured,
        facebook_enabled,
        resolve_facebook_page_id,
    )

    return {
        "enabled": facebook_enabled(),
        "configured": facebook_configured(),
        "dry_run": _dry_run(),
        "page_id": resolve_facebook_page_id(),
        "page_url": ZINGSA_FACEBOOK_PAGE_URL,
    }
