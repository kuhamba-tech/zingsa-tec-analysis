"""Persistent NTRIP collector for production live VTEC ingestion.

Run this on an always-on machine. It connects to the ZINGSA NTRIP caster,
decodes RTCM observations, computes VTEC, and writes to TSDB_DSN so the
Vercel dashboard can read real live values without running long-lived streams
inside serverless functions.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

log = logging.getLogger("zgiis.collector")


def _load_env() -> None:
    load_dotenv(ROOT / "backend" / ".env", override=True)
    vercel_env = dotenv_values(ROOT / ".env.vercel.production")
    for key in (
        "TSDB_DSN",
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
        "POSTGRES_URL",
        "POSTGRES_URL_NON_POOLING",
    ):
        value = vercel_env.get(key)
        if value:
            os.environ[key] = value
    tsdb = (os.getenv("TSDB_DSN") or "").strip().strip('"').strip("'")
    if not tsdb:
        for key in ("POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "DATABASE_URL"):
            value = (os.getenv(key) or "").strip().strip('"').strip("'")
            if value:
                os.environ["TSDB_DSN"] = value
                break


def _parse_mountpoints() -> dict[str, str]:
    only = {
        item.strip().lower()
        for item in os.getenv("ZGIIS_COLLECTOR_STATIONS", "").split(",")
        if item.strip()
    }
    from zgiis.live.mountpoints import parse_mountpoints

    return parse_mountpoints(station_filter=only or None)


def main() -> int:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    _load_env()

    host = os.getenv("NTRIP_HOST", "").strip()
    port = int(os.getenv("NTRIP_PORT", "2101"))
    username = os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("NTRIP_PASSWORD", "").strip()
    connection = os.getenv("NTRIP_CONNECTION", "TCP").strip()
    mountpoints = _parse_mountpoints()

    missing = [
        name
        for name, value in {
            "NTRIP_HOST": host,
            "NTRIP_USERNAME": username,
            "NTRIP_PASSWORD": password,
            "NTRIP_MOUNTPOINTS or NTRIP_MOUNTPOINT": mountpoints,
            "TSDB_DSN": os.getenv("TSDB_DSN", "").strip(),
        }.items()
        if not value
    ]
    if missing:
        log.error("Missing required configuration: %s", ", ".join(missing))
        return 2

    from zgiis.db.timescale import TecDB
    from zgiis.live.ntrip_stream import LiveNtripManager
    from zgiis.live.satellite_geometry import LiveNavCache
    from zgiis.live.stec_vtec import LiveVtecPipeline

    stop = False

    def _stop(*_: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    db = TecDB()
    before = db.record_count()
    nav_cache = LiveNavCache()
    pipeline = LiveVtecPipeline(db=db, nav_cache=nav_cache, db_flush_n=int(os.getenv("ZGIIS_DB_FLUSH_N", "1")))
    manager = LiveNtripManager(
        {
            "host": host,
            "port": port,
            "username": username,
            "password": password,
            "connection": connection,
        },
        on_observation=pipeline.ingest,
        nav_cache=nav_cache,
    )
    manager.start(mountpoints)
    log.info(
        "Collector started for %d station(s), db=%s, initial_records=%s",
        len(mountpoints),
        db.backend,
        before,
    )

    try:
        while not stop:
            time.sleep(30)
            pipeline.flush_db()
            status = manager.status()
            fresh = [code for code, row in status.items() if row.get("last_seen")]
            try:
                records = db.record_count()
            except Exception:
                records = -1
            log.info(
                "Collector heartbeat: connected=%d fresh=%s records=%s",
                manager.active_count,
                ",".join(fresh) if fresh else "none",
                records,
            )
    finally:
        pipeline.flush_db()
        manager.stop()
        db.close()
        log.info("Collector stopped")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
