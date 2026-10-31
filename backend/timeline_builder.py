"""Build merged space-weather timeline series for the operations dashboard."""
from __future__ import annotations

import datetime as dt
import math
import threading

from backend.schemas import SpaceWeatherTimelines, TimelinePoint
from backend.timeline_cache import merge_timeline


def _point_utc(point: TimelinePoint) -> dt.datetime | None:
    raw = str(point.t or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    elif "+" not in raw[10:]:
        raw = raw + "+00:00"
    try:
        when = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    return when.astimezone(dt.timezone.utc)


def _even_sample(points: list[TimelinePoint], max_points: int) -> list[TimelinePoint]:
    if max_points <= 0 or not points:
        return []
    if len(points) <= max_points:
        return points
    if max_points == 1:
        return [points[-1]]
    last_index = len(points) - 1
    indices = {
        round(position * last_index / (max_points - 1))
        for position in range(max_points)
    }
    return [points[index] for index in sorted(indices)]


def limit_timeline_points(
    points: list[TimelinePoint],
    max_points: int = 336,
) -> list[TimelinePoint]:
    """Downsample older history. Keep one logged sample for every recent UTC hour.

    A 96-point cap across several days was dropping 01:00–03:00 and the
    scintillation chart then showed time only at the start of the window.
    """
    if max_points <= 0 or len(points) <= max_points:
        return points
    if max_points == 1:
        return [points[-1]]
    recent_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=48)
    hourly: dict[str, TimelinePoint] = {}
    older: list[TimelinePoint] = []
    for point in points:
        when = _point_utc(point)
        if when is not None and when >= recent_start:
            hourly[when.strftime("%Y-%m-%dT%H")] = point
        else:
            older.append(point)
    recent = [hourly[key] for key in sorted(hourly)]
    if not recent:
        return _even_sample(points, max_points)
    budget = max_points - len(recent)
    if budget <= 0:
        return recent
    return _even_sample(older, budget) + recent


def limit_timelines(
    timelines: SpaceWeatherTimelines,
    max_points: int = 336,
) -> SpaceWeatherTimelines:
    return SpaceWeatherTimelines(
        **{
            field: limit_timeline_points(getattr(timelines, field), max_points)
            for field in SpaceWeatherTimelines.model_fields
        }
    )


def _archive_frame(hours: float = 168.0, resample: str = "1h"):
    """Read the logged archive on its own short connection.

    The shared pool is often busy with station charts. Waiting for a pooled
    connection makes this route sit silent until the browser gives up and the
    ionosphere panel reports a failed timeline feed.
    """
    try:
        import pandas as pd
        import psycopg2

        from zgiis.db.config import database_dsn
        from zgiis.db.space_weather_db import _finalize_log_frame

        dsn = database_dsn()
        if not dsn:
            return None
        since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat()
        conn = psycopg2.connect(dsn, connect_timeout=4)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SET statement_timeout = '8000'")
            frame = pd.read_sql(
                """
                SELECT date_trunc('hour', time) AS time,
                       AVG(kp) AS kp,
                       MAX(kp_condition) AS kp_condition,
                       AVG(dst) AS dst,
                       AVG(f107) AS f107,
                       AVG(plasma_speed) AS plasma_speed,
                       AVG(s4) AS s4,
                       MAX(gnss_risk) AS gnss_risk,
                       AVG(gnss_risk_score) AS gnss_risk_score,
                       AVG(stations_online) AS stations_online,
                       MAX(stations_total) AS stations_total,
                       AVG(mean_vtec) AS mean_vtec
                FROM space_weather_log
                WHERE time >= %s
                GROUP BY 1
                ORDER BY 1
                """,
                conn,
                params=[since],
            )
        finally:
            conn.close()
        return _finalize_log_frame(frame, resample)
    except Exception:
        return None


def _zingsa_online_cap() -> int:
    """ZINGSA CORS network size. Surveyor General sites are not in this count."""
    try:
        from zgiis.cors.stations import zingsa_cors_stations

        count = len(zingsa_cors_stations())
    except Exception:
        count = 19
    return count if count > 0 else 19


def _within_zingsa_network(points: list[TimelinePoint]) -> list[TimelinePoint]:
    """Keep measured ZINGSA online counts.

    Counts above 19 include Surveyor General sites. Fractional values are
    averages of a real count with the catalog size (the false peak near 18).
    A stored 0 or 1 is an empty counter during restart.
    """
    cap = _zingsa_online_cap()
    kept: list[TimelinePoint] = []
    for point in points:
        if point.v is None:
            continue
        try:
            value = float(point.v)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value) or value < 2 or value > cap:
            continue
        nearest = round(value)
        half = math.floor(value) + 0.5
        if abs(value - nearest) > 0.001 and abs(value - half) > 0.001:
            continue
        kept.append(point)
    return kept


