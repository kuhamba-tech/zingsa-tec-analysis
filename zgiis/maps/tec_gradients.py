"""ICAO TEC spatial and temporal gradient maps.

Spatial gradient is the Scharr operator on the 1° median-filtered TEC grid
(Matamba and Danskin, 2022; Scharr, 2000). The complex 3×3 kernel is

    -3-3i   -10i    3-3i
    -10       0      10
    -3+3i    10i    3+3i

divided by 32, so a change of 1 TECU per degree on this grid has magnitude 1.
The map shows that magnitude in TECU/deg.

Temporal gradient splits the same 15-minute window in half. It is the second
map minus the first, divided by half the window (7.5 min), in TECU/min.

Every 1° cell that meets the Zimbabwe outline is coloured. An empty cell
inside the country takes the nearest measured bin before the median filter
and the Scharr gradient. Cells outside the outline stay empty. The temporal
map uses that same country fill when both halves of the window have pierce
points. Empty inputs stay empty.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from zgiis.maps.zimbabwe_land import cell_intersects_zimbabwe
from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG

log = logging.getLogger(__name__)

WINDOW_MINUTES = 15.0
GRID_DEG = 1.0
MEDIAN_SIZE = 7
MIN_IPPS = 8
_CACHE_S = 90.0
_FAIL_CACHE_S = 30.0
_LAT_LIMIT = (-40.0, 5.0)
_LON_LIMIT = (10.0, 50.0)

# Real part is eastward, imaginary part is northward, then /32.
_SCHARR_EAST = np.array(
    [[-3.0, 0.0, 3.0], [-10.0, 0.0, 10.0], [-3.0, 0.0, 3.0]],
    dtype=float,
) / 32.0
_SCHARR_NORTH = np.array(
    [[-3.0, -10.0, -3.0], [0.0, 0.0, 0.0], [3.0, 10.0, 3.0]],
    dtype=float,
) / 32.0

_cache_lock = threading.Lock()
_cache: tuple[float, dict[str, Any]] | None = None


def scharr_components(grid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """East and north derivatives in TECU per grid step. Incomplete 3×3 stays empty."""
    values = np.asarray(grid, dtype=float)
    east = np.full(values.shape, np.nan)
    north = np.full(values.shape, np.nan)
    rows, cols = values.shape
    for i in range(1, rows - 1):
        for j in range(1, cols - 1):
            window = values[i - 1 : i + 2, j - 1 : j + 2]
            if not np.isfinite(window).all():
                continue
            east[i, j] = float(np.sum(window * _SCHARR_EAST))
            north[i, j] = float(np.sum(window * _SCHARR_NORTH))
    return east, north


def scharr_magnitude(grid: np.ndarray) -> np.ndarray:
    east, north = scharr_components(grid)
    return np.hypot(east, north)


def _median_filter(grid: np.ndarray, size: int = MEDIAN_SIZE) -> np.ndarray:
    pad = size // 2
    padded = np.pad(grid, pad, mode="edge")
    out = np.empty_like(grid, dtype=float)
    rows, cols = grid.shape
    for i in range(rows):
        window = padded[i : i + size]
        for j in range(cols):
            out[i, j] = float(np.median(window[:, j : j + size]))
    return out


def _nearest_fill(grid: np.ndarray) -> np.ndarray:
    finite = np.argwhere(np.isfinite(grid))
    if finite.size == 0:
        return grid
    missing = np.argwhere(~np.isfinite(grid))
    if missing.size == 0:
        return grid
    out = grid.copy()
    for i, j in missing:
        nearest = int(np.argmin((finite[:, 0] - i) ** 2 + (finite[:, 1] - j) ** 2))
        out[i, j] = grid[finite[nearest, 0], finite[nearest, 1]]
    return out


def _bounds(lat: np.ndarray, lon: np.ndarray) -> tuple[int, int, int, int] | None:
    lat_bin = np.floor(lat).astype(int)
    lon_bin = np.floor(lon).astype(int)
    lat0, lat1 = int(lat_bin.min()), int(lat_bin.max())
    lon0, lon1 = int(lon_bin.min()), int(lon_bin.max())
    if lat1 - lat0 + 1 > 40 or lon1 - lon0 + 1 > 40:
        return None
    if lat1 - lat0 < 2 or lon1 - lon0 < 2:
        return None
    return lat0, lat1, lon0, lon1


def _bin_median(
    lat: np.ndarray,
    lon: np.ndarray,
    tec: np.ndarray,
    bounds: tuple[int, int, int, int],
) -> tuple[np.ndarray, np.ndarray]:
    lat0, lat1, lon0, lon1 = bounds
    nlat = lat1 - lat0 + 1
    nlon = lon1 - lon0 + 1
    buckets: list[list[list[float]]] = [[[] for _ in range(nlon)] for _ in range(nlat)]
    lat_bin = np.floor(lat).astype(int)
    lon_bin = np.floor(lon).astype(int)
    for lat_i, lon_i, value in zip(lat_bin, lon_bin, tec):
        row = int(lat_i) - lat0
        col = int(lon_i) - lon0
        if 0 <= row < nlat and 0 <= col < nlon:
            buckets[row][col].append(float(value))
    grid = np.full((nlat, nlon), np.nan)
    occupied = np.zeros((nlat, nlon), dtype=bool)
    for i in range(nlat):
        for j in range(nlon):
            if buckets[i][j]:
                grid[i, j] = float(np.median(buckets[i][j]))
                occupied[i, j] = True
    return grid, occupied


def _zimbabwe_cells(shape: tuple[int, int], bounds: tuple[int, int, int, int]) -> np.ndarray:
    """Cells whose 1° square meets the Zimbabwe outline."""
    lat0, _, lon0, _ = bounds
    mask = np.zeros(shape, dtype=bool)
    nlat, nlon = shape
    for i in range(nlat):
        for j in range(nlon):
            mask[i, j] = cell_intersects_zimbabwe(float(lat0 + i), float(lon0 + j), GRID_DEG)
    return mask


def _country_bounds() -> tuple[int, int, int, int]:
    """Integer 1° cells that meet the Zimbabwe outline."""
    lats: list[int] = []
    lons: list[int] = []
    for lat in range(-23, -14):
        for lon in range(25, 34):
            if cell_intersects_zimbabwe(float(lat), float(lon), GRID_DEG):
                lats.append(lat)
                lons.append(lon)
    return min(lats), max(lats), min(lons), max(lons)


def _union_bounds(
    measured: tuple[int, int, int, int],
    country: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    """Cover the pierce-point bins and the country, without an unbounded grid."""
    lat0 = min(measured[0], country[0])
    lat1 = max(measured[1], country[1])
    lon0 = min(measured[2], country[2])
    lon1 = max(measured[3], country[3])
    if lat1 - lat0 + 1 > 40 or lon1 - lon0 + 1 > 40:
        return measured
    return lat0, lat1, lon0, lon1


def _scharr_filled(grid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Scharr on the filled grid, including the outer cells of that grid."""
    padded = np.pad(grid, 1, mode="edge")
    east, north = scharr_components(padded)
    return east[1:-1, 1:-1], north[1:-1, 1:-1]


