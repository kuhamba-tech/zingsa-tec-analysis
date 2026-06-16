"""ZGIIS FastAPI backend — wraps the existing Python processing engine."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so tec_core and zgiis can be found
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import (
    chat,
    cors_network,
    forecast,
    live,
    processing,
    reports,
    space_weather,
    tec,
)

app = FastAPI(
    title="ZGIIS API",
    description="Zimbabwe GNSS Ionospheric Information System — REST API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to Vercel domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(space_weather.router)
app.include_router(cors_network.router)
app.include_router(processing.router)
app.include_router(tec.router)
app.include_router(live.router)
app.include_router(forecast.router)
app.include_router(reports.router)
app.include_router(chat.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ZGIIS API"}
