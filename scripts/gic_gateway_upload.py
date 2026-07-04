#!/usr/bin/env python3
"""Raspberry Pi gateway uploader for live GIC field readings.

Reads the latest rows from a Campbell CR1000 TOA5 export or CSV file and
POSTs them to the ZGIIS backend at POST /gic/ingest.

Environment variables:
  GIC_GATEWAY_URL   Base URL (default http://127.0.0.1:8000)
  API_KEY           X-API-Key header value (required in production)
  GIC_STATION_ID    Station identifier (default MARIMBA_001)
  GIC_DATA_FILE     Path to TOA5/CSV file to tail (required)
  GIC_BATCH_SIZE    Max readings per upload (default 120)
  GIC_STATE_FILE    Tracks last uploaded timestamp (default .gic_gateway_state)

Example cron (every minute):
  * * * * * /path/to/.venv/bin/python /path/to/scripts/gic_gateway_upload.py >> /var/log/gic_gateway.log 2>&1
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from zgiis.gic.ingest import parse_gic_file  # noqa: E402


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _load_state(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("last_time")
    except (json.JSONDecodeError, OSError):
        return None


def _save_state(path: Path, last_time: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"last_time": last_time}), encoding="utf-8")


def main() -> int:
    base_url = _env("GIC_GATEWAY_URL", "http://127.0.0.1:8000").rstrip("/")
    api_key = _env("API_KEY")
    station_id = _env("GIC_STATION_ID", "MARIMBA_001").upper()
    data_file = _env("GIC_DATA_FILE")
    batch_size = max(1, int(_env("GIC_BATCH_SIZE", "120") or "120"))
    state_file = Path(_env("GIC_STATE_FILE", str(Path.cwd() / ".gic_gateway_state")))

    if not data_file:
        print("GIC_DATA_FILE is required.", file=sys.stderr)
        return 2
    path = Path(data_file)
    if not path.is_file():
        print(f"Data file not found: {path}", file=sys.stderr)
        return 2

    content = path.read_bytes()
    rows = parse_gic_file(content, path.name, station_id)
    last_uploaded = _load_state(state_file)
    if last_uploaded:
        rows = [r for r in rows if r["time"] > last_uploaded]
    if not rows:
        print(f"{datetime.now(timezone.utc).isoformat()} — no new rows for {station_id}")
        return 0

    batch = rows[-batch_size:]
    payload = {
        "station_id": station_id,
        "readings": [
            {"time": r["time"], "gic_a": r["gic_a"], "temp_c": r.get("temp_c")}
            for r in batch
        ],
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key

    url = f"{base_url}/gic/ingest"
    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    if resp.status_code not in (200, 201):
        print(f"Upload failed ({resp.status_code}): {resp.text}", file=sys.stderr)
        return 1

    newest = batch[-1]["time"]
    _save_state(state_file, newest)
    print(
        f"{datetime.now(timezone.utc).isoformat()} — uploaded {len(batch)} readings "
        f"for {station_id} (latest {newest})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
