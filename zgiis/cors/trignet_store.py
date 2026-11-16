"""Share collector results with Vercel without opening serverless NTRIP sessions."""
from __future__ import annotations

import json
import logging
import time

from zgiis.db.config import checkout, database_dsn, release

log = logging.getLogger(__name__)
DDL = """CREATE TABLE IF NOT EXISTS trignet_live_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    saved_at DOUBLE PRECISION NOT NULL,
    payload JSONB NOT NULL
)"""


def save_snapshot(payload: dict) -> bool:
    conn = None
    try:
        conn = checkout(database_dsn())
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute(
                "INSERT INTO trignet_live_snapshot (id, saved_at, payload) VALUES (1, %s, %s::jsonb) "
                "ON CONFLICT (id) DO UPDATE SET saved_at=EXCLUDED.saved_at, payload=EXCLUDED.payload",
                (time.time(), json.dumps(payload)),
            )
        conn.commit()
        return True
    except Exception:
        log.warning("TrigNet collector snapshot could not be saved")
        if conn is not None:
            conn.rollback()
        return False
    finally:
        if conn is not None:
            release(conn)


def expire_snapshot(payload: dict, saved_at: float, now: float | None = None) -> dict:
    """Keep site locations when a collector stops, but never stale online flags."""
    age = max(0.0, (time.time() if now is None else now) - saved_at)
    result = {**payload, "collector_age_s": round(age), "from_collector": True}
    if age > 90:
        result["stations"] = [{**r, "connected": False, "streaming": False} for r in payload.get("stations", [])]
    if age > 180:
        result["stations"] = [{**r, "vtec": None, "gg_vtec": None, "vtec_time": None,
                               "samples": 0, "gg_samples": 0} for r in result.get("stations", [])]
        result["tec_ready"] = result["gg_ready"] = 0
    return result


def load_snapshot() -> dict | None:
    conn = None
    try:
        conn = checkout(database_dsn())
        with conn.cursor() as cur:
            cur.execute("SELECT saved_at, payload FROM trignet_live_snapshot WHERE id=1")
            row = cur.fetchone()
        if not row:
            return None
        payload = row[1] if isinstance(row[1], dict) else json.loads(row[1])
        return expire_snapshot(payload, float(row[0]))
    except Exception:
        log.warning("TrigNet collector snapshot could not be loaded")
        return None
    finally:
        if conn is not None:
            release(conn)
