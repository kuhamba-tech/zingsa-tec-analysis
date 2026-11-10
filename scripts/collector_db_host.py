"""Point SUPABASE_DATABASE_URL at the Postgres container on the VPS.

Prints the rewritten URL on stdout. The password is left unchanged and is
never written to the log.
"""
from __future__ import annotations

import os
import re
import sys

_URL = re.compile(
    r"^(?P<scheme>postgres(?:ql)?://)"
    r"(?P<userinfo>[^@/]+@)?"
    r"(?P<host>[^:/?#]+)"
    r"(?P<port>:\d+)?"
    r"(?P<rest>/.*)?$"
)


def rewrite_database_url(dsn: str, host: str, port: str | None = None) -> str:
    match = _URL.match(dsn.strip())
    if not match or not host.strip():
        raise ValueError("SUPABASE_DATABASE_URL must be a postgres URL and the Docker host must be set")
    chosen_port = f":{port.strip()}" if port and port.strip() else (match.group("port") or "")
    return (
        f"{match.group('scheme')}"
        f"{match.group('userinfo') or ''}"
        f"{host.strip()}"
        f"{chosen_port}"
        f"{match.group('rest') or ''}"
    )


def main() -> int:
    host = os.getenv("SUPABASE_DOCKER_DB_HOST", "").strip()
    dsn = os.getenv("SUPABASE_DATABASE_URL", "").strip()
    if not host:
        print(dsn)
        return 0
    try:
        print(rewrite_database_url(dsn, host, os.getenv("SUPABASE_DOCKER_DB_PORT")))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
