from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/ekf/alerts")
@app.get("/api/space-weather/ekf/alerts/")
async def alerts(hours: float = 24.0):
    return await space_weather.ekf_alert_log(hours=hours, _=None)
