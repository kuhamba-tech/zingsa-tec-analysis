"""Dst/Kp and TEC-map RMSE series for the Zimbabwe ionospheric response tab.

Kp is the GFZ 3-hour index. Dst is the WDC Kyoto hourly index. RMSE follows
Matamba and Danskin (2022): each 5 minutes, the previous 15 minutes of live
code TEC are placed at the ionospheric pierce point, binned on a 1° grid,
filled by nearest neighbour, and median-filtered with a window of size 7.
The RMSE is that grid minus the original TEC at each pierce point.
Empty inputs stay empty.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

_INDEX_TTL_S = 30 * 60
_RMSE_TTL_S = 90
_EARTH_KM = 6378.0
_IPP_KM = 350.0
_CADENCE = timedelta(minutes=5)
_WINDOW = timedelta(minutes=15)
_MIN_IPPS = 8
_BRDC_DIR = Path(__file__).resolve().parents[2] / "static" / "data" / "brdc_cache"
_TODAY_NAV_S = 30 * 60
_NAV_RETRY_S = 15 * 60

_cache_lock = threading.Lock()
_index_cache: tuple[float, str, tuple[list, str, list, str]] | None = None
_rmse_cache: tuple[float, str, list, list] | None = None

# Pierce points and finished maps for days that no longer change.
_state_lock = threading.Lock()
_raw_days: dict[str, list[tuple]] = {}
_placed: dict[str, list[tuple[datetime, float, float, float]]] = {}
_maps: dict[str, list[tuple[str, float, int]]] = {}
_failed_at: dict[str, float] = {}
_pending: set[date] = set()
_backfill_running = False
_map_generation = 0


def _screen_hour(samples: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    """Drop a station that is far from the other Zimbabwe sites in that hour."""
    if len(samples) < 4:
        return []
    median = sorted(sample[2] for sample in samples)[len(samples) // 2]
    return [sample for sample in samples if abs(sample[2] - median) <= 12]


def map_rmse(samples: list[tuple[float, float, float]]) -> float | None:
    """Leave-one-out inverse-distance RMSE (TECU). Needs four placed stations."""
    if len(samples) < 4:
        return None
    errors: list[float] = []
    for index, (lat, lon, value) in enumerate(samples):
        numer = 0.0
        denom = 0.0
        for other, (lat2, lon2, value2) in enumerate(samples):
            if other == index:
                continue
            distance = math.hypot(lat - lat2, lon - lon2)
            weight = 1.0 / max(distance, 0.15) ** 2
            numer += weight * value2
            denom += weight
        if denom <= 0:
            continue
        errors.append(value - numer / denom)
    if len(errors) < 4:
        return None
    return math.sqrt(sum(err * err for err in errors) / len(errors))


def observation_kept(tec: float, elevation: float) -> bool:
    """Matamba and Danskin accept elevation of at least 20° and TEC from 0 to 50."""
    return (
        math.isfinite(tec)
        and math.isfinite(elevation)
        and 0.0 <= tec <= 50.0
        and elevation >= 20.0
    )


def ipp_lat_lon(lat_deg: float, lon_deg: float, elev_deg: float, az_deg: float) -> tuple[float, float] | None:
    """Geographic pierce point at 350 km (Gopi Eqs. 4.18–4.20)."""
    if not observation_kept(1.0, elev_deg):
        return None
    elev = math.radians(elev_deg)
    az = math.radians(az_deg)
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    ratio = (_EARTH_KM * math.cos(elev)) / (_EARTH_KM + _IPP_KM)
    ratio = max(-1.0, min(1.0, ratio))
    psi = math.pi / 2.0 - elev - math.asin(ratio)
    # ψ is the angle at the Earth's centre. Latitude follows the spherical
    # destination along azimuth A, so a zenith ray (ψ = 0) stays on the station.
    sin_phi = math.sin(lat) * math.cos(psi) + math.cos(lat) * math.sin(psi) * math.cos(az)
    sin_phi = max(-1.0, min(1.0, sin_phi))
    phi = math.asin(sin_phi)
    cos_phi = math.cos(phi)
    if abs(cos_phi) < 1e-8:
        return None
    sin_dlon = math.sin(psi) * math.sin(az) / cos_phi
    sin_dlon = max(-1.0, min(1.0, sin_dlon))
    return math.degrees(phi), math.degrees(lon + math.asin(sin_dlon))


def _median_filter(grid: np.ndarray, size: int = 7) -> np.ndarray:
    pad = size // 2
    padded = np.pad(grid, pad, mode="edge")
    out = np.empty_like(grid)
    rows, cols = grid.shape
    for i in range(rows):
        window = padded[i : i + size]
        for j in range(cols):
            out[i, j] = np.median(window[:, j : j + size])
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


def matamba_rmse(lats, lons, tecs) -> float | None:
    """RMSE of the 1° nearest-neighbour, size-7 median-filtered grid at each IPP."""
    lat = np.asarray(lats, dtype=float)
    lon = np.asarray(lons, dtype=float)
    tec = np.asarray(tecs, dtype=float)
    keep = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(tec) & (tec >= 0.0) & (tec <= 50.0)
    lat, lon, tec = lat[keep], lon[keep], tec[keep]
    if tec.size < _MIN_IPPS:
        return None
    lat_bin = np.floor(lat).astype(int)
    lon_bin = np.floor(lon).astype(int)
    lat0, lat1 = int(lat_bin.min()), int(lat_bin.max())
    lon0, lon1 = int(lon_bin.min()), int(lon_bin.max())
    nlat = lat1 - lat0 + 1
    nlon = lon1 - lon0 + 1
    if nlat > 40 or nlon > 40:
        return None
    accum: list[list[list[float]]] = [[[] for _ in range(nlon)] for _ in range(nlat)]
    for lat_i, lon_i, value in zip(lat_bin, lon_bin, tec):
        accum[int(lat_i) - lat0][int(lon_i) - lon0].append(float(value))
    grid = np.full((nlat, nlon), np.nan)
    for i in range(nlat):
        for j in range(nlon):
            if accum[i][j]:
                grid[i, j] = float(np.median(accum[i][j]))
    grid = _median_filter(_nearest_fill(grid), 7)
    predicted = np.empty(tec.size)
    for index, (lat_i, lon_i) in enumerate(zip(lat_bin, lon_bin)):
        predicted[index] = grid[int(lat_i) - lat0, int(lon_i) - lon0]
    if not np.isfinite(predicted).all():
        return None
    error = tec - predicted
    return float(np.sqrt(np.mean(error * error)))


def rolling_mean_time(
    stamps: list[str],
    values: list[float],
    *,
    hours: int = 24 * 7,
    minimum: int = 12,
) -> list[float | None]:
    """Trailing mean. Hours with no sample are not invented."""
    times = [datetime.fromisoformat(stamp.replace("Z", "+00:00")) for stamp in stamps]
    span = timedelta(hours=hours)
    out: list[float | None] = []
    start = 0
    running = 0.0
    for index, moment in enumerate(times):
        running += values[index]
        while times[start] < moment - span:
            running -= values[start]
            start += 1
        count = index - start + 1
        out.append(None if count < minimum else running / count)
    return out


def lognormal_dividers(values: list[float], *, minimum: int = 48) -> tuple[float | None, float | None]:
    """exp(mean ± 1.5 std) of ln(RMSE), the paper's low and high dividers."""
    positive = [value for value in values if value is not None and value > 0]
    if len(positive) < minimum:
        return None, None
    logs = [math.log(value) for value in positive]
    mean = sum(logs) / len(logs)
    variance = sum((item - mean) ** 2 for item in logs) / (len(logs) - 1)
    sigma = math.sqrt(variance)
    return math.exp(mean - 1.5 * sigma), math.exp(mean + 1.5 * sigma)


