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
    archived = cors_network._archived_status_counts()
    if archived is not None:
        online, degraded, offline, total = archived
        return {"online": online, "degraded": degraded, "offline": offline, "total": total}
    rows = cors_network.stations(refresh_ntrip=False, _=None)
    return {
        "online": sum(1 for row in rows if row.status == "online"),
        "degraded": sum(1 for row in rows if row.status == "degraded"),
        "offline": sum(1 for row in rows if row.status == "offline"),
        "total": len(rows),
    }
