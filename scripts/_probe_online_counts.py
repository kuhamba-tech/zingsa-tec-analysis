"""Print tec_method counts for the last 15 minutes. No connection strings."""
import logging

logging.basicConfig(level=logging.ERROR)

from zgiis.db.config import checkout, load_shared_database_env, release

load_shared_database_env()
conn = checkout()
try:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COALESCE(tec_method, ''), lower(station), count(*)::int
        FROM vtec_obs
        WHERE time >= now() - interval '15 minutes'
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC
        """
    )
    for method, code, n in cur.fetchall():
        print(method, code, n)
finally:
    release(conn)
