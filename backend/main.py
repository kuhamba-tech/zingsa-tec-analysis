"""ZGIIS FastAPI backend — wraps the existing Python processing engine."""
from __future__ import annotations

import logging
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

log = logging.getLogger(__name__)

# Make the project root importable so tec_core and zgiis can be found
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import live_manager, navigation_broadcast_scheduler, space_weather_logger, station_status_logger
from backend.routers import (
    chat,
    cors_network,
    forecast,
    gic,
    live,
    navigation_news,
    processing,
    reports,
    space_weather,
    tec,
    theory,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # NTRIP ingest can take time to connect 24 mountpoints — do not block API startup.
    threading.Thread(
        target=live_manager.start,
        daemon=True,
        name="zgiis-live-pipeline-start",
    ).start()
    space_weather_logger.start()
    station_status_logger.start()
    navigation_broadcast_scheduler.start()
    yield
    navigation_broadcast_scheduler.stop()
    station_status_logger.stop()
    space_weather_logger.stop()
    live_manager.stop()


app = FastAPI(
    title="ZGIIS API",
    description="Zimbabwe GNSS Ionospheric Information System — REST API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to Vercel domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(space_weather.router)
app.include_router(navigation_news.router)
app.include_router(cors_network.router)
app.include_router(processing.router)
app.include_router(tec.router)
app.include_router(live.router)
app.include_router(forecast.router)
app.include_router(reports.router)
app.include_router(chat.router)
app.include_router(theory.router)
app.include_router(gic.router)


STATIC_EXPORT_DIR = Path(__file__).resolve().parents[1] / "static_export"


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ZGIIS API"}


if STATIC_EXPORT_DIR.is_dir():
    # Serve the exported Next.js site ourselves rather than relying on Vercel's
    # public/ CDN convention, which did not pick up files generated mid-build.
    app.mount("/", StaticFiles(directory=STATIC_EXPORT_DIR, html=True), name="static")
else:
    @app.get("/")
    async def root():
        return {
            "service": "ZGIIS API",
            "docs": "/docs",
            "health": "/health",
            "ui": "Run scripts/vercel_build.py to export the frontend into static_export/",
        }
