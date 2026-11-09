"""Daily day–night TEC from measured GOPI observations.

Satellites are averaged inside each station-hour. Stations then contribute
equally. Hours with no measurement stay empty. Map interpolation, the Gg
calibration and the DLR reference grid are not measurements and never fill
a gap. The 0–50 TECU chart cap is not applied; ingest already rejects
values outside (0, 200).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

log = logging.getLogger(__name__)

from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG
from zgiis.processing.measured_tec import (
    GOPI_CODE_LIVE_METHOD,
    is_measured_gopi,
    measured_gopi_clause,
)
from zgiis.processing.north_south_tec_research import zimbabwe_lat_band

CAT = timezone(timedelta(hours=2))
DAY_HOURS = tuple(range(6, 18))
NIGHT_AXIS = (18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5)
CIVIL_NIGHT_HOURS = (0, 1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 23)
REGIONS = ("network", "northern", "central", "southern")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _catalog(catalog: Iterable[Any] | None) -> dict[str, float]:
    if catalog is None:
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        catalog = ZIMBABWE_CORS_STATIONS
    out: dict[str, float] = {}
    for station in catalog:
        code = str(getattr(station, "code", "")).lower().rstrip("_")
        lat = getattr(station, "lat", None)
        if code and lat is not None:
            out[code] = float(lat)
    return out


def _mean(values: list[float | None]) -> float | None:
    nums = [float(value) for value in values if value is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 2)


def _station_hours(frame: pd.DataFrame, stations: dict[str, float]) -> pd.DataFrame:
    columns = ["station", "local_date", "local_hour", "vtec", "observations", "above_50"]
    if frame is None or frame.empty:
        return pd.DataFrame(columns=columns)
    work = frame.copy()
    if "tec_method" in work.columns:
        if "data_source" in work.columns:
            source = work["data_source"]
        else:
            source = pd.Series([""] * len(work), index=work.index)
        keep = [
            is_measured_gopi(method, origin)
            for method, origin in zip(work["tec_method"], source, strict=True)
        ]
        work = work.loc[pd.Series(keep, index=work.index)].copy()
    if work.empty or "vtec" not in work.columns or "station" not in work.columns or "time" not in work.columns:
        return pd.DataFrame(columns=columns)
    work["vtec"] = pd.to_numeric(work["vtec"], errors="coerce")
    work = work[work["vtec"].gt(0) & work["vtec"].lt(200)]
    if "elevation_deg" in work.columns:
        elev = pd.to_numeric(work["elevation_deg"], errors="coerce")
        work = work[elev.ge(ELEVATION_MIN_DEG)]
    if work.empty:
        return pd.DataFrame(columns=columns)
    work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
    work = work[work["station"].isin(stations)]
    if work.empty:
        return pd.DataFrame(columns=columns)
    work["time"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
    work = work.dropna(subset=["time", "vtec"])
    work["hour_utc"] = work["time"].dt.floor("h")
    if "observations" not in work.columns:
        work["observations"] = 1
    else:
        work["observations"] = pd.to_numeric(work["observations"], errors="coerce").fillna(1)
    if "above_50" not in work.columns:
        work["above_50"] = (work["vtec"] > 50).astype(int)
    else:
        work["above_50"] = pd.to_numeric(work["above_50"], errors="coerce").fillna(0)
    grouped = (
        work.groupby(["station", "hour_utc"], as_index=False)
        .agg(vtec=("vtec", "mean"), observations=("observations", "sum"), above_50=("above_50", "sum"))
    )
    local = grouped["hour_utc"] + pd.Timedelta(hours=2)
    grouped["local_date"] = local.dt.date
    grouped["local_hour"] = local.dt.hour.astype(int)
    return grouped[columns]


def _index(hours: pd.DataFrame) -> dict[tuple[str, Any, int], Any]:
    return {
        (str(row.station), row.local_date, int(row.local_hour)): row
        for row in hours.itertuples(index=False)
    }


def load_station_hours(db, start: datetime, end: datetime) -> pd.DataFrame:
    """Station-hour means of measured GOPI code TEC. Empty when the database is down."""
    if db is None:
        return pd.DataFrame()
    marker = "%s" if getattr(db, "_is_pg", True) else "?"
    clause, params = measured_gopi_clause(marker, elevation=True)
    hour = "date_trunc('hour', time)" if getattr(db, "_is_pg", True) else "datetime((strftime('%s', time) / 3600) * 3600, 'unixepoch')"
    sql = f"""
        SELECT LOWER(RTRIM(station, '_')) AS station,
               {hour} AS time,
               AVG(vtec_tecu) AS vtec,
               COUNT(*) AS observations,
               SUM(CASE WHEN vtec_tecu > 50 THEN 1 ELSE 0 END) AS above_50
        FROM vtec_obs
        WHERE time >= {marker} AND time < {marker}
          AND {clause}
        GROUP BY 1, 2
    """
    return db._read_sql(sql, [start.isoformat(), end.isoformat(), *params])


def build_from_frame(
    frame: pd.DataFrame,
    *,
    now: datetime,
    catalog: Iterable[Any] | None = None,
) -> dict[str, Any]:
    now = _utc(now)
    today = now.astimezone(CAT).date()
    yesterday = today - timedelta(days=1)
    prior = today - timedelta(days=2)
    week = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    stations = _catalog(catalog)
    hours = _station_hours(frame, stations)
    found = _index(hours)

    def cell(day, hour: int, region: str) -> float | None:
        samples: list[float] = []
        for code, lat in stations.items():
            if region != "network" and zimbabwe_lat_band(lat) != region:
                continue
            row = found.get((code, day, hour))
            if row is None:
                continue
            samples.append(float(row.vtec))
        return _mean(samples)

    def profile(day, region: str) -> list[float | None]:
        return [cell(day, hour, region) for hour in range(24)]

    def daytime(day, region: str) -> list[float | None]:
        return [cell(day, hour, region) for hour in DAY_HOURS]

    def spanning_night(evening, region: str) -> list[float | None]:
        morning = evening + timedelta(days=1)
        points: list[float | None] = []
        for hour in NIGHT_AXIS:
            points.append(cell(evening if hour >= 18 else morning, hour, region))
        return points

    def comparison(day, region: str) -> dict[str, Any]:
        day_points = daytime(day, region)
        night_points = [cell(day, hour, region) for hour in CIVIL_NIGHT_HOURS]
        return {
            "date": day.isoformat(),
            "region": region,
            "day_mean": _mean(day_points),
            "night_mean": _mean(night_points),
            "day_hours": sum(point is not None for point in day_points),
            "night_hours": sum(point is not None for point in night_points),
        }

    coverage_stations = sorted(set(hours["station"])) if not hours.empty else []
    payload = {
        "available": bool(not hours.empty),
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "today": today.isoformat(),
        "yesterday": yesterday.isoformat(),
        "clock": "CAT",
        "clock_offset_hours": 2,
        "day_hours": "06:00–18:00 CAT",
        "night_hours": "18:00–06:00 CAT",
        "source": f"vtec_obs {GOPI_CODE_LIVE_METHOD}",
        "excluded": [
            "Gg calibration",
            "DLR global TEC reference",
            "spatial interpolation and modelled fills",
            "unleveled carrier-phase TEC",
            "VTEC outside (0, 200) TECU",
            f"elevation below {ELEVATION_MIN_DEG:g}°",
        ],
        "vtec_rule": "0 < VTEC < 200 TECU. Values above 50 TECU are kept.",
        "elevation_min_deg": ELEVATION_MIN_DEG,
        "regions": {
            "northern": "latitude > -18.2°",
            "central": "-20.2° < latitude ≤ -18.2°",
            "southern": "latitude ≤ -20.2°",
        },
        "weighting": (
            "Satellites are averaged inside each station-hour. "
            "Each station with a measurement then has equal weight. "
            "A missing hour stays blank."
        ),
        "labels_24h": [f"{hour:02d}" for hour in range(24)],
        "labels_day": [f"{hour:02d}" for hour in DAY_HOURS],
        "labels_night": [f"{hour:02d}" for hour in NIGHT_AXIS],
        "profile_24h": {region: profile(today, region) for region in REGIONS},
        "daytime": {
            "yesterday": {region: daytime(yesterday, region) for region in REGIONS},
            "today": {region: daytime(today, region) for region in REGIONS},
        },
        "nighttime": {
            "previous_night": {
                "evening_date": prior.isoformat(),
                "morning_date": yesterday.isoformat(),
                "series": {region: spanning_night(prior, region) for region in REGIONS},
            },
            "last_night": {
                "evening_date": yesterday.isoformat(),
                "morning_date": today.isoformat(),
                "series": {region: spanning_night(yesterday, region) for region in REGIONS},
            },
        },
        "seven_day": [
            {
                "date": day.isoformat(),
                **{region: profile(day, region) for region in REGIONS},
            }
            for day in week
        ],
        "regional_comparison": [
            comparison(day, region)
            for day in week
            for region in ("northern", "central", "southern", "network")
        ],
        "coverage": {
            "stations": coverage_stations,
            "station_count": len(coverage_stations),
            "observations": int(hours["observations"].sum()) if not hours.empty else 0,
            "observations_above_50": int(hours["above_50"].sum()) if not hours.empty else 0,
            "first": hours["local_date"].min().isoformat() if not hours.empty else None,
            "last": hours["local_date"].max().isoformat() if not hours.empty else None,
        },
    }
    if not payload["available"]:
        payload["message"] = "No measured GOPI observations in this window."
    return payload


def build_day_night(db, *, now: datetime | None = None) -> dict[str, Any]:
    now = _utc(now or datetime.now(timezone.utc))
    # Eight civil days cover the seven-day overlay and the night before it.
    start = datetime.combine(now.astimezone(CAT).date() - timedelta(days=8), datetime.min.time(), CAT)
    try:
        frame = load_station_hours(db, start.astimezone(timezone.utc), now + timedelta(minutes=5))
    except Exception as exc:
        log.warning("day-night TEC read failed: %s", exc)
        frame = pd.DataFrame()
    return build_from_frame(frame, now=now)
