from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/history")
@app.get("/api/space-weather/history/")
async def history(hours: float = 24.0, resample: str | None = None):
    return await space_weather.history(hours=hours, resample=resample, _=None)
