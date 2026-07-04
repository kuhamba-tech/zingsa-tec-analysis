"""Build merged space-weather timeline series for the operations dashboard."""
from __future__ import annotations

import datetime as dt

from backend.schemas import SpaceWeatherTimelines, TimelinePoint
from backend.timeline_cache import merge_timeline


def _archive_points(column: str, hours: float = 168.0, resample: str = "1h") -> list[TimelinePoint]:
    try:
        from backend.space_weather_logger import get_db

        df = get_db().query_dataframe(hours=hours, resample=resample)
        if df.empty or column not in df.columns:
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
            ts = t.isoformat() if hasattr(t, "isoformat") else str(t)
            out.append(TimelinePoint(t=ts, v=round(fv, 4)))
        return out
    except Exception:
        return []


def build_timelines(sw: dict) -> SpaceWeatherTimelines:
    from zgiis.space_weather.fetch_indices import _parse_kp_value

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
    gnss_archive = _archive_points("gnss_risk_score")
    gnss_risk = merge_timeline("gnss_risk", _prefer_richer(gnss_live, gnss_archive))

    stations_live = _pts_keyed(sw.get("stations_online_history"), "online")
    stations_archive = _archive_points("stations_online")
    stations_online = merge_timeline(
        "stations_online",
        _prefer_richer(stations_live, stations_archive),
    )

    mean_vtec = merge_timeline("mean_vtec", _archive_points("mean_vtec"))

    return SpaceWeatherTimelines(
        kp=kp,
        dst=dst,
        f107=f107,
        solar_wind=solar_wind,
        s4=s4,
        gnss_risk=gnss_risk,
        stations_online=stations_online,
        mean_vtec=mean_vtec,
    )
