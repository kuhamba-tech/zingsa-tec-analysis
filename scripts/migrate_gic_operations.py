"""Apply only the additive GIC operations migration; never seeds field records."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    import psycopg2
    from zgiis.db.config import load_shared_database_env, pooled_database_dsn, execute_script
    load_shared_database_env()
    connection = psycopg2.connect(pooled_database_dsn(), connect_timeout=8)
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout='5s'")
                cursor.execute("SET LOCAL statement_timeout='20s'")
                cursor.execute("SELECT count(*) FROM gic_log")
                before = cursor.fetchone()[0]
                execute_script(cursor, (ROOT / "zgiis/db/gic_operations.sql").read_text(encoding="utf-8"))
                cursor.execute("SELECT count(*) FROM gic_log")
                after = cursor.fetchone()[0]
                if before != after:
                    raise RuntimeError("Measurement count changed during migration; rolling back")
        print(f"Additive GIC migration applied; measurement count preserved ({after}).")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
