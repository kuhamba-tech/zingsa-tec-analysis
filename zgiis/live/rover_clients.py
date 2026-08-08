"""Live rover (NTRIP client) counts per CORS mountpoint.

Standard NTRIP sourcetables do NOT include connected-client counts. Those come
from Leica Spider Business Center (or an equivalent caster admin export).

This module only surfaces real snapshots:
  - ROVER_CLIENTS_JSON_PATH  — local JSON written by ops / ingest script
  - ROVER_CLIENTS_URL        — HTTP(S) JSON endpoint returning the same schema
  - ROVER_CLIENTS_CSV_PATH   — Spider-style CSV export (mountpoint,clients,...)

Never invents or fabricates rover counts. If no feed is configured or the file
is empty/stale beyond TTL, callers get available=False.
"""
from __future__ import annotations

import csv
import json
import logging
import os
import threading
import time
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {"payload": None, "ts": 0.0}


@dataclass
class RoverClientStation:
    code: str
    mountpoint: str
    name: str = ""
    connected_rovers: int = 0
    peak_24h: int | None = None
    share_pct: float | None = None
    rank: int | None = None


@dataclass
class RoverClientsSnapshot:
    available: bool
    updated_at: str | None = None
    source: str | None = None
    message: str | None = None
    total_rovers: int = 0
    stations_with_rovers: int = 0
    busiest_code: str | None = None
    busiest_count: int = 0
    stations: list[RoverClientStation] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "updated_at": self.updated_at,
            "source": self.source,
            "message": self.message,
            "total_rovers": self.total_rovers,
            "stations_with_rovers": self.stations_with_rovers,
            "busiest_code": self.busiest_code,
            "busiest_count": self.busiest_count,
            "stations": [asdict(s) for s in self.stations],
        }


def _ttl_sec() -> float:
    raw = os.getenv("ROVER_CLIENTS_TTL_SEC", "60").strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 60.0


def _default_json_path() -> Path:
    override = os.getenv("ROVER_CLIENTS_JSON_PATH", "").strip()
    if override:
        return Path(override)
    # Repo-relative default next to other live caches
    root = Path(__file__).resolve().parents[2]
    return root / "static" / "data" / "rover_clients.json"


def _normalize_code(value: str) -> str:
    return (value or "").strip().lower().rstrip("_")


def _normalize_mount(value: str) -> str:
    return (value or "").strip().upper()


def _parse_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        n = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
    return max(0, n)


def _station_name_lookup() -> dict[str, str]:
    try:
        from zgiis.cors.stations import get_stations

        return {_normalize_code(s.code): s.name for s in get_stations()}
    except Exception:
        return {}


def _mountpoint_lookup() -> dict[str, str]:
    """code -> mountpoint and mountpoint -> code."""
    try:
        from zgiis.live.mountpoints import parse_mountpoints

        return {_normalize_code(k): _normalize_mount(v) for k, v in parse_mountpoints().items()}
    except Exception:
        return {}


def _resolve_station_identity(
    *,
    code: str | None,
    mountpoint: str | None,
    code_to_mp: dict[str, str],
    names: dict[str, str],
) -> tuple[str, str, str] | None:
    mp_to_code = {v: k for k, v in code_to_mp.items()}
    c = _normalize_code(code or "")
    m = _normalize_mount(mountpoint or "")
    if not c and m:
        c = mp_to_code.get(m, "")
    if not m and c:
        m = code_to_mp.get(c, c.upper())
    if not c and not m:
        return None
    if not c:
        c = m.lower().rstrip("_")
    if not m:
        m = c.upper()
    return c, m, names.get(c, c.upper())


def _rank_and_share(rows: list[RoverClientStation]) -> list[RoverClientStation]:
    total = sum(max(0, r.connected_rovers) for r in rows)
    ordered = sorted(rows, key=lambda r: (-r.connected_rovers, r.code))
    out: list[RoverClientStation] = []
    for i, row in enumerate(ordered, start=1):
        share = round(100.0 * row.connected_rovers / total, 1) if total > 0 else 0.0
        out.append(
            RoverClientStation(
                code=row.code,
                mountpoint=row.mountpoint,
                name=row.name,
                connected_rovers=row.connected_rovers,
                peak_24h=row.peak_24h,
                share_pct=share,
                rank=i,
            )
        )
    return out


