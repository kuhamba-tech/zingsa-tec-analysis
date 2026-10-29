"""Supabase Postgres connection settings.

Long-running processes use ``database_dsn()`` (``SUPABASE_DATABASE_URL``,
session pooler). Vercel serverless entry points under ``api/`` call
``activate_serverless_database()`` so ``database_dsn()`` returns
``pooled_database_dsn()`` (transaction pooler).
"""
from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

log = logging.getLogger(__name__)

_missing_logged = False


class DatabaseUnavailable(RuntimeError):
    """Supabase Postgres is not configured or could not be reached."""


def _clean(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


def _log_missing(which: str) -> None:
    global _missing_logged
    if _missing_logged:
        return
    _missing_logged = True
    log.error("%s is not configured; database routes cannot run", which)


def load_shared_database_env(project_root: str | Path | None = None) -> None:
    """Load ``backend/.env`` so Supabase settings are visible."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    root = Path(project_root) if project_root else Path(__file__).resolve().parents[2]
    load_dotenv(root / "backend" / ".env", override=False)


def ensure_sslmode(dsn: str) -> str:
    """Set a TLS mode this pooler can actually complete.

    The self-hosted Supavisor pooler does not terminate TLS. ``sslmode=prefer``
    spends a handshake proving that, so a URL with no mode uses ``disable``.
    An explicit ``sslmode`` already on the URL is kept.
    """
    parts = urlsplit(dsn)
    host = parts.hostname or ""
    if not host or parts.scheme not in {"postgres", "postgresql"}:
        return dsn
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if "sslmode" not in query:
        query["sslmode"] = "disable"
    if "connect_timeout" not in query:
        query["connect_timeout"] = "5"
    if "application_name" not in query:
        query["application_name"] = "zgiis"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _session_dsn() -> str:
    value = _clean(os.getenv("SUPABASE_DATABASE_URL"))
    if not value:
        _log_missing("SUPABASE_DATABASE_URL")
        return ""
    return ensure_sslmode(value)


def pooled_database_dsn() -> str:
    """Transaction-pooler DSN for serverless. Falls back to the session DSN."""
    value = _clean(os.getenv("SUPABASE_POOLER_URL"))
    if value:
        return ensure_sslmode(value)
    return _session_dsn()


def database_dsn() -> str:
    """DSN for this process.

    Serverless entry points set ``ZGIIS_SERVERLESS_DB`` via
    ``activate_serverless_database()`` and then receive the pooler URL.
    Everything else receives ``SUPABASE_DATABASE_URL``.
    """
    if os.getenv("ZGIIS_SERVERLESS_DB") == "1":
        return pooled_database_dsn()
    return _session_dsn()


def activate_serverless_database() -> str:
    """Mark this process as serverless and return the pooler DSN."""
    os.environ["ZGIIS_SERVERLESS_DB"] = "1"
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None
    if load_dotenv is not None:
        root = Path(__file__).resolve().parents[2]
        load_dotenv(root / "backend" / ".env", override=False)
    dsn = pooled_database_dsn()
    if not dsn:
        _log_missing("SUPABASE_POOLER_URL")
    return dsn


def execute_script(cur, sql: str) -> None:
    """Run one Postgres statement at a time. psycopg2 rejects multi-command strings."""
    parts = re.split(r";\s*\n", sql)
    for part in parts:
        stmt = part.strip().rstrip(";").strip()
        if stmt:
            cur.execute(stmt)


def database_backend_label(dsn: str) -> str:
    if not dsn:
        return "unconfigured"
    return "Supabase Postgres"


def database_host_kind(dsn: str) -> str:
    if not dsn:
        return "unconfigured"
    return "supabase"


def configured_database_env_key() -> str | None:
    if os.getenv("ZGIIS_SERVERLESS_DB") == "1" and _clean(os.getenv("SUPABASE_POOLER_URL")):
        return "SUPABASE_POOLER_URL"
    if _clean(os.getenv("SUPABASE_DATABASE_URL")):
        return "SUPABASE_DATABASE_URL"
    return None


def schema_init_enabled() -> bool:
    """DDL runs only from ``scripts/init_supabase_schema.py``.

    Request handlers and the collector must not ``ALTER TABLE`` while other
    sessions still hold read locks.
    """
    return _clean(os.getenv("ZGIIS_RUN_DB_SCHEMA_INIT")) == "1"


def pool_max_connections() -> int:
    """Serverless instances stay small. A long-running API or collector can hold more."""
    if os.getenv("VERCEL") or os.getenv("ZGIIS_SERVERLESS_DB") == "1":
        return 5
    return 10


_pools: dict[str, object] = {}
_pools_lock = threading.Lock()
_conn_owner: dict[int, tuple[object, str]] = {}
_owner_lock = threading.Lock()


def _resolve_dsn(dsn: str | None) -> str:
    raw = database_dsn() if dsn is None else dsn
    if not raw:
        raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
    return ensure_sslmode(raw)


def _pool_for(dsn: str):
    """Process-wide pool for one DSN. The first checkout opens a single connection."""
    with _pools_lock:
        pool = _pools.get(dsn)
        if pool is not None and not getattr(pool, "closed", False):
            return pool
        try:
            from psycopg2.pool import ThreadedConnectionPool
        except ImportError:
            raise
        pool = ThreadedConnectionPool(1, pool_max_connections(), dsn)
        _pools[dsn] = pool
        parts = urlsplit(dsn)
        log.info(
            "Postgres pool ready for %s:%s (max %s)",
            parts.hostname,
            parts.port,
            pool_max_connections(),
        )
        return pool


def _remember(conn, pool, dsn: str) -> None:
    with _owner_lock:
        _conn_owner[id(conn)] = (pool, dsn)


def _recall(conn) -> tuple[object, str] | tuple[None, None]:
    with _owner_lock:
        return _conn_owner.pop(id(conn), (None, None))


def _drop(conn) -> None:
    """Discard a dead connection so the pool opens a replacement next time."""
    if conn is None:
        return
    pool, _dsn = _recall(conn)
    if pool is None:
        try:
            conn.close()
        except Exception:
            pass
        return
    try:
        pool.putconn(conn, close=True)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def checkout(dsn: str | None = None):
    """Borrow a pooled connection. Pair with ``release``."""
    resolved = _resolve_dsn(dsn)
    pool = _pool_for(resolved)
    for _attempt in range(2):
        conn = pool.getconn()
        _remember(conn, pool, resolved)
        if not getattr(conn, "closed", 1):
            # A plain SELECT must not stay "idle in transaction". Writes that
            # need several statements opt into a transaction explicitly.
            conn.autocommit = True
            return conn
        _drop(conn)
    raise DatabaseUnavailable("Supabase Postgres connection is closed")


def release(conn, *, close: bool = False) -> None:
    """Return a borrowed connection. ``close=True`` drops it from the pool."""
    if conn is None:
        return
    if close or getattr(conn, "closed", 1):
        _drop(conn)
        return
    pool, _dsn = _recall(conn)
    if pool is None:
        try:
            conn.close()
        except Exception:
            pass
        return
    try:
        from psycopg2.extensions import TRANSACTION_STATUS_IDLE

        if conn.get_transaction_status() != TRANSACTION_STATUS_IDLE:
            conn.rollback()
        pool.putconn(conn)
    except Exception:
        try:
            pool.putconn(conn, close=True)
        except Exception:
            try:
                conn.close()
            except Exception:
                pass


def _owned_dsn(conn) -> str | None:
    with _owner_lock:
        owned = _conn_owner.get(id(conn))
    if owned is None:
        return None
    return owned[1]


def discard_if_dead(conn):
    """Keep ``conn`` when ``SELECT 1`` succeeds. Drop it when the socket is dead.

    The probe runs only after an operation has already failed.
    """
    if conn is None:
        return None
    if getattr(conn, "closed", 1):
        _drop(conn)
        return None
    try:
        # A failed statement aborts the transaction. Roll back before the
        # probe so a bad query is not mistaken for a dead socket.
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
        return conn
    except Exception:
        _drop(conn)
        return None


def reconnect_after_error(conn):
    """Replace a connection that did not survive ``discard_if_dead``."""
    if conn is None:
        return None
    dsn = _owned_dsn(conn)
    survived = discard_if_dead(conn)
    if survived is not None:
        return survived
    return checkout(dsn) if dsn else None


@contextmanager
def transaction(conn):
    """Run one atomic unit on a connection that is normally autocommit.

    ``with conn:`` does not open a transaction while autocommit is on.
    A transaction-mode pooler rejects ``set_session`` (used when autocommit
    is toggled). Those connections stay in autocommit and use BEGIN/COMMIT.
    """
    if conn is None or getattr(conn, "closed", 1):
        raise DatabaseUnavailable("Supabase Postgres connection is closed")
    previous = conn.autocommit
    try:
        conn.autocommit = False
    except Exception:
        cur = conn.cursor()
        try:
            cur.execute("BEGIN")
            yield conn
            cur.execute("COMMIT")
        except Exception:
            try:
                cur.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            cur.close()
        return
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.autocommit = previous
        except Exception:
            pass


@contextmanager
def get_conn(dsn: str | None = None):
    """Borrow a pooled connection for one block and return it afterwards.

    A closed connection is replaced before use. ``SELECT 1`` runs only when
    the block raises, and a failed check drops the connection so the next
    borrow opens a new one.
    """
    conn = checkout(dsn)
    try:
        yield conn
    except Exception:
        conn = discard_if_dead(conn)
        raise
    finally:
        release(conn)
