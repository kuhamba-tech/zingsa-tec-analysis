"""Capture the public Space Weather page and publish it for Slack.

Slack incoming webhooks can show an image only from a public https address.
The capture is best-effort: a failed screenshot does not block the advisory text.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone

import requests

log = logging.getLogger(__name__)

_PAGE = "https://zingsa-gnss-tec.vercel.app/space-weather/"
_BUCKET = "advisory-snapshots"


def deployment_label() -> str:
    """Identity of the running deployment. Each deploy gets its own image folder."""
    raw = os.getenv("VERCEL_DEPLOYMENT_ID") or os.getenv("VERCEL_GIT_COMMIT_SHA") or "local"
    safe = "".join(ch for ch in raw if ch.isalnum() or ch in "-_")[:40]
    return safe or "local"


def snapshot_object_path(issued_at: datetime | None = None, token: str | None = None) -> str:
    """A new storage path for every message. Never reuses an earlier screenshot."""
    issued = issued_at or datetime.now(timezone.utc)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=timezone.utc)
    stamp = issued.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    unique = token or secrets.token_hex(4)
    return f"space-weather/{deployment_label()}/{stamp}-{unique}.png"


def _capture_png(token: str) -> bytes | None:
    # thum.io keeps one image per address for hours. The deployment id and a
    # new token on every capture force a fresh dashboard for that send.
    page = f"{_PAGE}?deployment={deployment_label()}&shot={token}"
    shot = f"https://image.thum.io/get/png/noanimate/maxAge/0/wait/8/width/1440/{page}"
    try:
        response = requests.get(shot, timeout=55, headers={"User-Agent": "ZINGSA-space-weather"})
    except Exception:
        log.warning("Space Weather screenshot request failed")
        return None
    if response.status_code >= 400 or not response.content.startswith(b"\x89PNG"):
        log.warning("Space Weather screenshot was not a PNG (HTTP %s)", response.status_code)
        return None
    if len(response.content) < 20_000:
        log.warning("Space Weather screenshot was too small to be the dashboard")
        return None
    return response.content


def _public_url(base: str, object_path: str) -> str:
    return f"{base}/storage/v1/object/public/{_BUCKET}/{object_path}"


def publish_dashboard_snapshot(issued_at: datetime | None = None) -> str | None:
    """Publish one new screenshot for this deployment and this message."""
    token = secrets.token_hex(4)
    png = _capture_png(token)
    if png is None:
        return None
    base = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base.startswith("https://") or not key:
        return None
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    try:
        requests.post(
            f"{base}/storage/v1/bucket",
            headers={**headers, "Content-Type": "application/json"},
            json={"id": _BUCKET, "name": _BUCKET, "public": True},
            timeout=15,
        )
        object_path = snapshot_object_path(issued_at, token)
        uploaded = requests.post(
            f"{base}/storage/v1/object/{_BUCKET}/{object_path}",
            headers={
                **headers,
                "Content-Type": "image/png",
                "cache-control": "no-store",
                "x-upsert": "false",
            },
            data=png,
            timeout=30,
        )
    except Exception:
        log.warning("Space Weather screenshot upload failed")
        return None
    if uploaded.status_code >= 400:
        log.warning("Space Weather screenshot upload rejected with HTTP %s", uploaded.status_code)
        return None
    image_url = _public_url(base, object_path)
    try:
        check = requests.head(image_url, timeout=15)
    except Exception:
        return None
    if check.status_code >= 400:
        log.warning("Published screenshot was not publicly readable (HTTP %s)", check.status_code)
        return None
    return image_url
