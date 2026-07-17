from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

app = FastAPI()


def _check_api_key(request: Request) -> None:
    expected = (os.getenv("STATUS_SNAPSHOT_PUSH_API_KEY") or os.getenv("API_KEY") or "").strip()
    if not expected:
        return  # open access when no key is configured (matches backend/deps.py's dev-mode pattern)
    provided = (request.headers.get("x-api-key") or "").strip()
    if provided != expected:
        raise HTTPException(status_code=403, detail="Invalid API key")


@app.post("/api/cors/status/snapshots")
@app.post("/api/cors/status/snapshots/")
async def push_snapshots(request: Request):
    """Receives station-status snapshots pushed by the standalone always-on
    collector (scripts/live_ntrip_collector.py), which cannot hold live
    NTRIP sockets inside Vercel's serverless functions itself."""
    _check_api_key(request)
    body: dict[str, Any] = await request.json()
    rows = body.get("snapshots")
    if not isinstance(rows, list):
        raise HTTPException(status_code=422, detail='Expected {"snapshots": [...]}')

    from zgiis.db.station_status_db import StationStatusDB

    db = StationStatusDB()
    try:
        inserted = db.insert_snapshots(rows)
    finally:
        db.close()
    return {"inserted": inserted}
