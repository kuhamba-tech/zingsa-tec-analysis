from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/storm-alerts/status")
@app.get("/api/space-weather/storm-alerts/status/")
async def status():
    return await space_weather.storm_alert_status(_=None)
