from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/correlations")
@app.get("/api/space-weather/correlations/")
async def correlations(hours: float = 168.0, resample: str = "1h"):
    return await space_weather.correlations(hours=hours, resample=resample, _=None)
