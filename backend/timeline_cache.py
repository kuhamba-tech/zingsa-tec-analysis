from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from typing import Iterable

from backend.schemas import TimelinePoint

# OS temp dir, not a project-relative path — Vercel's filesystem is read-only
# outside of /tmp. This is a best-effort gap-filling cache, not a system of
# record, so it's fine for it to be ephemeral per cold start.
DB_PATH = Path(tempfile.gettempdir()) / "zgiis_space_weather_backfill.sqlite"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS space_weather_timeline (
            metric TEXT NOT NULL,
            time_tag TEXT NOT NULL,
            value REAL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (metric, time_tag)
        )
        """
    )
    return conn


def upsert_timeline(metric: str, points: Iterable[TimelinePoint]) -> None:
    rows = [(metric, point.t, point.v) for point in points if point.t]
    if not rows:
        return
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO space_weather_timeline (metric, time_tag, value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(metric, time_tag) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            """,
            rows,
        )


def read_timeline(metric: str, limit: int = 2000) -> list[TimelinePoint]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT time_tag, value
            FROM space_weather_timeline
            WHERE metric = ?
            ORDER BY time_tag DESC
            LIMIT ?
            """,
            (metric, limit),
        ).fetchall()
    return [TimelinePoint(t=str(t), v=v) for t, v in reversed(rows)]


def merge_timeline(metric: str, live_points: list[TimelinePoint], limit: int = 2000) -> list[TimelinePoint]:
    upsert_timeline(metric, live_points)
    cached = read_timeline(metric, limit=limit)
    merged = {point.t: point for point in cached}
    for point in live_points:
        if point.t:
            merged[point.t] = point
    return list(sorted(merged.values(), key=lambda point: point.t))[-limit:]
