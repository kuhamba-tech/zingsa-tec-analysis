from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/report")
@app.get("/api/space-weather/report/")
async def report(period: str = "hourly"):
    return await space_weather.space_weather_report(period=period, _=None)
