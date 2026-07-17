from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.get("/api/space-weather/timelines")
@app.get("/api/space-weather/timelines/")
async def timelines():
    return await space_weather.timelines(_=None)
