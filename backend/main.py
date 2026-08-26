"""ZGIIS FastAPI backend — wraps the existing Python processing engine."""
from __future__ import annotations

import logging
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

log = logging.getLogger(__name__)


def _auto_train_cnn_gru() -> None:
    from zgiis.ml.auto_train import maybe_train_cnn_gru

    maybe_train_cnn_gru()


# Make the project root importable so tec_core and zgiis can be found
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.env_bootstrap import load_runtime_env

# Local dashboard reads SQLite by default. Hosted Neon is for Vercel/collector
# production pushes — forcing it here hung local /cors/stations when Neon was unreachable.
# On Render, Blueprint injects DATABASE_URL/TSDB_DSN; do not prefer .env.vercel.*.
load_runtime_env(prefer_vercel_db=bool(os.getenv("VERCEL")))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import navigation_broadcast_scheduler, space_weather_logger, station_status_logger
from backend.startup_warmup import start_background_warmup
from backend.routers import (
    chat,
    cors_network,
    cosmic2,
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


def _background_services_enabled() -> bool:
    raw = os.getenv("ZGIIS_BACKGROUND_SERVICES", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not _background_services_enabled():
        log.info("Background services disabled. Set ZGIIS_BACKGROUND_SERVICES=1 to start NTRIP/logging schedulers.")
        yield
        return

    # Warm caches and start NTRIP ingest in background threads — never block HTTP startup.
    start_background_warmup(include_live_ingest=True)
    space_weather_logger.start()
    station_status_logger.start()
    navigation_broadcast_scheduler.start()
    threading.Thread(
        target=_auto_train_cnn_gru,
        daemon=True,
        name="cnn-gru-auto-train",
    ).start()
    yield
    navigation_broadcast_scheduler.stop()
    station_status_logger.stop()
    space_weather_logger.stop()
    from backend import live_manager

    live_manager.stop()


app = FastAPI(
    title="ZGIIS API",
    description="Zimbabwe GNSS Ionospheric Information System — REST API",
    version="1.0.0",
    lifespan=lifespan,
)


def _cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "").strip()
    if configured:
        return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    # Vercel serves UI + /api same-origin. Render serves a separate static site.
    if os.getenv("VERCEL") or (
        (os.getenv("ZGIIS_ENV") or "").strip().lower() in {"production", "prod"}
        and not os.getenv("RENDER")
    ):
        return []
    return [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ]


def _cors_origin_regex() -> str | None:
    """Allow browser clients on the local network during development.

    Next.js advertises a LAN URL when it starts. The frontend intentionally
    calls FastAPI on the same host at port 8000, so that browser origin must be
    accepted as well as localhost. Vercel production is same-origin unless an
    explicit regex is configured. Render uses CORS_ORIGIN_REGEX for the static site.
    """
    configured = os.getenv("CORS_ORIGIN_REGEX", "").strip()
    if configured:
        return configured
    if os.getenv("RENDER"):
        return r"https://.*\.onrender\.com"
    if os.getenv("VERCEL") or (os.getenv("ZGIIS_ENV") or "").strip().lower() in {"production", "prod"}:
        return None
    return (
        r"https?://(?:localhost|127\.0\.0\.1|\[::1\]|10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})"
        r"(?::\d{1,5})?"
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=_cors_origin_regex(),
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-API-Key", "X-Broadcast-Admin-Key"],
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    max_body_bytes = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(64 * 1024 * 1024)))
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_body_bytes:
                return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
    response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
    response.headers.setdefault("X-DNS-Prefetch-Control", "off")
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    if forwarded_proto == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

app.include_router(space_weather.router)
app.include_router(navigation_news.router)
app.include_router(cors_network.router)
app.include_router(processing.router)
app.include_router(tec.router)
app.include_router(cosmic2.router)
app.include_router(live.router)
app.include_router(forecast.router)
app.include_router(reports.router)
app.include_router(chat.router)
app.include_router(theory.router)
app.include_router(gic.router)


STATIC_EXPORT_DIR = Path(__file__).resolve().parents[1] / "static_export"


@app.get("/health")
async def health():
    """Always fast — used by dev.ps1 and load balancers."""
    from zgiis.space_weather.fetch_indices import _CACHE, _CACHE_LOCK, _is_available

    sw_ready = False
    spider_ready = False
    try:
        with _CACHE_LOCK:
            entry = _CACHE.get("space_weather") or _CACHE.get("space_weather_fast")
            sw_ready = bool(entry and _is_available(entry.get("data")))
    except Exception:
        pass
    try:
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

        if spider_status_enabled():
            payload = get_cached_spider_site_statuses()
            spider_ready = bool(payload.get("by_station"))
    except Exception:
        pass

    return {
        "status": "ok",
        "service": "ZGIIS API",
        "caches": {"space_weather": sw_ready, "spider_status": spider_ready},
    }


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
