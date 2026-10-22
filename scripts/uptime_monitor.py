"""Independent station-status worker. Run: python scripts/uptime_monitor.py."""
import logging
from pathlib import Path
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.env_bootstrap import load_runtime_env
load_runtime_env()
from zgiis.db.uptime_monitor import UptimeMonitorDB
from zgiis.live.spider_site_status import fetch_spider_site_statuses
from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS


def main():
    logging.basicConfig(level=logging.INFO)
    owner = str(uuid.uuid4())
    codes = {s.code.lower().rstrip('_') for s in ZIMBABWE_CORS_STATIONS}
    while True:
        db = None
        try:
            # Fetch a new observation; cached status cannot confirm transitions.
            payload = fetch_spider_site_statuses(timeout=10)
            rows = {code: row['status'] for code, row in payload.get('by_station', {}).items()
                    if code in codes and row.get('spider_status') in (2, 3)}
            error = 'Station-status service unavailable; station outages are unconfirmed.' if payload.get('error') else None
            if len(rows) != len(codes):
                error = error or 'Incomplete station-status observation; confirmation paused.'
            db = UptimeMonitorDB()
            db.observe(rows, owner=owner, error=error)
        except Exception:
            logging.exception('Uptime monitor check failed')
        finally:
            if db:
                db.close()
        time.sleep(30)


if __name__ == '__main__':
    main()
