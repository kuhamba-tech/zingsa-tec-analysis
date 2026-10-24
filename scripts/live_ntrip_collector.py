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
_COLLECTOR_LOCK = ROOT / "static" / "data" / ".live_ntrip_collector.lock"
_STATUS_PUSH_RETRY_AFTER = 15 * 60
_status_push_disabled_until = 0.0


def _acquire_collector_lock() -> bool:
    """Ensure only one collector holds NTRIP slots and SQLite writes.

    A stale PID or stale lock file should not block startup forever. On Windows,
    the file lock is advisory and is not automatically cleared when the previous
    process dies unexpectedly, so we treat an invalid or dead PID as disposable.
    """
    _COLLECTOR_LOCK.parent.mkdir(parents=True, exist_ok=True)
    handle = open(_COLLECTOR_LOCK, "a+", encoding="utf-8")

    try:
        stale_pid = None
        try:
            handle.seek(0)
            candidate = handle.read().strip()
            if candidate:
                try:
                    stale_pid = int(candidate)
                except ValueError:
                    stale_pid = None
            if stale_pid is not None:
                try:
                    from zgiis.live.process_health import pid_alive
                    if not pid_alive(stale_pid):
                        stale_pid = None
                except OSError:
                    stale_pid = None
        except Exception:
            stale_pid = None

        if stale_pid is not None:
            log.error(
                "Another live_ntrip_collector holds the lock. "
                "Stop it before starting a second instance.",
            )
            handle.close()
            return False

        if os.name == "nt":
            import msvcrt

            # Windows locks a byte range rather than the Unix file descriptor.
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(" ")
                handle.flush()
            # Lock beyond the PID text so health checks can read it on Windows.
            handle.seek(1024)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error(
            "Another live_ntrip_collector holds the lock. "
            "Stop it before starting a second instance.",
        )
        handle.close()
        return False

    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    # Keep handle open for process lifetime so the lock is not released early.
    globals()["_COLLECTOR_LOCK_HANDLE"] = handle
    return True


def _load_env() -> None:
    from backend.env_bootstrap import load_runtime_env

    load_runtime_env()
    # Schema is applied by scripts/init_supabase_schema.py. The collector
    # only ingests observations.
    os.environ["ZGIIS_SKIP_DB_SCHEMA_INIT"] = "1"


def _parse_mountpoints() -> dict[str, str]:
    only = {
        item.strip().lower()
        for item in os.getenv("ZGIIS_COLLECTOR_STATIONS", "").split(",")
        if item.strip()
    }
    from zgiis.live.mountpoints import live_priority_codes, order_mountpoints, parse_mountpoints

    mapping = parse_mountpoints(station_filter=only or None)
    return order_mountpoints(mapping, live_priority_codes())


def _status_push_url() -> str:
    """Return the deployable status endpoint.

    The Vercel build uses one statically named function per API group. Dynamic
    ``/api/cors/*`` paths return Vercel's own 404, so requests to the production
    host must target ``cors-router`` and carry the real FastAPI route in
    ``__zr`` (the same contract used by frontend/lib/api.ts).

    On Render the FastAPI service exposes real paths, so
    ``STATUS_SNAPSHOT_PUSH_URL`` should be
    ``https://<api-service>.onrender.com/cors/status/snapshots``.
    """
    raw = (os.getenv("STATUS_SNAPSHOT_PUSH_URL") or "").strip()
    if not raw:
        api_host = (os.getenv("RENDER_API_HOST") or "").strip()
        if api_host:
            raw = f"https://{api_host}/cors/status/snapshots"
        else:
            raw = DEFAULT_STATUS_PUSH_URL

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
    if spider_by_station:
        try:
            from zgiis.live.spider_status_store import save_spider_status_payload

            body = {
                "fetched_at": spider_payload.get("fetched_at"),
                "by_station": spider_by_station,
                "disk_saved_at": time.time(),
                "error": spider_payload.get("error"),
            }
            save_spider_status_payload(body)
        except Exception:
            pass
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
    global _status_push_disabled_until
    if os.getenv("STATUS_SNAPSHOT_PUSH_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}:
        return
    if time.monotonic() < _status_push_disabled_until:
        return
    url = _status_push_url()
    if not url:
        return

    rows = _status_snapshot_rows(streams)

    headers = {"Content-Type": "application/json"}
    api_key = (os.getenv("STATUS_SNAPSHOT_PUSH_API_KEY") or os.getenv("API_KEY") or os.getenv("NEXT_PUBLIC_API_KEY") or "").strip()
    if api_key:
        headers["X-API-Key"] = api_key

    body = json.dumps({"snapshots": rows}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=8) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"snapshot push failed: HTTP {resp.status}")


