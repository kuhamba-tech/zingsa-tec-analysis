"""Shared Facebook status helper for broadcast scheduler and API routes."""
from __future__ import annotations


def facebook_status_payload() -> dict:
    from zgiis.navigation.facebook_publish import (
        _dry_run,
        facebook_configured,
        facebook_enabled,
        resolve_facebook_page_id,
        resolve_facebook_page_url,
    )
    from zgiis.navigation.facebook_credentials_file import resolve_facebook_page_access_token

    token = resolve_facebook_page_access_token()
    page_id = resolve_facebook_page_id(token=token or None)

    return {
        "enabled": facebook_enabled(),
        "configured": facebook_configured(),
        "dry_run": _dry_run(),
        "page_id": page_id,
        "page_url": resolve_facebook_page_url(),
    }
