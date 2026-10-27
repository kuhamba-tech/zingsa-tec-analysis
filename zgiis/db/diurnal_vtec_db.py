"""Hourly Zimbabwe VTEC percentiles, one row per series and UT hour.

Stored so a later day can be opened beside an earlier one. Values are the
measured median and interquartile range for that hour — never a filled gap.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from zgiis.db.config import checkout, release, transaction

log = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS diurnal_vtec_hour (
    series            TEXT             NOT NULL,
    time              TIMESTAMPTZ      NOT NULL,
    p50               DOUBLE PRECISION,
    p25               DOUBLE PRECISION,
    p75               DOUBLE PRECISION,
    n                 INTEGER          NOT NULL DEFAULT 0,
    PRIMARY KEY (series, time)
)
"""

_SERIES = frozenset({"northern", "central", "southern", "quiet", "disturbed"})


def _ready(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(_DDL)


def upsert_hours(rows: list[tuple[str, datetime, float | None, float | None, float | None, int]]) -> int:
    """Keep the latest percentiles for each series and hour."""
    deduped: dict[tuple[str, datetime], tuple] = {}
    for series, when, p50, p25, p75, n in rows:
        if series not in _SERIES or when is None or p50 is None:
            continue
        stamp = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
        stamp = stamp.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        try:
            count = int(n)
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            continue
        deduped[(series, stamp)] = (series, stamp, float(p50), _num(p25), _num(p75), count)
    if not deduped:
        return 0
    conn = checkout()
    try:
        _ready(conn)
        with transaction(conn):
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO diurnal_vtec_hour (series, time, p50, p25, p75, n)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (series, time) DO UPDATE SET
                        p50 = EXCLUDED.p50,
                        p25 = EXCLUDED.p25,
                        p75 = EXCLUDED.p75,
                        n = EXCLUDED.n
                    """,
                    list(deduped.values()),
                )
        return len(deduped)
    finally:
        release(conn)


def list_days(limit: int = 21) -> list[str]:
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT (time AT TIME ZONE 'UTC')::date AS day
                FROM diurnal_vtec_hour
                ORDER BY day DESC
                LIMIT %s
                """,
                (max(1, int(limit)),),
            )
            return [row[0].isoformat() for row in cur.fetchall() if row and row[0] is not None]
    finally:
        release(conn)


def read_day(day: str) -> list[tuple[str, datetime, float | None, float | None, float | None, int]]:
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT series, time, p50, p25, p75, n
                FROM diurnal_vtec_hour
                WHERE time >= %s AND time < %s
                ORDER BY time
                """,
                (start, end),
            )
            return list(cur.fetchall())
    finally:
        release(conn)


def _num(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
