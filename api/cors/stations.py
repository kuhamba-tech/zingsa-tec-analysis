from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import cors_network  # noqa: E402
from zgiis.cors.site_details import enrich_station  # noqa: E402
from zgiis.cors.stations import stations_for_map  # noqa: E402

app = FastAPI()


@app.get("/api/cors/stations")
@app.get("/api/cors/stations/")
def stations(refresh_ntrip: bool = False):
    rows = stations_for_map(None, require_live_telemetry=False)
    rows, applied = cors_network._merge_archived_live_statuses(rows)
    if not applied and refresh_ntrip:
        return cors_network.stations(refresh_ntrip=True, _=None)
    return [cors_network._station_out(enrich_station(row)) for row in rows]
