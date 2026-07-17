from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.routers import cors_network  # noqa: E402

app = FastAPI()


@app.get("/api/cors/health")
@app.get("/api/cors/health/")
async def health():
    return await cors_network.health(_=None)
