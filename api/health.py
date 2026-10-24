from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from zgiis.db.config import activate_serverless_database, pooled_database_dsn  # noqa: E402

activate_serverless_database()
pooled_database_dsn()

app = FastAPI()


@app.get("/api/health")
@app.get("/api/health/")
def health():
    return {"status": "ok", "service": "ZGIIS API"}
