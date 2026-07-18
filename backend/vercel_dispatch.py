"""Shared dispatch helper for named (non-dynamic) Vercel API function files.

Confirmed empirically (see api/[...path].py's history): dynamic Vercel
routes -- both spread catch-alls ([...path].py) and single dynamic
segments ([route].py) -- never get invoked for the trailing-slash-
normalized URL that this project's trailingSlash:true build config forces
every request into. Only exact, statically-named function files (no
brackets in the filename) reliably receive both slash forms. Every /api/*
endpoint that needs to work in production must therefore be a named file;
this helper keeps each one to a few lines instead of duplicating the ASGI
forwarding logic.
"""
from __future__ import annotations

import os

os.environ.setdefault("ZGIIS_BACKGROUND_SERVICES", "0")

from backend.main import app as fastapi_app  # noqa: E402


def make_dispatcher(backend_path: str):
    """Return an ASGI app that forwards every request (any method, any
    trailing slash, query string preserved) to `backend_path` on the
    shared FastAPI app."""
    target = "/" + backend_path.strip("/")

    class _Dispatcher:
        async def __call__(self, scope, receive, send):
            if scope.get("type") == "http":
                scope = {**scope, "path": target, "root_path": f"{scope.get('root_path', '')}/api"}
            await fastapi_app(scope, receive, send)

    return _Dispatcher()
