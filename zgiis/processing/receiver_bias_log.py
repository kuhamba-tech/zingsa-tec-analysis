"""Daily receiver bias for the near-real-time TEC maps.

Matamba and Danskin, and Gopi section 4.2.5: after the satellite differential
code bias, search for the receiver bias that minimises the standard deviation
of vertical TEC at elevations of at least 30 degrees. A UTC day with fewer
than two satellites in an epoch is not stored.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG

log = logging.getLogger(__name__)

_MIN_EPOCHS = 8
_MIN_SATELLITES = 3
_BACKFILL_DAYS = 45
_DAYS_PER_RUN = 3
_settled_days: set[date] = set()


def _prn_key(raw: object) -> str:
    text = str(raw or "").strip().upper()
    if len(text) >= 2 and text[0] in "GRECJ" and text[1:].isdigit():
        return f"{text[0]}{int(text[1:]):02d}"
    if text.isdigit():
        return f"G{int(text):02d}"
    return text


def _satellite_dcb(day: date) -> tuple[dict[str, float], dict[str, float]] | None:
    try:
        from tec_core import TecConfig, _load_dcb_for_date

        folder = TecConfig().dcb_folder
        if folder is None:
            return None
        p1c1, p1p2 = _load_dcb_for_date(folder, pd.Timestamp(day.isoformat()))
    except Exception as exc:
        log.info("Satellite DCB unavailable for %s: %s", day.isoformat(), exc)
        return None
    if not p1c1 and not p1p2:
        return None
    return p1c1 or {}, p1p2 or {}


def _day_frame(day: date) -> pd.DataFrame:
    from zgiis.db.config import checkout, release

    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    conn = checkout()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT lower(rtrim(station, '_')) AS station,
                       date_bin('3 minutes', time, TIMESTAMPTZ '2000-01-01') AS timestamp,
                       prn,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY stec_tecu) AS stec,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY elevation_deg) AS elevation
                FROM vtec_obs
                WHERE time >= %s AND time < %s
                  AND tec_method LIKE '%%code_live%%'
                  AND elevation_deg >= {ELEVATION_MIN_DEG:g}
                  AND stec_tecu IS NOT NULL
                  AND stec_tecu BETWEEN -80 AND 500
                GROUP BY 1, 2, 3
                """,
                (start, end),
            )
            rows = cur.fetchall()
    finally:
        release(conn)
    if not rows:
        return pd.DataFrame(columns=["station", "timestamp", "prn", "stec", "elevation"])
    return pd.DataFrame(rows, columns=["station", "timestamp", "prn", "stec", "elevation"])


def _sigma_total(work: pd.DataFrame, bias: float) -> float:
    from tec_core import _mapping_function

    mapped = _mapping_function(work["elevation"], 350.0)
    vtec = (work["stec"].to_numpy(float) + bias) / mapped
    epochs = pd.to_datetime(work["timestamp"]).dt.floor("3min").to_numpy()
    spread = pd.DataFrame({"epoch": epochs, "vtec": vtec}).groupby("epoch")["vtec"].std(ddof=1)
    total = float(spread.sum(skipna=True))
    if total != total or total <= 0.0:
        return float("inf")
    return total