def rolling_median_time(stamps: list[str], values: list[float], *, hours: int = 24 * 7) -> list[float | None]:
    """Median of samples inside the trailing window. Sparse hours are not filled."""
    times = [datetime.fromisoformat(stamp.replace("Z", "+00:00")) for stamp in stamps]
    span = timedelta(hours=hours)
    out: list[float | None] = []
    for index, moment in enumerate(times):
        chunk = [
            values[earlier]
            for earlier, previous in enumerate(times[: index + 1])
            if moment - previous <= span
        ]
        if len(chunk) < 6:
            out.append(None)
            continue
        ordered = sorted(chunk)
        out.append(ordered[len(ordered) // 2])
    return out


def rolling_median(values: list[float | None], window: int) -> list[float | None]:
    """Centered-trailing median. A window with too few samples stays empty."""
    need = max(12, window // 7)
    out: list[float | None] = []
    for index, _value in enumerate(values):
        start = max(0, index - window + 1)
        chunk = [item for item in values[start : index + 1] if item is not None]
        if len(chunk) < need:
            out.append(None)
            continue
        ordered = sorted(chunk)
        out.append(ordered[len(ordered) // 2])
    return out


def _walk_ekf(points: list[tuple[str, float | None]], config: Any, value_key: str) -> list[dict[str, Any]]:
    from zgiis.space_weather.ekf import ExtendedKalmanFilter1D

    rows: list[dict[str, Any]] = []
    ekf = None
    for stamp, value in points:
        if ekf is None:
            if value is None:
                rows.append({"time": stamp, value_key: None, "ekf": None, "error": None, "confidence": None})
                continue
            ekf = ExtendedKalmanFilter1D(value, config)
            rows.append({"time": stamp, value_key: round(value, 4), "ekf": None, "error": None, "confidence": None})
            continue
        predicted = ekf.predict()
        if value is None:
            rows.append({"time": stamp, value_key: None, "ekf": round(predicted, 4), "error": None, "confidence": None})
            continue
        error = abs(value - predicted)
        # A multi-hour hole can still sit inside one visit. Discard a forecast
        # that has run away and start again from the measured hour.
        if error > 8:
            ekf = ExtendedKalmanFilter1D(value, config)
            rows.append({"time": stamp, value_key: round(value, 4), "ekf": None, "error": None, "confidence": None})
            continue
        _, innov_std = ekf.update(value)
        confidence = max(0.0, min(100.0, 100.0 * math.exp(-innov_std / max(config.scale, 1e-6))))
        rows.append({
            "time": stamp,
            value_key: round(value, 4),
            "ekf": round(predicted, 4),
            "error": round(error, 4),
            "confidence": round(confidence, 1),
        })
    return rows


def _ekf_rows_reset_on_gaps(
    points: list[tuple[str, float]],
    value_key: str,
    *,
    max_gap_hours: float = 6,
) -> list[dict[str, Any]]:
    """Run the filter on each contiguous visit. A long gap starts a new filter."""
    from zgiis.space_weather.ekf import EkfConfig

    calm = EkfConfig(bounds=(0.0, 20.0), q_pos=0.05, q_vel=0.004, r=4.0, trend_damping=0.35, scale=5.0)
    rows: list[dict[str, Any]] = []
    segment: list[tuple[str, float | None]] = []
    previous: datetime | None = None

    def flush() -> None:
        if segment:
            rows.extend(_walk_ekf(segment, calm, value_key))

    for stamp, value in points:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if previous is not None and (moment - previous) > timedelta(hours=max_gap_hours):
            flush()
            segment = []
        segment.append((stamp, value))
        previous = moment
    flush()
    return rows


def _ekf_rows(points: list[tuple[str, float | None]], parameter: str, value_key: str) -> list[dict[str, Any]]:
    from zgiis.space_weather.ekf import run_ekf_series

    rows: list[dict[str, Any]] = []
    for point in run_ekf_series(points, parameter):
        rows.append({
            "time": point.t,
            value_key: point.observed,
            "ekf": point.predicted,
            "error": point.error,
            "confidence": point.confidence,
        })
    return rows


def _kp_series(start: date, end: date) -> tuple[list[dict[str, Any]], str]:
    from zgiis.space_weather.gfz_kp_client import GFZ_TXT_NOWCAST, GFZ_TXT_SINCE_1932, fetch_gfz_daily

    rows = fetch_gfz_daily(start, end)
    points: list[tuple[str, float | None]] = []
    for row in rows:
        day = date.fromisoformat(str(row["date"]))
        slots = row.get("kp_3h") or []
        for slot, value in enumerate(slots[:8]):
            stamp = datetime(day.year, day.month, day.day, slot * 3, tzinfo=timezone.utc)
            points.append((stamp.strftime("%Y-%m-%dT%H:%M:%SZ"), None if value is None else float(value)))
    source = f"GFZ Potsdam 3-hour Kp ({GFZ_TXT_SINCE_1932} · {GFZ_TXT_NOWCAST})"
    return _ekf_rows(points, "kp", "kp"), source


def _dst_series(start: date, end: date) -> tuple[list[dict[str, Any]], str]:
    from zgiis.space_weather.wdc_kyoto_client import KYOTO_BASE, fetch_kyoto_dst_hourly

    hourly = fetch_kyoto_dst_hourly(start, end)
    points = [(str(row["time"]), float(row["dst"])) for row in hourly]
    source = f"WDC Kyoto hourly Dst ({KYOTO_BASE}/dstdir/)"
    return _ekf_rows(points, "dst", "dst"), source


def _as_utc(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _sv_number(prn: Any) -> int | None:
    text = str(prn).strip().upper()
    if text.startswith("G"):
        text = text[1:]
    try:
        return int(text)
    except ValueError:
        return None


def _ceil_five(moment: datetime) -> datetime:
    step = 300
    epoch = int(moment.timestamp())
    aligned = ((epoch + step - 1) // step) * step
    return datetime.fromtimestamp(aligned, tz=timezone.utc)


def _rmse_maps(
    samples: list[tuple[datetime, float, float, float]],
    day: date | None = None,
) -> list[tuple[str, float, int]]:
    """One RMSE at each 5-minute mark, from the pierce points in the previous 15 minutes."""
    if len(samples) < _MIN_IPPS:
        return []
    ordered = sorted(samples, key=lambda item: item[0])
    if day is None:
        cursor = _ceil_five(ordered[0][0])
        end = _ceil_five(ordered[-1][0])
    else:
        cursor = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        end = cursor + timedelta(days=1) - _CADENCE
    out: list[tuple[str, float, int]] = []
    left = 0
    right = 0
    count = len(ordered)
    while cursor <= end and cursor <= ordered[-1][0] + _CADENCE:
        window_start = cursor - _WINDOW
        while right < count and ordered[right][0] <= cursor:
            right += 1
        while left < right and ordered[left][0] <= window_start:
            left += 1
        if day is None or cursor.date() == day:
            chunk = ordered[left:right]
            if len(chunk) >= _MIN_IPPS:
                rmse = matamba_rmse(
                    [item[1] for item in chunk],
                    [item[2] for item in chunk],
                    [item[3] for item in chunk],
                )
                if rmse is not None and math.isfinite(rmse):
                    stamp = cursor.strftime("%Y-%m-%dT%H:%M:%SZ")
                    out.append((stamp, round(rmse, 3), len(chunk)))
        cursor += _CADENCE
    return out


def _code_live_frame(since: datetime):
    from zgiis.db.timescale import TecDB

    db = TecDB()
    stamp = since.astimezone(timezone.utc).isoformat()
    if db._is_pg:
        sql = """
        SELECT time, station, prn, vtec_tecu, elevation_deg
        FROM vtec_obs
        WHERE time >= %s
          AND tec_method LIKE '%%code_live%%'
          AND vtec_tecu >= 0
          AND vtec_tecu <= 50
          AND elevation_deg >= 20
        """
    else:
        sql = """
        SELECT time, station, prn, vtec_tecu, elevation_deg
        FROM vtec_obs
        WHERE time >= ?
          AND tec_method LIKE '%code_live%'
          AND vtec_tecu >= 0
          AND vtec_tecu <= 50
          AND elevation_deg >= 20
        """
    return db._read_sql(sql, [stamp])


def _rows_from_frame(frame) -> dict[str, list[tuple]]:
    grouped: dict[str, list[tuple]] = {}
    if frame is None or getattr(frame, "empty", True):
        return grouped
    for record in frame.itertuples(index=False):
        moment = _as_utc(getattr(record, "time", None))
        if moment is None:
            continue
        try:
            tec = float(record.vtec_tecu)
            elev = float(record.elevation_deg)
        except (TypeError, ValueError, AttributeError):
            continue
        if not observation_kept(tec, elev):
            continue
        station = str(getattr(record, "station", "") or "").lower().rstrip("_")
        grouped.setdefault(moment.date().isoformat(), []).append(
            (moment, station, getattr(record, "prn", None), tec, elev)
        )
    return grouped


def _nav_frame(day: date):
    import pandas as pd

    path = _BRDC_DIR / f"{day.isoformat()}.pkl"
    today = datetime.now(timezone.utc).date()
    if path.exists():
        stale = day >= today and (time.time() - path.stat().st_mtime) > _TODAY_NAV_S
        if not stale:
            try:
                frame = pd.read_pickle(path)
            except Exception:
                frame = None
            else:
                if frame is not None and not getattr(frame, "empty", True):
                    return frame
    from zgiis.live.broadcast_ephemeris import _download_brdc, _load_gps_nav_df

    noon = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
    # The current day's file is often published late, so the previous day's
    # broadcast ephemeris is the one still in force.
    candidates = [noon, noon - timedelta(days=1)] if day == today else [noon]
    frame = None
    for candidate in candidates:
        downloaded = _download_brdc(candidate)
        if downloaded is None:
            continue
        try:
            loaded = _load_gps_nav_df(downloaded)
        finally:
            try:
                downloaded.unlink(missing_ok=True)
            except OSError:
                pass
        if loaded is not None and not getattr(loaded, "empty", True):
            frame = loaded
            break
    if frame is None:
        return None
    try:
        _BRDC_DIR.mkdir(parents=True, exist_ok=True)
        frame.to_pickle(path.with_suffix(".tmp"))
        path.with_suffix(".tmp").replace(path)
    except Exception as exc:
        log.info("Could not cache broadcast ephemeris for %s: %s", day.isoformat(), exc)
    return frame


def _hourly_nav(frame, day: date) -> list[dict[int, dict]]:
    from zgiis.live.broadcast_ephemeris import _latest_per_sv

    hourly: list[dict[int, dict]] = []
    for hour in range(24):
        moment = datetime(day.year, day.month, day.day, hour, 59, 30, tzinfo=timezone.utc)
        hourly.append(_latest_per_sv(frame, moment))
    return hourly


def _place_rows(rows: list[tuple], day: date) -> list[tuple[datetime, float, float, float]] | None:
    """Pierce points for one UTC day. None means the broadcast ephemeris is missing."""
    if not rows:
        return []
    nav = _nav_frame(day)
    if nav is None:
        return None
    hourly = _hourly_nav(nav, day)
    if not any(hourly):
        return None
    from zgiis.cors.stations import get_station
    from zgiis.live.satellite_geometry import llh_to_ecef, look_angles_ecef

    receivers: dict[str, Any] = {}
    placed: list[tuple[datetime, float, float, float]] = []
    for moment, station, prn, tec, elev in rows:
        site = receivers.get(station)
        if site is None:
            known = get_station(station)
            if known is None:
                receivers[station] = False
                continue
            receivers[station] = (
                llh_to_ecef(float(known.lat), float(known.lon), float(known.height_m)),
                float(known.lat),
                float(known.lon),
            )
            site = receivers[station]
        if site is False:
            continue
        sv = _sv_number(prn)
        if sv is None:
            continue
        ephemeris = hourly[moment.hour].get(sv)
        if ephemeris is None:
            continue
        angles = look_angles_ecef(site[0], ephemeris, moment)
        if angles is None:
            continue
        pierce = ipp_lat_lon(site[1], site[2], float(elev), angles[1])
        if pierce is None:
            continue
        placed.append((moment, pierce[0], pierce[1], float(tec)))
    return placed


def _publish_maps(day: date, *, count_generation: bool) -> None:
    global _map_generation
    key = day.isoformat()
    previous = (day - timedelta(days=1)).isoformat()
    with _state_lock:
        rows = list(_placed.get(key, []))
        tail_start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - _WINDOW
        tail = [sample for sample in _placed.get(previous, []) if sample[0] > tail_start]
        already = key in _maps
    maps = _rmse_maps(tail + rows, day)
    with _state_lock:
        if count_generation and not already:
            _map_generation += 1
        _maps[key] = maps


def _place_and_publish(day: date, rows: list[tuple], *, count_generation: bool) -> str:
    """Return 'ok', 'empty', or 'missing' after storing one day."""
    try:
        placed = _place_rows(rows, day)
    except Exception:
        log.warning("Pierce-point placement failed for %s", day.isoformat(), exc_info=True)
        placed = None
    key = day.isoformat()
    with _state_lock:
        if placed is None:
            _failed_at[key] = time.time()
            return "missing"
        _placed[key] = placed
        _failed_at.pop(key, None)
        _raw_days.pop(key, None)
    _publish_maps(day, count_generation=count_generation)
    return "ok" if placed else "empty"


def _backfill_loop() -> None:
    global _backfill_running
    from concurrent.futures import ThreadPoolExecutor

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            while True:
                with _state_lock:
                    batch = sorted(_pending)[:4]
                    for day in batch:
                        _pending.discard(day)
                if not batch:
                    break
                list(pool.map(_place_historical, batch))
                for day in batch:
                    key = day.isoformat()
                    with _state_lock:
                        ready = key in _placed
                    if ready:
                        _publish_maps(day, count_generation=True)
    except Exception:
        log.warning("TEC map RMSE backfill stopped", exc_info=True)
    finally:
        with _state_lock:
            _backfill_running = False
            restart = bool(_pending)
        if restart:
            _ensure_backfill()


def _place_historical(day: date) -> None:
    key = day.isoformat()
    with _state_lock:
        rows = list(_raw_days.get(key, []))
    try:
        placed = _place_rows(rows, day)
    except Exception:
        log.warning("Pierce-point placement failed for %s", day.isoformat(), exc_info=True)
        placed = None
    with _state_lock:
        if placed is None:
            _failed_at[key] = time.time()
            return
        _placed[key] = placed
        _failed_at.pop(key, None)
        _raw_days.pop(key, None)


def _ensure_backfill() -> None:
    global _backfill_running
    with _state_lock:
        if _backfill_running or not _pending:
            return
        _backfill_running = True
    threading.Thread(target=_backfill_loop, name="matamba-rmse", daemon=True).start()


def _remember_rows(grouped: dict[str, list[tuple]], *, replace: set[str]) -> None:
    with _state_lock:
        for key, rows in grouped.items():
            if key in replace or key not in _raw_days:
                _raw_days[key] = rows


def _rmse_series(hours: float) -> tuple[list[dict[str, Any]], list[str]]:
    now = datetime.now(timezone.utc)
    today = now.date()
    start_day = (now - timedelta(hours=hours)).date()
    yesterday = today - timedelta(days=1)
    needed: list[date] = []
    cursor_day = start_day
    while cursor_day <= today:
        needed.append(cursor_day)
        cursor_day += timedelta(days=1)

    with _state_lock:
        need_history = any(
            day < yesterday
            and day.isoformat() not in _maps
            and day.isoformat() not in _raw_days
            and (time.time() - _failed_at.get(day.isoformat(), 0.0)) >= _NAV_RETRY_S
            for day in needed
        )
    since = datetime(start_day.year, start_day.month, start_day.day, tzinfo=timezone.utc)
    if not need_history:
        since = datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc)
    grouped = _rows_from_frame(_code_live_frame(since))
    _remember_rows(grouped, replace={yesterday.isoformat(), today.isoformat()})

    notes: list[str] = []
    for day in (yesterday, today):
        if day < start_day:
            continue
        key = day.isoformat()
        with _state_lock:
            # A finished UTC day is placed once. The current day is replaced
            # on every refresh so the latest code TEC enters the map.
            if day < today and key in _placed:
                continue
            rows = list(_raw_days.get(key, []))
        status = _place_and_publish(day, rows, count_generation=False)
        if status == "missing":
            notes.append(day.isoformat())

    with _state_lock:
        for day in needed:
            if day >= yesterday:
                continue
            key = day.isoformat()
            if key in _maps:
                continue
            if time.time() - _failed_at.get(key, 0.0) < _NAV_RETRY_S and key not in _placed:
                continue
            if key in _raw_days or key in _placed:
                _pending.add(day)
        pending = bool(_pending) or _backfill_running
    if any(day < yesterday and day.isoformat() in _raw_days for day in needed) or pending:
        _ensure_backfill()

    with _state_lock:
        finite = [item for day in needed for item in _maps.get(day.isoformat(), [])]
        history_left = any(
            day < yesterday and day.isoformat() not in _maps and day.isoformat() not in _failed_at
            for day in needed
        )
        failed = [
            day.isoformat()
            for day in needed
            if day < yesterday and day.isoformat() in _failed_at and day.isoformat() not in _maps
        ]
    if not finite:
        return [], notes + failed + (["pending"] if history_left else [])
    finite.sort(key=lambda item: item[0])
    smooth = rolling_mean_time([item[0] for item in finite], [item[1] for item in finite], hours=24 * 7)
    rows = _ekf_rows_reset_on_gaps([(item[0], item[1]) for item in finite], "rmse")
    for row, item, trend in zip(rows, finite, smooth):
        row["stations"] = item[2]
        row["smooth"] = None if trend is None else round(float(trend), 3)
    if history_left:
        notes.append("pending")
    return rows, notes + failed


def build_iono_response_figures(*, days: int = 180) -> dict[str, Any]:
    """Kp bars, Dst line, and live code-TEC map RMSE for the last `days` UTC days."""
    global _index_cache, _rmse_cache
    days = max(14, min(int(days), 366))
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    cache_key = f"{start.isoformat()}:{end.isoformat()}"
    now = time.time()
    notes: list[str] = []

    with _cache_lock:
        cached_index = _index_cache
        index_hit = (
            cached_index is not None
            and cached_index[1] == cache_key
            and (now - cached_index[0]) < _INDEX_TTL_S
        )
    if index_hit and cached_index is not None:
        kp, kp_source, dst, dst_source = cached_index[2]
    else:
        try:
            kp, kp_source = _kp_series(start, end)
        except Exception as exc:
            log.warning("Kp series for ionospheric response failed: %s", exc)
            kp, kp_source = [], ""
            notes.append("GFZ Kp is unavailable.")
        try:
            dst, dst_source = _dst_series(start, end)
        except Exception as exc:
            log.warning("Dst series for ionospheric response failed: %s", exc)
            dst, dst_source = [], ""
            notes.append("WDC Kyoto Dst is unavailable.")
        if kp or dst:
            with _cache_lock:
                _index_cache = (time.time(), cache_key, (kp, kp_source, dst, dst_source))

    with _state_lock:
        generation = _map_generation
    rmse_key = f"{cache_key}:{generation}"
    with _cache_lock:
        cached_rmse = _rmse_cache
        rmse_hit = (
            cached_rmse is not None
            and cached_rmse[1] == rmse_key
            and (now - cached_rmse[0]) < _RMSE_TTL_S
        )
    flags: list[str] = []
    if rmse_hit and cached_rmse is not None:
        rmse = cached_rmse[2]
        flags = list(cached_rmse[3])
    else:
        try:
            rmse, flags = _rmse_series(hours=days * 24)
        except Exception as exc:
            log.warning("TEC map RMSE series failed: %s", exc)
            rmse = []
            notes.append("Live TEC map RMSE could not be computed.")
        with _state_lock:
            generation = _map_generation
        rmse_key = f"{cache_key}:{generation}"
        with _cache_lock:
            _rmse_cache = (time.time(), rmse_key, rmse, flags)

    missing_days = [item for item in flags if item != "pending"]
    if "pending" in flags:
        notes.append("Earlier days are still being placed at the ionospheric pierce points.")
    if missing_days:
        notes.append(
            "Days without a readable GPS broadcast ephemeris are omitted: " + ", ".join(missing_days) + "."
        )
    if not rmse:
        notes.append(
            "TEC map RMSE is shown when live NTRIP code TEC can be placed at ionospheric pierce points."
        )

    low, high = lognormal_dividers([float(row["rmse"]) for row in rmse if row.get("rmse") is not None])
    definition = (
        "Matamba and Danskin (2022) RMSE between live Zimbabwe NTRIP code TEC (GOPI) at the "
        "ionospheric pierce point and the 1° nearest-neighbour grid after a median filter of size 7. "
        "Each value uses the previous 15 minutes and is updated every 5 minutes. "
        "TEC below 0 or above 50 TECU, and elevation below 20°, is excluded. "
        "The red curve is the 7-day running average."
    )
    if low is not None and high is not None:
        definition += (
            f" Olive and magenta lines at {low:.2f} and {high:.2f} TECU are the log-normal "
            "−1.5σ and +1.5σ of this RMSE sample."
        )

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "kp_source": kp_source,
        "dst_source": dst_source,
        "rmse_definition": definition,
        "rmse_low": None if low is None else round(low, 3),
        "rmse_high": None if high is None else round(high, 3),
        "kp": kp,
        "dst": dst,
        "rmse": rmse,
        "note": " ".join(notes),
    }
