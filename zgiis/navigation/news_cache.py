"""Navigation News — 4-hour refresh schedule with persisted update timestamps."""
from __future__ import annotations

import json
import logging
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("zgiis.navigation.news_cache")

UPDATE_INTERVAL_HOURS = 4
MAX_HISTORY = 48


@dataclass
class NavigationNewsCacheRecord:
    last_updated_at: str
    next_update_at: str
    update_interval_hours: int
    computed_at: str
    input_summary: str
    sources: dict[str, Any]
    briefs: list[dict[str, Any]]
    update_history: list[str] = field(default_factory=list)


def _cache_path() -> Path:
    static = Path(__file__).resolve().parents[2] / "static" / "data" / "navigation_news_cache.json"
    try:
        static.parent.mkdir(parents=True, exist_ok=True)
        return static
    except OSError:
        base = Path(tempfile.gettempdir()) / "zgiis_nav_news"
        base.mkdir(parents=True, exist_ok=True)
        return base / "navigation_news_cache.json"


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def format_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def next_update_from(last: datetime) -> datetime:
    return last + timedelta(hours=UPDATE_INTERVAL_HOURS)


def cache_is_fresh(record: NavigationNewsCacheRecord, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    try:
        return now < parse_iso(record.next_update_at)
    except Exception:
        return False


def load_cache() -> NavigationNewsCacheRecord | None:
    path = _cache_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return NavigationNewsCacheRecord(**data)
    except Exception as exc:
        log.warning("Could not load navigation news cache from %s: %s", path, exc)
        return None


def save_cache(record: NavigationNewsCacheRecord) -> None:
    path = _cache_path()
    path.write_text(json.dumps(asdict(record), indent=2), encoding="utf-8")


def record_refresh(bundle: dict[str, Any], now: datetime | None = None) -> NavigationNewsCacheRecord:
    now = now or datetime.now(timezone.utc)
    now_s = format_iso(now)
    next_s = format_iso(next_update_from(now))

    prev = load_cache()
    history = list(prev.update_history) if prev else []
    if not history or history[-1] != now_s:
        history.append(now_s)
    history = history[-MAX_HISTORY:]

    record = NavigationNewsCacheRecord(
        last_updated_at=now_s,
        next_update_at=next_s,
        update_interval_hours=UPDATE_INTERVAL_HOURS,
        computed_at=str(bundle.get("computed_at") or now_s),
        input_summary=str(bundle.get("input_summary") or ""),
        sources=dict(bundle.get("sources") or {}),
        briefs=list(bundle.get("briefs") or []),
        update_history=history,
    )
    save_cache(record)
    log.info("Navigation news refreshed at %s — next update %s", now_s, next_s)
    return record


def record_to_bundle_dict(record: NavigationNewsCacheRecord) -> dict[str, Any]:
    return {
        "computed_at": record.computed_at,
        "last_updated_at": record.last_updated_at,
        "next_update_at": record.next_update_at,
        "update_interval_hours": record.update_interval_hours,
        "update_history": record.update_history,
        "input_summary": record.input_summary,
        "sources": record.sources,
        "briefs": record.briefs,
    }
