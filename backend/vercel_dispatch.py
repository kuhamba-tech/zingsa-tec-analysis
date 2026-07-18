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
import urllib.parse

os.environ.setdefault("ZGIIS_BACKGROUND_SERVICES", "0")

from backend.main import app as fastapi_app  # noqa: E402

# Query param a group dispatcher reads to learn which real backend route a
# request is actually for -- see make_group_dispatcher's docstring.
GROUP_ROUTE_PARAM = "__zr"


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
    """Return an ASGI app that forwards a request to whichever real backend
    route it's actually for, read from a `__zr` query parameter, instead of
    a single hardcoded target -- for one Vercel function file that fronts a
    whole group of backend routes (e.g. all of /tec/*), rather than one
    function file per route.

    A vercel.json `rewrites` entry (e.g. "/api/tec/:path*" ->
    "/api/tec-router") was tried first and seemed like the right mechanism
    -- Vercel's edge routing layer resolving the match and invoking one
    named file, distinct from the *file-based* dynamic routing
    ([...path].py / [route].py) confirmed broken earlier this project
    (that one never receives the trailing-slash-normalized URL this
    project's trailingSlash:true build forces every request into). But
    deployed and tested live, the rewrite never fired at all (Vercel
    served its own 404 without ever invoking the destination function) --
    this project builds via Next.js static export (output: "export"), and
    while vercel.json rewrites are a platform-level mechanism distinct
    from Next.js's own (confirmed-unsupported-under-static-export)
    next.config.js rewrites, they evidently don't fire reliably here
    either. Rather than keep guessing at unproven Vercel routing
    mechanisms, this reverts to the one thing proven reliable all
    session: a request landing on a real, named, statically-known
    function URL. The frontend's apiUrl() (frontend/lib/api.ts) encodes
    the real backend route as this query parameter instead of the path.

    Introduced to keep the total function count under the Hobby plan's
    12-per-deployment cap once one-file-per-route stopped scaling.
    """
    class _GroupDispatcher:
        async def __call__(self, scope, receive, send):
            if scope.get("type") == "http":
                raw_query = (scope.get("query_string") or b"").decode("utf-8", "ignore")
                parsed_query = urllib.parse.parse_qs(raw_query, keep_blank_values=True)
                real_route = (parsed_query.pop(GROUP_ROUTE_PARAM, [None]) or [None])[0]

                if real_route:
                    real_parsed = urllib.parse.urlsplit(real_route)
                    path = real_parsed.path
                    # frontend/lib/api.ts's get() appends extra params (mode,
                    # raw, etc.) onto the URL *after* apiUrl() already built
                    # the ?__zr=... string, so they land as sibling top-level
                    # params here rather than inside the encoded route --
                    # merge both sources rather than dropping one.
                    merged = urllib.parse.parse_qs(real_parsed.query, keep_blank_values=True)
                    for key, values in parsed_query.items():
                        merged.setdefault(key, []).extend(values)
                    query_string = urllib.parse.urlencode(merged, doseq=True).encode("utf-8")
                else:
                    # No __zr param: this is a direct hit on the router's
                    # own native URL (e.g. a manual/diagnostic request).
                    # Forward to FastAPI's root as a reasonable fallback.
                    path = "/"
                    query_string = scope.get("query_string", b"")

                # Backend routes are registered without a trailing slash;
                # strip one if the encoded route had it.
                if len(path) > 1 and path.endswith("/"):
                    path = path[:-1]

                scope = {
                    **scope,
                    "path": path,
                    "query_string": query_string,
                    "root_path": f"{scope.get('root_path', '')}/api",
                }
            await fastapi_app(scope, receive, send)

    return _GroupDispatcher()
