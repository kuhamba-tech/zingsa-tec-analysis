"""Vercel serverless entrypoint for the FastAPI backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ZGIIS_BACKGROUND_SERVICES", "0")

from backend.main import app as fastapi_app  # noqa: E402


class StripApiPrefix:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            path = scope.get("path", "")
            if path == "/api":
                scope = {**scope, "path": "/", "root_path": f"{scope.get('root_path', '')}/api"}
            elif path.startswith("/api/"):
                scope = {
                    **scope,
                    "path": path[4:],
                    "root_path": f"{scope.get('root_path', '')}/api",
                }
        await self.app(scope, receive, send)


app = StripApiPrefix(fastapi_app)