def _empty(message: str, *, source: str | None = None) -> RoverClientsSnapshot:
    return RoverClientsSnapshot(
        available=False,
        updated_at=None,
        source=source,
        message=message,
    )


def parse_rover_clients_payload(data: dict[str, Any], *, source: str) -> RoverClientsSnapshot:
    """Normalize a JSON object into a ranked rover-clients snapshot."""
    if not isinstance(data, dict):
        return _empty("Rover clients payload must be a JSON object", source=source)

    names = _station_name_lookup()
    code_to_mp = _mountpoint_lookup()
    raw_stations = data.get("stations") or data.get("mountpoints") or data.get("clients") or []
    if not isinstance(raw_stations, list):
        return _empty("Rover clients payload missing stations list", source=source)

    by_code: dict[str, RoverClientStation] = {}
    for item in raw_stations:
        if not isinstance(item, dict):
            continue
        identity = _resolve_station_identity(
            code=str(item.get("code") or item.get("station") or item.get("station_code") or ""),
            mountpoint=str(item.get("mountpoint") or item.get("mount") or item.get("mp") or ""),
            code_to_mp=code_to_mp,
            names=names,
        )
        if identity is None:
            continue
        code, mountpoint, name = identity
        count = _parse_int(
            item.get("connected_rovers")
            if item.get("connected_rovers") is not None
            else item.get("clients")
            if item.get("clients") is not None
            else item.get("rovers")
            if item.get("rovers") is not None
            else item.get("connections")
            if item.get("connections") is not None
            else item.get("n_clients")
        )
        if count is None:
            continue
        peak = _parse_int(item.get("peak_24h") if item.get("peak_24h") is not None else item.get("peak"))
        display_name = str(item.get("name") or name)
        prev = by_code.get(code)
        if prev is None or count >= prev.connected_rovers:
            by_code[code] = RoverClientStation(
                code=code,
                mountpoint=mountpoint,
                name=display_name,
                connected_rovers=count,
                peak_24h=peak if peak is not None else (prev.peak_24h if prev else None),
            )

    ranked = _rank_and_share(list(by_code.values()))
    total = sum(r.connected_rovers for r in ranked)
    with_rovers = sum(1 for r in ranked if r.connected_rovers > 0)
    busiest = ranked[0] if ranked and ranked[0].connected_rovers > 0 else None
    updated_at = data.get("updated_at") or data.get("as_of") or data.get("timestamp")
    if updated_at is not None:
        updated_at = str(updated_at)

    if not ranked:
        return RoverClientsSnapshot(
            available=False,
            updated_at=updated_at,
            source=str(data.get("source") or source),
            message="Rover clients feed has no station rows yet",
        )

    return RoverClientsSnapshot(
        available=True,
        updated_at=updated_at,
        source=str(data.get("source") or source),
        message=None,
        total_rovers=total,
        stations_with_rovers=with_rovers,
        busiest_code=busiest.code if busiest else None,
        busiest_count=busiest.connected_rovers if busiest else 0,
        stations=ranked,
    )


