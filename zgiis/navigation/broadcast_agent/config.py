"""Broadcast agent configuration from environment variables."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

AudienceId = Literal["farmer", "surveyor", "citizen", "driver"]
ScriptKind = Literal["broadcast", "social"]

ALL_AUDIENCES: tuple[AudienceId, ...] = ("citizen", "farmer", "surveyor", "driver")


@dataclass
class ChannelTarget:
    """One delivery target for an audience brief."""

    channel: str  # console | file | webhook | whatsapp | facebook | twitter
    script: ScriptKind = "broadcast"
    options: dict[str, str] = field(default_factory=dict)


@dataclass
class BroadcastConfig:
    api_base: str
    api_key: str
    dry_run: bool
    interval_min: int
    state_path: str
    out_dir: str
    audiences: list[AudienceId]
    routes: dict[str, list[ChannelTarget]]
    refresh_ntrip: bool


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _parse_routes(raw: str | None) -> dict[str, list[ChannelTarget]]:
    """Parse BROADCAST_ROUTES JSON.

    Example:
    {
      "farmer": [
        {"channel": "whatsapp", "script": "broadcast", "options": {"to": "263771234567"}},
        {"channel": "webhook", "script": "broadcast", "options": {"url": "https://..."}}
      ],
      "citizen": [
        {"channel": "facebook", "script": "social"},
        {"channel": "console", "script": "broadcast"}
      ]
    }
    """
    if not raw or not raw.strip():
        return _default_routes()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"BROADCAST_ROUTES is invalid JSON: {exc}") from exc

    routes: dict[str, list[ChannelTarget]] = {}
    for audience, targets in data.items():
        if not isinstance(targets, list):
            continue
        parsed: list[ChannelTarget] = []
        for item in targets:
            if not isinstance(item, dict):
                continue
            channel = str(item.get("channel", "console"))
            script = item.get("script", "broadcast")
            if script not in ("broadcast", "social"):
                script = "broadcast"
            options = {str(k): str(v) for k, v in (item.get("options") or {}).items()}
            parsed.append(ChannelTarget(channel=channel, script=script, options=options))  # type: ignore[arg-type]
        if parsed:
            routes[str(audience)] = parsed
    return routes or _default_routes()


def _default_routes() -> dict[str, list[ChannelTarget]]:
    """Safe default: log to console only."""
    return {
        audience: [ChannelTarget(channel="console", script="broadcast")]
        for audience in ALL_AUDIENCES
    }


def load_config() -> BroadcastConfig:
    api_base = (os.getenv("NAVIGATION_NEWS_API_URL") or os.getenv("BROADCAST_API_URL") or "https://zingsa-gnss-tec.vercel.app").rstrip("/")
    api_key = (os.getenv("NAVIGATION_NEWS_API_KEY") or os.getenv("BROADCAST_API_KEY") or os.getenv("API_KEY") or "").strip()
    dry_run = _bool(os.getenv("BROADCAST_DRY_RUN"), default=True)
    interval = int(os.getenv("BROADCAST_INTERVAL_MIN", "240"))
    state_path = os.getenv("BROADCAST_STATE_PATH", "static/data/broadcast_state.json")
    out_dir = os.getenv("BROADCAST_OUT_DIR", "static/data/broadcast_out")
    refresh_ntrip = _bool(os.getenv("BROADCAST_REFRESH_NTRIP"), default=False)

    raw_audiences = (os.getenv("BROADCAST_AUDIENCES") or "citizen,farmer,surveyor,driver").strip()
    audiences: list[AudienceId] = []
    for part in raw_audiences.split(","):
        part = part.strip().lower()
        if part in ALL_AUDIENCES:
            audiences.append(part)  # type: ignore[arg-type]
    if not audiences:
        audiences = list(ALL_AUDIENCES)

    routes_raw = os.getenv("BROADCAST_ROUTES")
    routes_file = os.getenv("BROADCAST_ROUTES_FILE")
    if not routes_raw and routes_file and Path(routes_file).is_file():
        routes_raw = Path(routes_file).read_text(encoding="utf-8")
    routes = _parse_routes(routes_raw)

    return BroadcastConfig(
        api_base=api_base,
        api_key=api_key,
        dry_run=dry_run,
        interval_min=max(5, interval),
        state_path=state_path,
        out_dir=out_dir,
        audiences=audiences,
        routes=routes,
        refresh_ntrip=refresh_ntrip,
    )


def env_channel_defaults() -> dict[str, Any]:
    """Document which env vars each channel reads (for help text)."""
    return {
        "webhook": ["url in BROADCAST_ROUTES options, or WEBHOOK_URL"],
        "whatsapp": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "to in options"],
        "facebook": ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
        "twitter": ["TWITTER_BEARER_TOKEN"],
        "file": ["BROADCAST_OUT_DIR"],
        "console": [],
    }
