#!/usr/bin/env python3
"""Replay-safe CR1000 file gateway: once for cron, or --watch for continuous polling.
The logger/LoggerNet must first export its real TOA5/CSV table to GIC_DATA_FILE.
No direct PakBus commissioning or sensor calibration is implied by this program.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlencode
import requests
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from zgiis.gic.ingest import parse_gic_file

log = logging.getLogger("gic_gateway")


def _save_state(path: Path, state: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+".tmp")
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.replace(path)


def ingestion_url(base_url: str, explicit_url: str | None = None) -> str:
    if explicit_url:
        return explicit_url
    parts = urlsplit(base_url)
    if (parts.hostname or "").endswith(".vercel.app"):
        return f"{parts.scheme}://{parts.netloc}/api/core-router?" + urlencode({"__zr": "/gic/ingest"})
    return base_url.rstrip("/") + "/gic/ingest"


def upload_file(*, path: Path, station_id: str, base_url: str, api_key: str,
                state_file: Path, batch_size: int = 120, logger_timezone=None,
                calibration_id=None, units=None, post=requests.post, endpoint_url=None) -> dict:
    if not 1 <= batch_size <= 10000: raise ValueError("Batch size must be 1..10000")
    content = path.read_bytes()
    identity = hashlib.sha256(json.dumps([str(path.resolve()), station_id, logger_timezone, calibration_id, units, ingestion_url(base_url, endpoint_url)]).encode()+content).hexdigest()
    try: state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError): state = {}
    if state.get("completed_fingerprint") == identity:
        return {"received": 0, "inserted": 0, "unchanged": True}
    rows = parse_gic_file(content, path.name, station_id, logger_timezone=logger_timezone, calibration_id=calibration_id, units=units)
    received = inserted = 0
    # Always oldest first. Resend changed/rotated exports in full: the server's
    # (station,time) unique constraint handles retry, late records and overlaps.
    for offset in range(0, len(rows), batch_size):
        batch = rows[offset:offset+batch_size]
        payload = {"station_id": station_id.upper(), "readings": [{k:v for k,v in row.items() if k not in {"station_id", "source"}} for row in batch]}
        headers = {"X-API-Key": api_key} if api_key else {}
        response = post(ingestion_url(base_url, endpoint_url), json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        receipt = response.json()
        if receipt.get("received") != len(batch) or receipt.get("station_id") != station_id.upper():
            raise ValueError("Server did not acknowledge the complete station batch; checkpoint unchanged")
        received += len(batch)
        inserted += int(receipt["inserted"])
    _save_state(state_file, {"station_id": station_id.upper(), "completed_fingerprint": identity,
                             "last_time": rows[-1]["time"], "records_acknowledged": received})
    return {"received": received, "inserted": inserted, "unchanged": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not os.getenv("GIC_DATA_FILE") or not os.getenv("GIC_STATION_ID"):
        log.error("GIC_DATA_FILE and GIC_STATION_ID must explicitly identify the logger export")
        return 2
    failures = 0
    while True:
        try:
            result = upload_file(path=Path(os.environ["GIC_DATA_FILE"]), station_id=os.environ["GIC_STATION_ID"],
                base_url=os.getenv("GIC_GATEWAY_URL", "http://127.0.0.1:8000"), api_key=os.getenv("API_KEY", ""),
                state_file=Path(os.getenv("GIC_STATE_FILE", ".gic_gateway_state")), batch_size=int(os.getenv("GIC_BATCH_SIZE", "120")),
                logger_timezone=os.getenv("GIC_LOGGER_TIMEZONE"), calibration_id=os.getenv("GIC_CALIBRATION_ID"), units=os.getenv("GIC_UNITS"), endpoint_url=os.getenv("GIC_INGEST_URL"))
            log.info("Station %s: %s", os.environ["GIC_STATION_ID"], result)
            failures = 0
            if not args.watch: return 0
        except (requests.RequestException, ValueError, OSError) as exc:
            # Do not log credentials, headers, response bodies or network URLs.
            log.error("Station upload failed (%s); checkpoint retained", type(exc).__name__)
            failures += 1
            if not args.watch: return 1
        time.sleep(min(300, max(5, int(os.getenv("GIC_POLL_SECONDS", "30"))) * 2**min(failures, 4)))


if __name__ == "__main__": raise SystemExit(main())
