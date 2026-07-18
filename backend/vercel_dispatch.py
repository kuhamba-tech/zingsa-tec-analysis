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


def make_group_dispatcher():
    """Return an ASGI app that forwards every request using its OWN real
    incoming path (minus the /api prefix), instead of a single hardcoded
    target -- for one Vercel function file that fronts a whole group of
    backend routes via a vercel.json `rewrites` entry (e.g.
    "/api/tec/:path*" -> "/api/tec-router"), rather than one function file
    per route.

    This is the same forwarding logic api/index.py has always used
    (StripApiPrefix) for the bare /api path -- it works reliably there
    because Vercel invokes that exact file for that exact path. What does
    NOT work reliably is asking Vercel's *file-based dynamic routing*
    ([...path].py / [route].py) to invoke a file for arbitrary sub-paths;
    that path never receives the trailing-slash-normalized URL this
    project's trailingSlash:true build config forces every request into
    (confirmed empirically -- see api/[...path].py's removal). A
    vercel.json rewrite is a different mechanism: Vercel's edge routing
    layer resolves the match and invokes a single *named* file, which is
    reliable, while the invoked function still sees the original request
    path/query -- so grouping routes this way sidesteps the dynamic-file-
    routing problem instead of retrying it.

    Introduced to keep the total function count under the Hobby plan's
    12-per-deployment cap once one-file-per-route stopped scaling.
    """
    class _GroupDispatcher:
        async def __call__(self, scope, receive, send):
            if scope.get("type") == "http":
                path = scope.get("path", "")
                if path == "/api":
                    path = "/"
                elif path.startswith("/api/"):
                    path = path[len("/api"):]
                # Backend routes are registered without a trailing slash,
                # but every request this project's frontend makes has one
                # (trailingSlash:true). make_dispatcher's fixed-target
                # single-route files never had to care since the target was
                # hardcoded without one; forwarding an arbitrary incoming
                # path verbatim here would hit FastAPI's own 307
                # slash-redirect, whose Location header omits the /api
                # prefix this dispatcher strips -- breaking the request
                # client-side. Strip it here instead, once, up front.
                if len(path) > 1 and path.endswith("/"):
                    path = path[:-1]
                scope = {**scope, "path": path, "root_path": f"{scope.get('root_path', '')}/api"}
            await fastapi_app(scope, receive, send)

    return _GroupDispatcher()
