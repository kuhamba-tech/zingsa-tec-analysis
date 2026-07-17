from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import cors_network  # noqa: E402

app = FastAPI()


@app.get("/api/cors/stations")
@app.get("/api/cors/stations/")
def stations(refresh_ntrip: bool = False):
    return cors_network.stations(refresh_ntrip=refresh_ntrip, _=None)
