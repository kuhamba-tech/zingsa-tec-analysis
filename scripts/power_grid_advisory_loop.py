"""Post the live ZESA advisory at every 15-minute mark in Zimbabwe time.

Stops when scripts/_power_grid_loop.stop exists, so the Vercel cron can take over
without sending the same update twice.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.env_bootstrap import load_runtime_env
from zgiis.space_weather.power_grid_slack import CAT, dispatch_power_grid_advisory

STOP = Path("scripts/_power_grid_loop.stop")


def next_mark(now: datetime) -> datetime:
    current = now.astimezone(CAT).replace(second=5, microsecond=0)
    minute = ((current.minute // 15) + 1) * 15
    if minute >= 60:
        return current.replace(minute=0) + timedelta(hours=1)
    return current.replace(minute=minute)


def main() -> None:
    load_runtime_env()
    while not STOP.exists():
        target = next_mark(datetime.now(CAT))
        while datetime.now(CAT) < target:
            if STOP.exists():
                return
            time.sleep(5)
        if STOP.exists():
            return
        result = dispatch_power_grid_advisory()
        print(
            datetime.now(timezone.utc).isoformat(),
            result.get("ok"),
            result.get("level"),
            result.get("detail"),
            flush=True,
        )


if __name__ == "__main__":
    main()