def _bias_for_station(frame: pd.DataFrame, dcb: tuple[dict[str, float], dict[str, float]] | None) -> tuple[float, int, int, str] | None:
    from tec_core import TecConfig, _NS_TO_TECU, _estimate_receiver_dcb

    work = frame.copy()
    if work.empty:
        return None
    work["prn"] = work["prn"].map(_prn_key)
    work["stec"] = work["stec"].astype(float)
    # Live code TEC uses the civilian L1 pseudorange, so the satellite correction
    # is the same as the RINEX path: subtract P1−C1, then add P1−P2.
    if dcb is not None:
        p1c1, p1p2 = dcb
        correction = (
            work["prn"].map(p1p2).fillna(0.0).astype(float)
            - work["prn"].map(p1c1).fillna(0.0).astype(float)
        )
        work["stec"] = work["stec"] + correction * _NS_TO_TECU
        method = "code_dcb_receiver_estimate"
    else:
        method = "receiver_sigma_min_no_satellite_dcb"
    counts = work.groupby("timestamp")["prn"].nunique()
    keep = counts[counts >= _MIN_SATELLITES].index
    work = work[work["timestamp"].isin(keep)]
    epochs = int(work["timestamp"].nunique())
    if epochs < _MIN_EPOCHS:
        return None
    try:
        bias = float(_estimate_receiver_dcb(work, TecConfig(ipp_height_km=350.0)))
    except Exception:
        log.warning("Receiver bias search failed", exc_info=True)
        return None
    if bias != bias:
        return None
    # A handful of epochs can put the minimum tens of TECU away from the
    # hardware bias. Keep the day only when shifting 15 TECU raises the cost.
    center = _sigma_total(work, bias)
    lower = _sigma_total(work, bias - 15.0)
    upper = _sigma_total(work, bias + 15.0)
    if not (center < 0.98 * lower and center < 0.98 * upper):
        return None
    return round(bias, 3), epochs, int(len(work)), method


def archive_receiver_bias(
    *,
    backfill_days: int = _BACKFILL_DAYS,
    days_per_run: int = _DAYS_PER_RUN,
    force: bool = False,
) -> dict:
    """Store today's bias for every station, and a few missing earlier days."""
    from zgiis.cors.stations import is_surveyor_general
    from zgiis.db.receiver_bias_db import delete_day, delete_station_day, stored_days, upsert_days

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=max(1, int(backfill_days)) - 1)
    known = stored_days(start, today)
    wanted = [today]
    cursor = today - timedelta(days=1)
    while cursor >= start and len(wanted) < 1 + max(1, int(days_per_run)):
        if cursor not in _settled_days:
            wanted.append(cursor)
        cursor -= timedelta(days=1)

    written = 0
    for day in wanted:
        provisional = day == today
        if provisional:
            delete_day(day)
        frame = _day_frame(day)
        if frame.empty:
            if not provisional:
                _settled_days.add(day)
            continue
        dcb = _satellite_dcb(day)
        rows = []
        now = datetime.now(timezone.utc)
        for station, group in frame.groupby("station"):
            code = str(station).lower().rstrip("_")
            if not code or is_surveyor_general(code):
                continue
            if not provisional and not force and (code, day) in known:
                continue
            estimated = _bias_for_station(group, dcb)
            if estimated is None:
                if provisional or force:
                    delete_station_day(code, day)
                continue
            bias, epochs, samples, method = estimated
            rows.append((code, day, bias, epochs, samples, method, now))
        written += upsert_days(rows)
        if not provisional:
            _settled_days.add(day)
    return {"stored_rows": written}


def series_for_chart(days: int = 120) -> dict:
    """Daily biases plus the period mean, standard deviation, and product bias."""
    from zgiis.db.receiver_bias_db import read_series

    today = datetime.now(timezone.utc).date().isoformat()
    stations = []
    for entry in read_series(days):
        points = entry["points"]
        values = [float(point["bias_tecu"]) for point in points]
        if not values:
            continue
        mean = sum(values) / len(values)
        if len(values) >= 2:
            variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
            std = variance ** 0.5
        else:
            std = None
        completed = [float(point["bias_tecu"]) for point in points if point["day"] < today]
        # The map product holds one bias for the period: the mean of the first
        # completed days, and that value stays fixed once seven days exist.
        if len(completed) >= 7:
            window = completed[:7]
        else:
            window = completed
        product = sum(window) / len(window) if window else None
        stations.append(
            {
                "station": entry["station"],
                "mean_bias_tecu": round(mean, 2),
                "std_bias_tecu": None if std is None else round(std, 2),
                "product_bias_tecu": None if product is None else round(product, 2),
                "points": points,
            }
        )
    return {
        "stations": stations,
        "note": (
            "Each point is the daily receiver bias from the elevation-weighted search "
            "that minimises the standard deviation of vertical TEC. The red line is the "
            "mean of the logged days. The dotted lines are one standard deviation from "
            "that mean. The green line is the bias held for the TEC map product, the mean "
            "of the first completed days. The current UTC day is updated as new code TEC arrives."
        ),
    }
