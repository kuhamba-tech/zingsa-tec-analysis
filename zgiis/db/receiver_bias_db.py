"""Daily receiver-bias estimates for the near-real-time TEC maps.

One row is one station and one UTC day. Days without enough satellites are
not stored.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from zgiis.db.config import checkout, release, transaction

_DDL = """
CREATE TABLE IF NOT EXISTS receiver_bias_day (
    station      TEXT             NOT NULL,
    day          DATE             NOT NULL,
    bias_tecu    DOUBLE PRECISION NOT NULL,
    n_epochs     INTEGER          NOT NULL,
    n_samples    INTEGER          NOT NULL,
    bias_method  TEXT             NOT NULL,
    updated_at   TIMESTAMPTZ      NOT NULL,
    PRIMARY KEY (station, day)
)
"""


def _ready(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(_DDL)


def stored_days(start: date, end: date) -> set[tuple[str, date]]:
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT station, day
                FROM receiver_bias_day
                WHERE day >= %s AND day <= %s
                """,
                (start, end),
            )
            return {(str(station), day) for station, day in cur.fetchall()}
    finally:
        release(conn)


def delete_day(day: date) -> None:
    """Remove one UTC day so a later pass can replace it with identified biases only."""
    conn = checkout()
    try:
        _ready(conn)
        with transaction(conn):
            with conn.cursor() as cur:
                cur.execute("DELETE FROM receiver_bias_day WHERE day = %s", (day,))
    finally:
        release(conn)


def delete_station_day(station: str, day: date) -> None:
    conn = checkout()
    try:
        _ready(conn)
        with transaction(conn):
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM receiver_bias_day WHERE station = %s AND day = %s",
                    (station, day),
                )
    finally:
        release(conn)


def upsert_days(rows: list[tuple]) -> int:
    """Rows are (station, day, bias, n_epochs, n_samples, bias_method, updated_at)."""
    if not rows:
        return 0
    conn = checkout()
    try:
        _ready(conn)
        with transaction(conn):
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO receiver_bias_day
                        (station, day, bias_tecu, n_epochs, n_samples, bias_method, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (station, day) DO UPDATE SET
                        bias_tecu = EXCLUDED.bias_tecu,
                        n_epochs = EXCLUDED.n_epochs,
                        n_samples = EXCLUDED.n_samples,
                        bias_method = EXCLUDED.bias_method,
                        updated_at = EXCLUDED.updated_at
                    """,
                    rows,
                )
        return len(rows)
    finally:
        release(conn)


def read_series(days: int = 120) -> list[dict]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=max(1, int(days)) - 1)
    conn = checkout()
    try:
        _ready(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT station, day, bias_tecu, n_epochs, bias_method
                FROM receiver_bias_day
                WHERE day >= %s AND day <= %s
                ORDER BY station, day
                """,
                (start, end),
            )
            fetched = cur.fetchall()
    finally:
        release(conn)
    grouped: dict[str, list[dict]] = {}
    for station, day, bias, n_epochs, method in fetched:
        grouped.setdefault(str(station), []).append(
            {
                "day": day.isoformat(),
                "doy": int(day.strftime("%j")),
                "bias_tecu": round(float(bias), 3),
                "n_epochs": int(n_epochs or 0),
                "bias_method": method,
                "provisional": day == end,
            }
        )
    return [
        {"station": station, "points": points}
        for station, points in sorted(grouped.items())
    ]
