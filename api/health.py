from __future__ import annotations

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
@app.get("/api/health/")
def health():
    return {"status": "ok", "service": "ZGIIS API"}
