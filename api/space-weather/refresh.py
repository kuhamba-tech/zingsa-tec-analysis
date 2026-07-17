from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, Response

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import space_weather  # noqa: E402

app = FastAPI()


@app.post("/api/space-weather/refresh")
@app.post("/api/space-weather/refresh/")
async def refresh():
    await space_weather.refresh(_=None)
    return Response(status_code=204)
