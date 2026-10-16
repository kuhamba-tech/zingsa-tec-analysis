"""Repo-root FastAPI entrypoint for Vercel default-location detection.

Vercel’s FastAPI preset looks for app.py / index.py / main.py / server.py at the
repository root (or under src/ / app/). This module exposes `app` there so
deploys do not fail with FASTAPI_ENTRYPOINT_NOT_FOUND when Framework Preset is
FastAPI and multiple api/*.py files also define `app`.

Preferred production path remains Next.js (see vercel.json) with Python
handlers under api/*.py; this file is the explicit FastAPI fallback.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("ZGIIS_BACKGROUND_SERVICES", "0")

from backend.main import app as fastapi_app  # noqa: E402


class StripApiPrefix:
    """Match api/index.py so /api/... and /... both reach the same routes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            path = scope.get("path", "")
            if path == "/api":
                scope = {
                    **scope,
                    "path": "/",
                    "root_path": f"{scope.get('root_path', '')}/api",
                }
            elif path.startswith("/api/"):
                scope = {
                    **scope,
                    "path": path[4:],
                    "root_path": f"{scope.get('root_path', '')}/api",
                }
        await self.app(scope, receive, send)


app = StripApiPrefix(fastapi_app)
