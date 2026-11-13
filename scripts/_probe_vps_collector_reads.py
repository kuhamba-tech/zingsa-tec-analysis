"""Compare recent Supabase collector completeness after local stop."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import psycopg2
from psycopg2.extras import RealDictCursor

from zgiis.db.config import database_dsn, load_shared_database_env
from zgiis.cors.stations import is_surveyor_general, zingsa_cors_stations


def main() -> None:
    load_shared_database_env(ROOT)
    dsn = database_dsn()
    print("dsn_configured", bool(dsn))
    if not dsn:
        raise SystemExit("No database DSN")

    expected = sorted(
        s.code.lower().rstrip("_")
        for s in zingsa_cors_stations()
        if not is_surveyor_general(s.code)
    )
    print("expected_zingsa_stations", len(expected))

    conn = psycopg2.connect(dsn, connect_timeout=10)
    conn.autocommit = True
    now = datetime.now(timezone.utc)
    print("now_utc", now.isoformat().replace("+00:00", "Z"))
    print("local_collector_stopped_approx_utc", "2026-11-11T07:29:00Z")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SET statement_timeout = '20000'")

        cur.execute(
            """
            SELECT date_trunc('hour', time) AS hour,
                   COUNT(*) AS n_rows,
                   COUNT(DISTINCT station) AS stations
            FROM vtec_obs
            WHERE tec_method LIKE %s
              AND time >= NOW() - INTERVAL '8 hours'
            GROUP BY 1
            ORDER BY 1
            """,
            ("%code_live%",),
        )
        print("HOURLY_CODE_LIVE")
        for row in cur.fetchall() or []:
            print(dict(row))

        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE time >= NOW() - INTERVAL '15 minutes') AS n_15m,
              COUNT(*) FILTER (WHERE time >= NOW() - INTERVAL '60 minutes') AS n_60m,
              COUNT(*) FILTER (
                WHERE time >= NOW() - INTERVAL '120 minutes'
                  AND time < NOW() - INTERVAL '60 minutes'
              ) AS n_prev_60m,
              COUNT(DISTINCT station) FILTER (WHERE time >= NOW() - INTERVAL '15 minutes') AS stations_15m,
              COUNT(DISTINCT station) FILTER (WHERE time >= NOW() - INTERVAL '60 minutes') AS stations_60m,
              COUNT(DISTINCT station) FILTER (
                WHERE time >= NOW() - INTERVAL '120 minutes'
                  AND time < NOW() - INTERVAL '60 minutes'
              ) AS stations_prev_60m,
              MAX(time) AS latest
            FROM vtec_obs
            WHERE tec_method LIKE %s
              AND time >= NOW() - INTERVAL '8 hours'
            """,
            ("%code_live%",),
        )
        recent = dict(cur.fetchone() or {})
        print("RECENT_COMPARE", recent)

        cur.execute(
            """
            SELECT lower(regexp_replace(station, '_$', '')) AS station,
                   MAX(time) AS latest,
                   COUNT(*) AS n
            FROM vtec_obs
            WHERE tec_method LIKE %s
              AND time >= NOW() - INTERVAL '60 minutes'
            GROUP BY 1
            ORDER BY latest DESC
            """,
            ("%code_live%",),
        )
        rows = cur.fetchall() or []
        seen = {str(r["station"]) for r in rows}
        missing = [code for code in expected if code not in seen]
        print("STATIONS_SEEN_60M", len(seen))
        print("STATIONS_MISSING_60M", missing)
        for row in rows:
            print(f"  {row['station']}\tlatest={row['latest']}\tn={row['n']}")

        cur.execute(
            """
            SELECT date_trunc('hour', time) AS hour,
                   COUNT(*) AS n_rows,
                   COUNT(*) FILTER (WHERE mean_vtec IS NOT NULL) AS with_vtec,
                   COUNT(*) FILTER (WHERE kp IS NOT NULL) AS with_kp,
                   COUNT(*) FILTER (WHERE plasma_speed IS NOT NULL) AS with_wind
            FROM space_weather_log
            WHERE time >= NOW() - INTERVAL '8 hours'
            GROUP BY 1
            ORDER BY 1
            """
        )
        print("SW_LOG_HOURLY")
        for row in cur.fetchall() or []:
            print(dict(row))

        cur.execute(
            """
            SELECT time, mean_vtec, stations_online, stations_total, kp, plasma_speed, source
            FROM space_weather_log
            ORDER BY time DESC
            LIMIT 15
            """
        )
        print("SW_LOG_LATEST")
        for row in cur.fetchall() or []:
            print(dict(row))

        # Method mix: are non-code_live methods still arriving?
        cur.execute(
            """
            SELECT COALESCE(tec_method, 'null') AS method,
                   COUNT(*) AS n,
                   COUNT(DISTINCT station) AS stations,
                   MAX(time) AS latest
            FROM vtec_obs
            WHERE time >= NOW() - INTERVAL '2 hours'
            GROUP BY 1
            ORDER BY n DESC
            LIMIT 20
            """
        )
        print("METHOD_MIX_2H")
        for row in cur.fetchall() or []:
            print(dict(row))

    conn.close()


if __name__ == "__main__":
    main()
