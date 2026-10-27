"""Hourly GOPI, Gg, and global TEC at each CORS station.

Only measured values are stored. A station-hour with no observation is omitted
so later morning, afternoon, and night comparisons are not filled in.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from zgiis.db.config import checkout, release, transaction

_DDL = """
CREATE TABLE IF NOT EXISTS tec_method_hour (
    station           TEXT             NOT NULL,
    time              TIMESTAMPTZ      NOT NULL,
    gopi              DOUBLE PRECISION,
    gg                DOUBLE PRECISION,
    global_vtec       DOUBLE PRECISION,
    gopi_n            INTEGER          NOT NULL DEFAULT 0,
    gg_n              INTEGER          NOT NULL DEFAULT 0,
    PRIMARY KEY (station, time)
)
"""


def _ready(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(_DDL)


def upsert_hours(
    rows: list[tuple[str, datetime, float | None, float | None, float | None, int, int]],
) -> int:
    deduped: dict[tuple[str, datetime], tuple] = {}
    for station, when, gopi, gg, global_vtec, gopi_n, gg_n in rows:
        code = str(station or "").lower().rstrip("_")
        if not code or when is None or (gopi is None and gg is None):
            continue
        stamp = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
        stamp = stamp.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        deduped[(code, stamp)] = (
            code,
            stamp,
            _num(gopi),
            _num(gg),
            _num(global_vtec),
            max(0, int(gopi_n or 0)),
            max(0, int(gg_n or 0)),
        )
    if not deduped:
        return 0
    conn = checkout()
    try:
        _ready(conn)
        with transaction(conn):
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO tec_method_hour
                        (station, time, gopi, gg, global_vtec, gopi_n, gg_n)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (station, time) DO UPDATE SET
                        gopi = EXCLUDED.gopi,
                        gg = EXCLUDED.gg,
                        global_vtec = COALESCE(EXCLUDED.global_vtec, tec_method_hour.global_vtec),
                        gopi_n = EXCLUDED.gopi_n,
                        gg_n = EXCLUDED.gg_n
                    """,
                    list(deduped.values()),
                )
        return len(deduped)
    finally:
        release(conn)


def list_days(limit: int = 21) -> list[str]:
    """Calendar dates in Zimbabwe local time (UTC+2)."""
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT (((time AT TIME ZONE 'UTC') + interval '2 hours')::date) AS day
                FROM tec_method_hour
                ORDER BY day DESC
                LIMIT %s
                """,
                (max(1, int(limit)),),
            )
            return [row[0].isoformat() for row in cur.fetchall() if row and row[0] is not None]
    finally:
        release(conn)


def read_local_day(day: str) -> list[tuple]:
    start_local = datetime.fromisoformat(day).replace(tzinfo=timezone(timedelta(hours=2)))
    end_local = start_local + timedelta(days=1)
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT station, time, gopi, gg, global_vtec, gopi_n, gg_n
                FROM tec_method_hour
                WHERE time >= %s AND time < %s
                ORDER BY time, station
                """,
                (start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)),
            )
            return list(cur.fetchall())
    finally:
        release(conn)


def _num(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number
