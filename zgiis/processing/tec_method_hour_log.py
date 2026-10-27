"""Log measured GOPI, Gg, and global TEC by station and UT hour.

Gg is the same Cesaroni calibration used by the live comparison table.
Inverse-distance fills from that table are not written. A station-hour is
kept only when GOPI or Gg was actually measured.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

CAT = timezone(timedelta(hours=2))
# Same guard as the live table: a larger gap is a failed short-arc fit.
MAX_PAIR_DELTA_TECU = 15.0
SAMPLES_PER_HOUR = 40

PERIODS = (
    ("night", "Night", "18:00–06:00 CAT"),
    ("morning", "Morning", "06:00–12:00 CAT"),
    ("afternoon", "Afternoon", "12:00–18:00 CAT"),
)


def archive_method_hours(hours: float = 6.0) -> int:
    """Store recent measured hours. Safe to call when the heat-map page is closed."""
    end = datetime.now(tz=timezone.utc)
    start = end - timedelta(hours=max(1.0, float(hours)))
    try:
        from zgiis.db.tec_method_hour_db import upsert_hours
        from zgiis.db.timescale import TecDB

        db = TecDB()
        try:
            rows = _hour_rows(db, start, end)
        finally:
            db.close()
        return upsert_hours(rows)
    except Exception:
        log.warning("method comparison hour log failed", exc_info=True)
        return 0


def period_comparison(day: str | None = None) -> dict[str, Any]:
    """Morning, afternoon, and night means for one Zimbabwe local date."""
    from zgiis.db.tec_method_hour_db import list_days, read_local_day

    days = []
    try:
        days = list_days()
    except Exception:
        log.debug("method-hour day list unavailable", exc_info=True)
    selected = (day or "").strip()[:10]
    if not selected:
        selected = datetime.now(tz=CAT).date().isoformat()
    stored: list[tuple] = []
    try:
        stored = read_local_day(selected)
    except Exception:
        log.debug("method-hour day read failed", exc_info=True)
        stored = []

    buckets: dict[str, list[tuple]] = {key: [] for key, _, _ in PERIODS}
    for row in stored:
        period = _period_name(row[1])
        if period in buckets:
            buckets[period].append(row)

    return {
        "day": selected,
        "timezone": "CAT (UTC+2)",
        "logged_days": days,
        "periods": [_summarize(key, label, window, buckets[key]) for key, label, window in PERIODS],
        "note": (
            "Each figure is the median of measured station-hours. GOPI is live code TEC, Gg is the Cesaroni "
            "calibration of those samples, and Global is the DLR map at the station. "
            "Interpolated cells in the live table are not included. A missing period "
            "has no stored measurements."
        ),
    }


def _hour_rows(db: Any, start: datetime, end: datetime) -> list[tuple]:
    gopi = _gopi_hours(db, start, end)
    global_tec = _global_hours(db, start, end)
    gg = _gg_hours(db, start, end)
    keys = set(gopi) | set(gg)
    rows = []
    for key in keys:
        gopi_value, gopi_n = gopi.get(key, (None, 0))
        gg_value, gg_n = gg.get(key, (None, 0))
        if gopi_value is not None and gg_value is not None and abs(gg_value - gopi_value) > MAX_PAIR_DELTA_TECU:
            gg_value, gg_n = None, 0
        if gopi_value is None and gg_value is None:
            continue
        rows.append((key[0], key[1], gopi_value, gg_value, global_tec.get(key), gopi_n, gg_n))
    return rows


def _gopi_hours(db: Any, start: datetime, end: datetime) -> dict[tuple[str, datetime], tuple[float, int]]:
    sql = """
    SELECT lower(rtrim(station, '_')) AS station,
           date_trunc('hour', time) AS hour,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY vtec_tecu) AS gopi,
           count(*)::int AS n
    FROM vtec_obs
    WHERE time >= %s AND time < %s
      AND tec_method LIKE '%%code_live%%'
      AND vtec_tecu > 0 AND vtec_tecu < 120
      AND (elevation_deg IS NULL OR elevation_deg >= 30)
    GROUP BY 1, 2
    """
    frame = db._read_sql(sql, [start, end])
    return _value_map(frame, "gopi", "n")


def _global_hours(db: Any, start: datetime, end: datetime) -> dict[tuple[str, datetime], float]:
    sql = """
    SELECT lower(rtrim(station, '_')) AS station,
           date_trunc('hour', time) AS hour,
           avg(vtec_tecu) AS global_vtec
    FROM vtec_obs
    WHERE time >= %s AND time < %s
      AND tec_method = 'dlr_fc_1h_global'
      AND vtec_tecu > 0 AND vtec_tecu < 120
    GROUP BY 1, 2
    """
    frame = db._read_sql(sql, [start, end])
    out: dict[tuple[str, datetime], float] = {}
    if frame is None or getattr(frame, "empty", True):
        return out
    for _, row in frame.iterrows():
        key = _key(row.get("station"), row.get("hour"))
        value = _finite(row.get("global_vtec"))
        if key is not None and value is not None:
            out[key] = value
    return out


def _gg_hours(db: Any, start: datetime, end: datetime) -> dict[tuple[str, datetime], tuple[float, int]]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, get_station
    from zgiis.processing.gg_calibration import calibrate_gg_from_observations

    sql = """
    SELECT time, station, prn, constellation, elevation_deg, stec_tecu, vtec_tecu
    FROM (
        SELECT time, station, prn, constellation, elevation_deg, stec_tecu, vtec_tecu,
               row_number() OVER (
                   PARTITION BY lower(rtrim(station, '_')), date_trunc('hour', time)
                   ORDER BY time DESC
               ) AS rn
        FROM vtec_obs
        WHERE time >= %s AND time < %s
          AND tec_method LIKE '%%code_live%%'
          AND vtec_tecu > 0 AND vtec_tecu < 120
          AND elevation_deg >= 30
    ) sampled
    WHERE rn <= %s
    """
    frame = db._read_sql(sql, [start, end, SAMPLES_PER_HOUR])
    if frame is None or getattr(frame, "empty", True):
        return {}
    known = {s.code.lower().rstrip("_"): (float(s.lat), float(s.lon)) for s in ZIMBABWE_CORS_STATIONS}
    by_station: dict[str, list[dict[str, Any]]] = {}
    for _, row in frame.iterrows():
        code = str(row.get("station") or "").lower().rstrip("_")
        if not code:
            continue
        lat, lon = known.get(code, (None, None))
        if lat is None:
            station = get_station(code)
            if station is None:
                continue
            lat, lon = float(station.lat), float(station.lon)
        by_station.setdefault(code, []).append(
            {
                "time": row.get("time"),
                "station": code,
                "prn": row.get("prn"),
                "constellation": row.get("constellation"),
                "elevation_deg": row.get("elevation_deg"),
                "stec_tecu": row.get("stec_tecu"),
                "vtec_tecu": row.get("vtec_tecu"),
                "lat": lat,
                "lon": lon,
            }
        )
    out: dict[tuple[str, datetime], tuple[float, int]] = {}
    for code, samples in by_station.items():
        try:
            calibrated = calibrate_gg_from_observations(samples)
        except Exception:
            log.debug("Gg hour log skipped for %s", code, exc_info=True)
            continue
        hour_vals: dict[datetime, list[float]] = {}
        for item in calibrated:
            value = _finite(item.get("vtec_tecu"))
            stamp = item.get("time")
            if value is None or stamp is None:
                continue
            try:
                when = stamp if isinstance(stamp, datetime) else datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
            except ValueError:
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            hour = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
            hour_vals.setdefault(hour, []).append(value)
        for hour, vals in hour_vals.items():
            if not vals:
                continue
            ordered = sorted(vals)
            out[(code, hour)] = (ordered[len(ordered) // 2], len(vals))
    return out


def _value_map(frame: Any, value_col: str, count_col: str) -> dict[tuple[str, datetime], tuple[float, int]]:
    out: dict[tuple[str, datetime], tuple[float, int]] = {}
    if frame is None or getattr(frame, "empty", True):
        return out
    for _, row in frame.iterrows():
        key = _key(row.get("station"), row.get("hour"))
        value = _finite(row.get(value_col))
        if key is None or value is None:
            continue
        try:
            count = int(row.get(count_col) or 0)
        except (TypeError, ValueError):
            count = 0
        out[key] = (value, count)
    return out


def _key(station: Any, hour: Any) -> tuple[str, datetime] | None:
    code = str(station or "").lower().rstrip("_")
    if not code or hour is None:
        return None
    try:
        when = hour.to_pydatetime() if hasattr(hour, "to_pydatetime") else hour
    except Exception:
        return None
    if not isinstance(when, datetime):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    when = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return code, when


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number <= 0 or number >= 120:
        return None
    return number


def _period_name(stamp: datetime) -> str:
    when = stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
    hour = when.astimezone(CAT).hour
    if 6 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    return "night"


def _summarize(key: str, label: str, window: str, rows: list[tuple]) -> dict[str, Any]:
    paired_methods = []
    paired_gopi_global = []
    paired_gg_global = []
    gopi_vals = []
    gg_vals = []
    global_vals = []
    for _station, _time, gopi, gg, global_vtec, _gopi_n, _gg_n in rows:
        if gopi is not None:
            gopi_vals.append(float(gopi))
        if gg is not None:
            gg_vals.append(float(gg))
        if global_vtec is not None:
            global_vals.append(float(global_vtec))
        if gopi is not None and gg is not None:
            paired_methods.append(float(gg) - float(gopi))
        if gopi is not None and global_vtec is not None:
            paired_gopi_global.append(float(gopi) - float(global_vtec))
        if gg is not None and global_vtec is not None:
            paired_gg_global.append(float(gg) - float(global_vtec))
    return {
        "id": key,
        "label": label,
        "hours_local": window,
        "station_hours": len(rows),
        "gopi": _median(gopi_vals),
        "gg": _median(gg_vals),
        "global": _median(global_vals),
        "gg_minus_gopi": _median(paired_methods),
        "gopi_minus_global": _median(paired_gopi_global),
        "gg_minus_global": _median(paired_gg_global),
        "method_pairs": len(paired_methods),
        "gopi_global_pairs": len(paired_gopi_global),
        "gg_global_pairs": len(paired_gg_global),
    }


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[len(ordered) // 2], 2)
