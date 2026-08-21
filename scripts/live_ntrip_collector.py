"""Persistent NTRIP collector for production live VTEC ingestion.

Run this on an always-on machine. It connects to the ZINGSA NTRIP caster,
decodes RTCM observations, computes VTEC, and writes to Supabase/Postgres so the
Vercel dashboard can read real live values without running long-lived streams
inside serverless functions.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

log = logging.getLogger("zgiis.collector")
DEFAULT_STATUS_PUSH_URL = (
    "https://zingsa-gnss-tec.vercel.app/api/cors-router/"
    "?__zr=%2Fcors%2Fstatus%2Fsnapshots"
)


def _load_env() -> None:
    load_dotenv(ROOT / "backend" / ".env", override=True)
    vercel_env = dotenv_values(ROOT / ".env.vercel.production")
    allow_neon = str(vercel_env.get("ALLOW_LEGACY_NEON_DATABASE_URL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if allow_neon:
        # `vercel env pull` deliberately preserves local-only keys. A removed,
        # stale SUPABASE_DATABASE_URL can therefore survive in the file and win
        # database_dsn()'s precedence order. Once the managed Neon connection is
        # explicitly enabled, discard those obsolete overrides in this process.
        os.environ.pop("SUPABASE_DATABASE_URL", None)
        os.environ.pop("TSDB_DSN", None)
    for key in (
        "SUPABASE_DATABASE_URL",
        "TSDB_DSN",
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
        "POSTGRES_URL",
        "POSTGRES_URL_NON_POOLING",
        "ALLOW_LEGACY_NEON_DATABASE_URL",
    ):
        value = vercel_env.get(key)
        if allow_neon and key in {"SUPABASE_DATABASE_URL", "TSDB_DSN"}:
            continue
        if value:
            os.environ[key] = value
    tsdb = (os.getenv("TSDB_DSN") or "").strip().strip('"').strip("'")
    if not tsdb:
        for key in (
            "POSTGRES_URL",
            "DATABASE_URL",
            "POSTGRES_URL_NON_POOLING",
            "DATABASE_URL_UNPOOLED",
        ):
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


def _status_push_url() -> str:
    """Return the deployable status endpoint.

    The Vercel build uses one statically named function per API group. Dynamic
    ``/api/cors/*`` paths return Vercel's own 404, so requests to the production
    host must target ``cors-router`` and carry the real FastAPI route in
    ``__zr`` (the same contract used by frontend/lib/api.ts).
    """
    raw = (os.getenv("STATUS_SNAPSHOT_PUSH_URL") or DEFAULT_STATUS_PUSH_URL).strip()
    if not raw:
        return ""

    parsed = urllib.parse.urlsplit(raw)
    if parsed.hostname == "zingsa-gnss-tec.vercel.app" and parsed.path.rstrip("/") in {
        "/cors/status/snapshots",
        "/api/cors/status/snapshots",
    }:
        query = urllib.parse.urlencode({"__zr": "/cors/status/snapshots"})
        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, "/api/cors-router/", query, parsed.fragment)
        )
    return raw


def _status_snapshot_rows(streams: dict[str, dict]) -> list[dict]:
    """Build snapshots using Spider as the map's authoritative status source.

    The public dashboard intentionally matches Leica Spider Site Status.  NTRIP
    stream health remains a useful fallback when Spider cannot be reached, but
    it must not overwrite a successful Spider result in the production archive.
    """
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, derive_status_from_stream
    from zgiis.live.spider_site_status import get_cached_spider_site_statuses

    spider_payload = get_cached_spider_site_statuses(refresh=True)
    spider_by_station = spider_payload.get("by_station") or {}
    when = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
    rows = []
    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        spider = spider_by_station.get(code)
        if spider:
            status = str(spider.get("status") or "offline").lower()
            source = "spider_site_status"
        else:
            status = derive_status_from_stream(streams.get(code))
            source = "collector_ntrip_fallback"
        rows.append(
            {
                "time": when,
                "station_code": code,
                "status": status,
                "api_reachable": True,
                "source": source,
            }
        )
    return rows


def _push_status_snapshots(streams: dict[str, dict]) -> None:
    """Push station snapshots to the deployed API as a DB-independent fallback."""
    url = _status_push_url()
    if not url:
        return

    rows = _status_snapshot_rows(streams)

    headers = {"Content-Type": "application/json"}
    api_key = (os.getenv("STATUS_SNAPSHOT_PUSH_API_KEY") or os.getenv("NEXT_PUBLIC_API_KEY") or "").strip()
    if api_key:
        headers["X-API-Key"] = api_key

    body = json.dumps({"snapshots": rows}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"snapshot push failed: HTTP {resp.status}")


def main() -> int:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    _load_env()

    from zgiis.live.ntrip_config import ntrip_host_from_env

    host = ntrip_host_from_env()
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

    from backend import station_status_logger
    from zgiis.db.timescale import TecDB
    from zgiis.live.broadcast_ephemeris import start_refresh_thread
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
    max_concurrent_raw = os.getenv("NTRIP_LIVE_MAX_CONCURRENT", "").strip()
    try:
        max_concurrent = max(1, int(max_concurrent_raw)) if max_concurrent_raw else None
    except ValueError:
        max_concurrent = None

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
        max_concurrent=max_concurrent,
    )
    manager.start(mountpoints)
    start_refresh_thread(
        nav_cache,
        interval_s=max(300.0, float(os.getenv("ZGIIS_EPHEMERIS_REFRESH_S", "3600"))),
    )
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
            try:
                station_status_logger.log_streams(status, source="collector")
            except Exception as exc:
                log.warning("Station status archive write failed: %s", exc)
            try:
                _push_status_snapshots(status)
            except Exception as exc:
                log.warning("Station status API push failed: %s", exc)
    finally:
        pipeline.flush_db()
        manager.stop()
        db.close()
        log.info("Collector stopped")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
