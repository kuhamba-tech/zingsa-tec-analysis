"""Keep the single NTRIP slot on stations that can produce live VTEC."""

from __future__ import annotations

import threading

from zgiis.cors.stations import is_surveyor_general


class ConnectedStationGate:
    """Surveyor General sites never take the slot.

    When Spider has reported online ZINGSA stations, offline mounts wait too.
    An empty or missing Spider list does not block ZINGSA stations — the
    collector still rotates through them.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._online: set[str] | None = None

    def replace(self, online_codes: set[str] | None) -> None:
        cleaned = {
            str(code).lower().rstrip("_")
            for code in (online_codes or set())
            if code and not is_surveyor_general(code)
        }
        with self._lock:
            self._online = cleaned or None

    def waiting(self, code: str) -> bool:
        if is_surveyor_general(code):
            return True
        key = str(code or "").lower().rstrip("_")
        with self._lock:
            if not self._online:
                return False
            return key not in self._online

    def update_from_spider(self, payload: dict | None) -> None:
        by_station = (payload or {}).get("by_station") or {}
        online = {
            str(code).lower().rstrip("_")
            for code, row in by_station.items()
            if str((row or {}).get("status") or "").lower() == "online"
        }
        self.replace(online)
