"""GIC timeline points for the operations dashboard and EKF pipeline."""
from __future__ import annotations

from typing import Any


def _best_station_id(summaries: list[dict[str, Any]]) -> str | None:
    if not summaries:
        return None
    ranked = sorted(summaries, key=lambda s: int(s.get("count") or 0), reverse=True)
    for row in ranked:
        sid = row.get("station_id")
        if sid and int(row.get("count") or 0) > 0:
            return str(sid)
    return None


def load_gic_timeline(
    hours: float = 168.0,
    resample: str = "1h",
) -> tuple[str | None, list[tuple[str, float]]]:
    """Return (station_id, chronological (timestamp, gic_a) pairs) from ingested field data.

    Uses the station with the most records in the log. Returns ([], None) when no
    measurements exist — never synthesises values.
    """
    try:
        from zgiis.db.gic_db import GicDB

        db = GicDB()
        station_id = _best_station_id(db.station_summaries())
        if not station_id:
            return None, []

        df = db.query_dataframe(station_id=station_id, hours=hours, resample=resample)
        if df.empty or "gic_a" not in df.columns:
            return station_id, []

        out: list[tuple[str, float]] = []
        for _, row in df.iterrows():
            t = row["time"]
            v = row.get("gic_a")
            if v is None:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            ts = t.isoformat() if hasattr(t, "isoformat") else str(t)
            out.append((ts, round(fv, 4)))
        return station_id, out
    except Exception:
        return None, []