def _gic_points() -> list[TimelinePoint]:
    """GIC is optional on this route. A busy pool must not hold the response."""
    holder: dict[str, list[tuple[str, float]]] = {}

    def run() -> None:
        try:
            from zgiis.gic.timeline import load_gic_timeline

            _, raw = load_gic_timeline(hours=168.0, resample="1h")
            holder["rows"] = list(raw or [])
        except Exception:
            holder["rows"] = []

    worker = threading.Thread(target=run, name="timeline-gic", daemon=True)
    worker.start()
    worker.join(4)
    return [TimelinePoint(t=t, v=v) for t, v in holder.get("rows", [])]


def _archive_points(column: str, df) -> list[TimelinePoint]:
    try:
        if df is None or df.empty or column not in df.columns:
            return []
        out: list[TimelinePoint] = []
        for _, r in df.iterrows():
            t = r["time"]
            v = r.get(column)
            if v is None:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(fv):
                continue
            ts = t.isoformat() if hasattr(t, "isoformat") else str(t)
            out.append(TimelinePoint(t=ts, v=round(fv, 4)))
        return out
    except Exception:
        return []


def build_timelines(sw: dict) -> SpaceWeatherTimelines:
    from zgiis.space_weather.fetch_indices import _parse_kp_value

    # All archive series share the same window: read it once, not once per chart.
    archive = _archive_frame()

    def _pts_keyed(raw: list | None, value_key: str) -> list[TimelinePoint]:
        if not raw:
            return []
        out = []
        for p in raw:
            if not isinstance(p, dict) or not p.get("time_tag"):
                continue
            v = p.get(value_key)
            try:
                v = float(v) if v is not None else None
            except (TypeError, ValueError):
                v = None
            out.append(TimelinePoint(t=str(p["time_tag"]), v=v))
        return out

    def _pts_kp(raw: list | None) -> list[TimelinePoint]:
        if not raw:
            return []
        out = []
        for p in raw:
            if not isinstance(p, dict) or not p.get("time_tag"):
                continue
            v = _parse_kp_value(p)
            out.append(TimelinePoint(t=str(p["time_tag"]), v=v))
        return out

    def _single_current_point(value: object, timestamp: object) -> list[TimelinePoint]:
        if value is None:
            return []
        try:
            v = float(value)
        except (TypeError, ValueError):
            return []
        t = str(timestamp or dt.datetime.utcnow().replace(microsecond=0).isoformat())
        return [TimelinePoint(t=t, v=v)]

    def _use_live_series_or_current_snapshot(
        raw: list | None,
        value_key: str,
        current_value: object,
        timestamp: object,
    ) -> list[TimelinePoint]:
        points = _pts_keyed(raw, value_key)
        values = {point.v for point in points if point.v is not None}
        if len(points) > 1 and len(values) > 1:
            return points
        return _single_current_point(current_value, timestamp)

    def _prefer_richer(live: list[TimelinePoint], archive: list[TimelinePoint]) -> list[TimelinePoint]:
        live_vals = {p.v for p in live if p.v is not None}
        if len(live) > 1 and len(live_vals) > 1:
            return live
        return archive if archive else live

    kp = merge_timeline("kp", _pts_kp(sw.get("kp_history")))
    dst = merge_timeline("dst", _pts_keyed(sw.get("dst_history"), "dst"))
    f107 = merge_timeline("f107", _pts_keyed(sw.get("f107_history"), "flux"))
    solar_wind = merge_timeline(
        "solar_wind",
        _pts_keyed(sw.get("solar_wind_history"), "speed"),
    )
    s4 = merge_timeline(
        "s4",
        _use_live_series_or_current_snapshot(
            sw.get("s4_history"),
            "s4",
            sw.get("s4"),
            sw.get("updated_utc") or sw.get("timestamp"),
        ),
    )

    gnss_live = _pts_keyed(sw.get("gnss_risk_history"), "risk_score")
    gnss_archive = _archive_points("gnss_risk_score", archive)
    gnss_risk = merge_timeline("gnss_risk", _prefer_richer(gnss_live, gnss_archive))

    stations_live = _within_zingsa_network(
        _pts_keyed(sw.get("stations_online_history"), "online")
    )
    stations_archive = _within_zingsa_network(_archive_points("stations_online", archive))
    stations_online = _within_zingsa_network(
        merge_timeline(
            "stations_online",
            _prefer_richer(stations_live, stations_archive),
        )
    )

    mean_vtec = merge_timeline("mean_vtec", _archive_points("mean_vtec", archive))

    gic_pts = _gic_points()
    gic = merge_timeline("gic", gic_pts)

    return SpaceWeatherTimelines(
        kp=kp,
        dst=dst,
        f107=f107,
        solar_wind=solar_wind,
        s4=s4,
        gnss_risk=gnss_risk,
        stations_online=stations_online,
        mean_vtec=mean_vtec,
        gic=gic,
    )