def _filtered(lat, lon, tec, bounds: tuple[int, int, int, int]) -> tuple[np.ndarray, np.ndarray]:
    grid, occupied = _bin_median(lat, lon, tec, bounds)
    if not occupied.any():
        return grid, occupied
    return _median_filter(_nearest_fill(grid)), occupied


def _json_grid(values: np.ndarray, keep: np.ndarray) -> list[list[float | None]]:
    rows: list[list[float | None]] = []
    for i in range(values.shape[0]):
        row: list[float | None] = []
        for j in range(values.shape[1]):
            value = float(values[i, j])
            if not keep[i, j] or not np.isfinite(value):
                row.append(None)
            else:
                row.append(round(value, 4))
        rows.append(row)
    return rows


def _finite_stats(grid: list[list[float | None]]) -> tuple[float | None, float | None, float | None]:
    values = [cell for row in grid for cell in row if cell is not None]
    if not values:
        return None, None, None
    return round(max(values), 4), round(min(values), 4), round(sum(values) / len(values), 4)


def gradient_maps_from_pierce_points(
    points: list[tuple[datetime, float, float, float]],
    *,
    now: datetime | None = None,
    window_minutes: float = WINDOW_MINUTES,
) -> dict[str, Any]:
    """Build one spatial map and one temporal map from pierce-point TEC."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    else:
        moment = moment.astimezone(timezone.utc)
    window = timedelta(minutes=window_minutes)
    half = window / 2
    start = moment - window
    mid = moment - half
    kept = []
    for stamp, lat, lon, tec in points:
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        else:
            stamp = stamp.astimezone(timezone.utc)
        if start < stamp <= moment and _screen(lat, lon, tec):
            kept.append((stamp, lat, lon, tec))
    empty = _empty_payload(moment, window_minutes, "Fewer than 8 pierce points in the 15-minute window.")
    if len(kept) < MIN_IPPS:
        return empty

    lat = np.array([item[1] for item in kept], dtype=float)
    lon = np.array([item[2] for item in kept], dtype=float)
    tec = np.array([item[3] for item in kept], dtype=float)
    ipp_bounds = _bounds(lat, lon)
    if ipp_bounds is None:
        return _empty_payload(moment, window_minutes, "Pierce points do not cover a 3 by 3 degree grid.")
    bounds = _union_bounds(ipp_bounds, _country_bounds())

    full, _occupied = _filtered(lat, lon, tec, bounds)
    inside = _zimbabwe_cells(full.shape, bounds)
    east, north = _scharr_filled(full)
    east = np.where(inside, east, np.nan)
    north = np.where(inside, north, np.nan)
    spatial = _json_grid(np.hypot(east, north), inside)
    spatial_max, _, spatial_mean = _finite_stats(spatial)
    east_abs = np.abs(east)
    north_abs = np.abs(north)
    east_max = float(np.nanmax(east_abs)) if np.isfinite(east_abs).any() else None
    north_max = float(np.nanmax(north_abs)) if np.isfinite(north_abs).any() else None

    first = [item for item in kept if item[0] <= mid]
    second = [item for item in kept if item[0] > mid]
    temporal: list[list[float | None]] | None = None
    temporal_note = "Both halves of the window need pierce points."
    if len(first) >= MIN_IPPS and len(second) >= MIN_IPPS:
        first_lat = np.array([item[1] for item in first])
        first_lon = np.array([item[2] for item in first])
        first_tec = np.array([item[3] for item in first])
        second_lat = np.array([item[1] for item in second])
        second_lon = np.array([item[2] for item in second])
        second_tec = np.array([item[3] for item in second])
        map_first, _occ_first = _filtered(first_lat, first_lon, first_tec, bounds)
        map_second, _occ_second = _filtered(second_lat, second_lon, second_tec, bounds)
        rate = (map_second - map_first) / (window_minutes / 2.0)
        both = inside & np.isfinite(map_first) & np.isfinite(map_second)
        temporal = _json_grid(rate, both)
        if not any(cell is not None for row in temporal for cell in row):
            temporal = None
            temporal_note = "The two half-window maps do not overlap on measured cells."
        else:
            temporal_note = ""

    temporal_max, temporal_min, temporal_mean = _finite_stats(temporal or [])
    lat0, lat1, lon0, lon1 = bounds
    return {
        "available": spatial_max is not None,
        "generated_at": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_minutes": window_minutes,
        "half_minutes": window_minutes / 2.0,
        "grid_step_deg": GRID_DEG,
        "median_filter_size": MEDIAN_SIZE,
        "lat0": lat0,
        "lon0": lon0,
        "lat1": lat1,
        "lon1": lon1,
        "ipp_count": len(kept),
        "ipp_count_first_half": len(first),
        "ipp_count_second_half": len(second),
        "spatial": spatial if spatial_max is not None else None,
        "temporal": temporal,
        "spatial_max_tecu_per_deg": spatial_max,
        "spatial_mean_tecu_per_deg": spatial_mean,
        "spatial_east_max_tecu_per_deg": round(east_max, 4) if east_max is not None else None,
        "spatial_north_max_tecu_per_deg": round(north_max, 4) if north_max is not None else None,
        "temporal_max_tecu_per_min": temporal_max,
        "temporal_min_tecu_per_min": temporal_min,
        "temporal_mean_tecu_per_min": temporal_mean,
        "temporal_available": temporal is not None,
        "message": "" if spatial_max is not None else "Scharr gradient is empty on the measured cells.",
        "temporal_message": temporal_note,
        "method": (
            "Scharr spatial gradient (TECU/deg) on the 1° nearest-neighbour, "
            "size-7 median-filtered grid. Every cell that meets the Zimbabwe "
            "outline is coloured from the nearest measured bin. "
            "Temporal gradient is the second half of the 15-minute window minus the "
            "first, divided by 7.5 minutes (TECU/min), on that same country fill."
        ),
    }


def _empty_payload(moment: datetime, window_minutes: float, message: str) -> dict[str, Any]:
    start = moment - timedelta(minutes=window_minutes)
    return {
        "available": False,
        "generated_at": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_minutes": window_minutes,
        "half_minutes": window_minutes / 2.0,
        "grid_step_deg": GRID_DEG,
        "median_filter_size": MEDIAN_SIZE,
        "lat0": None,
        "lon0": None,
        "lat1": None,
        "lon1": None,
        "ipp_count": 0,
        "ipp_count_first_half": 0,
        "ipp_count_second_half": 0,
        "spatial": None,
        "temporal": None,
        "spatial_max_tecu_per_deg": None,
        "spatial_mean_tecu_per_deg": None,
        "spatial_east_max_tecu_per_deg": None,
        "spatial_north_max_tecu_per_deg": None,
        "temporal_max_tecu_per_min": None,
        "temporal_min_tecu_per_min": None,
        "temporal_mean_tecu_per_min": None,
        "temporal_available": False,
        "message": message,
        "temporal_message": message,
        "method": (
            "Scharr spatial gradient (TECU/deg) on the 1° nearest-neighbour, "
            "size-7 median-filtered grid. Every cell that meets the Zimbabwe "
            "outline is coloured from the nearest measured bin. "
            "Temporal gradient is the second half of the 15-minute window minus the "
            "first, divided by 7.5 minutes (TECU/min), on that same country fill."
        ),
    }


def _screen(lat: float, lon: float, tec: float) -> bool:
    return (
        np.isfinite(lat)
        and np.isfinite(lon)
        and np.isfinite(tec)
        and 0.0 <= tec <= 50.0
        and _LAT_LIMIT[0] <= lat <= _LAT_LIMIT[1]
        and _LON_LIMIT[0] <= lon <= _LON_LIMIT[1]
    )


def _cached_placed(now: datetime) -> list[tuple[datetime, float, float, float]]:
    """Pierce points already placed for the RMSE maps, if this process has them."""
    try:
        from zgiis.space_weather.iono_response_figures import _placed, _state_lock
    except Exception:
        return []
    start = now - timedelta(minutes=WINDOW_MINUTES)
    with _state_lock:
        today = list(_placed.get(now.date().isoformat(), []))
        yesterday = list(_placed.get((now.date() - timedelta(days=1)).isoformat(), []))
    return [
        item
        for item in yesterday + today
        if start < item[0] <= now and _screen(item[1], item[2], item[3])
    ]


def _query_rows(now: datetime) -> list[tuple]:
    import psycopg2

    from zgiis.cors.stations import is_surveyor_general
    from zgiis.db.config import pooled_database_dsn

    dsn = pooled_database_dsn()
    if not dsn:
        return []
    since = (now - timedelta(minutes=WINDOW_MINUTES + 1)).isoformat()
    conn = None
    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15000'")
            cur.execute(
                f"""
                SELECT date_trunc('minute', time) AT TIME ZONE 'UTC' AS minute,
                       LOWER(RTRIM(station, '_')) AS station,
                       prn,
                       AVG(vtec_tecu) AS vtec_tecu,
                       AVG(elevation_deg) AS elevation_deg
                FROM vtec_obs
                WHERE time >= %s
                  AND vtec_tecu >= 0
                  AND vtec_tecu <= 50
                  AND elevation_deg >= {ELEVATION_MIN_DEG:g}
                  AND tec_method LIKE %s
                  AND tec_method NOT LIKE 'dlr_%%'
                GROUP BY 1, 2, 3
                """,
                (since, "%code_live%"),
            )
            fetched = cur.fetchall()
    except Exception as exc:
        message = str(exc).splitlines()[0]
        if "://" in message or "@" in message:
            message = type(exc).__name__
        log.warning("TEC gradient read failed: %s", message[:240])
        raise RuntimeError("The TEC database could not be reached. Please retry shortly.") from exc
    finally:
        if conn is not None:
            conn.close()

    rows: list[tuple] = []
    for minute, station, prn, tec, elev in fetched:
        code = str(station or "").lower().rstrip("_")
        if not code or is_surveyor_general(code):
            continue
        if minute is None:
            continue
        stamp = minute if getattr(minute, "tzinfo", None) else minute.replace(tzinfo=timezone.utc)
        try:
            rows.append((stamp, code, prn, float(tec), float(elev)))
        except (TypeError, ValueError):
            continue
    return rows


def _place(rows: list[tuple]) -> list[tuple[datetime, float, float, float]] | None:
    from zgiis.space_weather.iono_response_figures import _place_rows

    grouped: dict[Any, list[tuple]] = {}
    for stamp, station, prn, tec, elev in rows:
        grouped.setdefault(stamp.date(), []).append((stamp, station, prn, tec, elev))
    placed: list[tuple[datetime, float, float, float]] = []
    for day, day_rows in grouped.items():
        result = _place_rows(day_rows, day)
        if result is None:
            return None
        placed.extend(item for item in result if _screen(item[1], item[2], item[3]))
    return placed


def _build_tec_gradient_maps(*, now: datetime | None = None) -> dict[str, Any]:
    """Current 15-minute gradient maps. Cached for 90 seconds."""
    global _cache
    moment = now or datetime.now(timezone.utc)
    with _cache_lock:
        if _cache is not None and (time.time() - _cache[0]) < (_CACHE_S if _cache[1].get("available") else _FAIL_CACHE_S):
            return _cache[1]

    points = _cached_placed(moment)
    if len(points) < MIN_IPPS:
        rows = _query_rows(moment)
        if not rows:
            payload = _empty_payload(moment, WINDOW_MINUTES, "No code TEC with elevation in the last 15 minutes.")
        else:
            placed = _place(rows)
            if placed is None:
                payload = _empty_payload(
                    moment,
                    WINDOW_MINUTES,
                    "Waiting for GPS broadcast ephemeris before placing pierce points. Retrying automatically.",
                )
            else:
                payload = gradient_maps_from_pierce_points(placed, now=moment)
    else:
        payload = gradient_maps_from_pierce_points(points, now=moment)

    with _cache_lock:
        _cache = (time.time(), payload)
    return payload


_build_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tec-gradients")
_build_lock = threading.Lock()
_build_job = None


def build_tec_gradient_maps(*, now: datetime | None = None) -> dict[str, Any]:
    """Serve completed maps while one worker queries and places the next window."""
    global _build_job
    moment = now or datetime.now(timezone.utc)
    with _build_lock:
        if _build_job is not None and _build_job.done():
            job = _build_job
            _build_job = None
            return job.result()
        with _cache_lock:
            cached = _cache
        if cached is not None:
            ttl = _CACHE_S if cached[1].get("available") else _FAIL_CACHE_S
            if time.time() - cached[0] < ttl:
                return cached[1]
        if _build_job is None:
            _build_job = _build_pool.submit(_build_tec_gradient_maps, now=moment)
        if cached is not None:
            return cached[1]
    return _empty_payload(
        moment, WINDOW_MINUTES,
        "Gradient maps are being calculated in the background. This panel refreshes automatically.",
    )