def parse_rover_clients_csv(text: str, *, source: str) -> RoverClientsSnapshot:
    """Parse a simple CSV with headers including mountpoint/code and clients/rovers."""
    reader = csv.DictReader(line for line in text.splitlines() if line.strip())
    if not reader.fieldnames:
        return _empty("Rover clients CSV has no header row", source=source)

    rows: list[dict[str, Any]] = []
    for row in reader:
        lower = {str(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        rows.append(
            {
                "code": lower.get("code") or lower.get("station") or lower.get("station_code") or "",
                "mountpoint": lower.get("mountpoint") or lower.get("mount") or lower.get("mp") or "",
                "name": lower.get("name") or lower.get("station_name") or "",
                "connected_rovers": lower.get("connected_rovers")
                or lower.get("clients")
                or lower.get("rovers")
                or lower.get("connections")
                or lower.get("n_clients")
                or "",
                "peak_24h": lower.get("peak_24h") or lower.get("peak") or "",
            }
        )
    return parse_rover_clients_payload(
        {
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": source,
            "stations": rows,
        },
        source=source,
    )


def _load_from_json_file(path: Path) -> RoverClientsSnapshot | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to read rover clients JSON %s: %s", path, exc)
        return _empty(f"Failed to read {path.name}: {exc}", source=str(path))
    return parse_rover_clients_payload(data, source=str(path))


def _load_from_csv_file(path: Path) -> RoverClientsSnapshot | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        return _empty(f"Failed to read {path.name}: {exc}", source=str(path))
    return parse_rover_clients_csv(text, source=str(path))


def _load_from_url(url: str) -> RoverClientsSnapshot:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ZGIIS-RoverClients/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            ctype = (resp.headers.get("Content-Type") or "").lower()
        if "csv" in ctype or url.lower().endswith(".csv"):
            return parse_rover_clients_csv(body, source=url)
        data = json.loads(body)
        return parse_rover_clients_payload(data, source=url)
    except Exception as exc:
        log.warning("Rover clients URL fetch failed: %s", exc)
        return _empty(f"Failed to fetch rover clients URL: {exc}", source=url)


def load_rover_clients(*, force_refresh: bool = False) -> RoverClientsSnapshot:
    """Return the latest rover-client snapshot (cached)."""
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE.get("payload")
        if (
            not force_refresh
            and isinstance(cached, RoverClientsSnapshot)
            and (now - float(_CACHE["ts"])) < _ttl_sec()
        ):
            return cached

    url = os.getenv("ROVER_CLIENTS_URL", "").strip()
    csv_path = os.getenv("ROVER_CLIENTS_CSV_PATH", "").strip()
    json_path = _default_json_path()

    snapshot: RoverClientsSnapshot | None = None
    if url:
        snapshot = _load_from_url(url)
    if (snapshot is None or not snapshot.available) and csv_path:
        snapshot = _load_from_csv_file(Path(csv_path))
    if snapshot is None or not snapshot.available:
        file_snap = _load_from_json_file(json_path)
        if file_snap is not None:
            snapshot = file_snap

    if snapshot is None:
        snapshot = _empty(
            "No rover client feed configured. Export connected NTRIP clients from "
            "Leica Spider Business Center (or caster admin) into "
            f"{json_path.name}, or set ROVER_CLIENTS_URL / ROVER_CLIENTS_CSV_PATH.",
            source=None,
        )

    with _LOCK:
        _CACHE["payload"] = snapshot
        _CACHE["ts"] = time.monotonic()
    return snapshot


def rover_counts_by_code(*, force_refresh: bool = False) -> dict[str, int]:
    snap = load_rover_clients(force_refresh=force_refresh)
    if not snap.available:
        return {}
    return {s.code: s.connected_rovers for s in snap.stations}


def write_rover_clients_snapshot(payload: dict[str, Any], path: Path | None = None) -> Path:
    """Persist a validated snapshot for the API to serve (collector / ingest use)."""
    target = path or _default_json_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    snap = parse_rover_clients_payload(payload, source=str(target))
    out = {
        "updated_at": payload.get("updated_at")
        or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": payload.get("source") or "ingest",
        "stations": [
            {
                "code": s.code,
                "mountpoint": s.mountpoint,
                "name": s.name,
                "connected_rovers": s.connected_rovers,
                "peak_24h": s.peak_24h,
            }
            for s in snap.stations
        ],
    }
    target.write_text(json.dumps(out, indent=2), encoding="utf-8")
    with _LOCK:
        _CACHE["payload"] = None
        _CACHE["ts"] = 0.0
    return target
