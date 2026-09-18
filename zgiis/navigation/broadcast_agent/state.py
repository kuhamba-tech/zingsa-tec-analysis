"""Deduplication state so unchanged briefs are not re-posted."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("zgiis.broadcast.state")


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


class BroadcastState:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._data: dict[str, Any] = {"entries": {}}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            self._data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("Could not read state %s: %s", self.path, exc)
            self._data = {"entries": {}}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    def _key(self, audience: str, channel: str, script_kind: str) -> str:
        return f"{audience}:{channel}:{script_kind}"

    def should_send(self, audience: str, channel: str, script_kind: str, text: str) -> bool:
        digest = _hash_text(text)
        key = self._key(audience, channel, script_kind)
        prev = (self._data.get("entries") or {}).get(key, {})
        if prev.get("hash") == digest:
            log.info("Skip %s — unchanged since %s", key, prev.get("sent_at", "?"))
            return False
        return True

    def mark_sent(self, audience: str, channel: str, script_kind: str, text: str) -> None:
        key = self._key(audience, channel, script_kind)
        entries = self._data.setdefault("entries", {})
        entries[key] = {
            "hash": _hash_text(text),
            "sent_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "preview": text[:120].replace("\n", " "),
        }
