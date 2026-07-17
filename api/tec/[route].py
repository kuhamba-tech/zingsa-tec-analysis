"""Vercel serverless entrypoint for single-segment /tec/<route> paths.

api/[...path].py (a catch-all) already wraps the full FastAPI app, but
requests to it 404 once Next.js's trailingSlash:true build config forces a
trailing slash onto the URL before Vercel's routing layer ever considers the
catch-all function -- confirmed empirically: /api/tec/archive-meta 308s to
/api/tec/archive-meta/, and that trailing-slash form never reaches the
catch-all at all (falls through to Next.js's own static-export 404 page).
Named, non-catch-all function files (api/cors/health.py etc.) don't have
this problem. This file mirrors that working pattern for every single-
segment /tec/<route> path (archive-meta, time-series, diurnal, seasonal,
solar-cycle, guvi-on2, omni-analysis, celestrak-analysis, gfz-kp-analysis,
wdc-kyoto-analysis, intermagnet-analysis, cosmic2-analysis, anomalies,
anomaly-analysis, heatmap, prn) by dispatching into the same backend.main
FastAPI app, just addressed via a single dynamic segment instead of a
catch-all. Nested /tec/prn/* paths still need their own handling.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ZGIIS_BACKGROUND_SERVICES", "0")

from backend.main import app as fastapi_app  # noqa: E402


class TecRouteDispatch:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            path = scope.get("path", "")
            prefix = "/api/tec/"
            if path.startswith(prefix):
                route = path[len(prefix):].rstrip("/")
                scope = {**scope, "path": f"/tec/{route}", "root_path": f"{scope.get('root_path', '')}/api"}
        await self.app(scope, receive, send)


app = TecRouteDispatch(fastapi_app)