def main() -> int:
    global _status_push_disabled_until
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if not _acquire_collector_lock():
        return 3
    _load_env()

    from zgiis.live.ntrip_config import ntrip_host_from_env

    host = ntrip_host_from_env()
    port = int(os.getenv("NTRIP_PORT", "2101"))
    username = os.getenv("NTRIP_USERNAME", "").strip()
    password = os.getenv("NTRIP_PASSWORD", "").strip()
    connection = os.getenv("NTRIP_CONNECTION", "TCP").strip()
    mountpoints = _parse_mountpoints()

    from zgiis.db.config import database_dsn

    db_target = database_dsn()
    missing = [
        name
        for name, value in {
            "NTRIP_HOST": host,
            "NTRIP_USERNAME": username,
            "NTRIP_PASSWORD": password,
            "NTRIP_MOUNTPOINTS or NTRIP_MOUNTPOINT": mountpoints,
        }.items()
        if not value
    ]
    if not db_target:
        log.error("SUPABASE_DATABASE_URL is not configured")
        missing.append("SUPABASE_DATABASE_URL")
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
    nav_cache = LiveNavCache()
    from zgiis.live.tec_outbox import TecOutbox
    outbox = TecOutbox(ROOT / "static" / "data" / "tec_capture_outbox.sqlite")
    pipeline = LiveVtecPipeline(db=db, nav_cache=nav_cache, db_flush_n=int(os.getenv("ZGIIS_DB_FLUSH_N", "50")), outbox=outbox)
    pipeline.flush_db()
    max_concurrent_raw = os.getenv("NTRIP_LIVE_MAX_CONCURRENT", "1").strip()
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
        "Collector started for %d station(s), db=%s",
        len(mountpoints),
        db.backend,
    )

    try:
        prune_every = max(1, int(os.getenv("ZGIIS_VTEC_PRUNE_EVERY_HEARTBEATS", "20")))
    except ValueError:
        prune_every = 20
    try:
        prune_days = max(1, int(os.getenv("ZGIIS_VTEC_PRUNE_DAYS", "7")))
    except ValueError:
        prune_days = 7
    heartbeat_n = 0

    try:
        while not stop:
            time.sleep(30)
            pipeline.flush_db()
            heartbeat_n += 1
            if heartbeat_n >= prune_every:
                heartbeat_n = 0
                try:
                    deleted = db.prune_older_than(days=prune_days)
                    if deleted:
                        log.info(
                            "Prune removed %d observation(s) older than %d days",
                            deleted,
                            prune_days,
                        )
                except Exception as exc:
                    log.warning("Observation prune failed: %s", exc)
            status = manager.status()
            fresh = [code for code, row in status.items() if row.get("last_seen")]
            records = sum(
                int(row.get("vtec_emitted", 0))
                for row in pipeline.diagnostics_by_station().values()
            )
            log.info(
                "Collector heartbeat: connected=%d fresh=%s session_records=%s",
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
                _status_push_disabled_until = time.monotonic() + _STATUS_PUSH_RETRY_AFTER
                log.warning("Station status API push failed: %s", exc)
    finally:
        pipeline.flush_db()
        manager.stop()
        db.close()
        log.info("Collector stopped")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
