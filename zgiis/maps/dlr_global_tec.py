"""Sample DLR IMPC Global TEC (1h forecast JSON) at CORS station coordinates."""

from __future__ import annotations

import logging
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

log = logging.getLogger(__name__)

DLR_GLOBAL_TEC_FORECAST_JSON = (
    "https://data.impc.dlr.de/tec-forecast/"
    "DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL/latest/"
    "DLR_GNSS_GCG_L4_VTEC-FC-1H-NTCM-SCM_FC_GLOBAL_latest_D.json"
)

DLR_TEC_METHOD = "dlr_fc_1h_global"
DLR_CONSTELLATION = "DLR"
DLR_PRN = "GIM"
# The 1-hour forecast changes about once an hour. Reuse a successful sample
# so the comparison table is not waiting on another DLR download or a full
# observation-table scan.
_SNAPSHOT_TTL_S = 900.0
_SNAPSHOT_CACHE: dict[str, Any] = {"at": 0.0, "snapshot": None, "fail_at": 0.0}
_REFRESH_LOCK = threading.Lock()
_refresh_running = False


def _parse_epoch(metadata: dict[str, Any]) -> datetime:
    details = metadata.get("details") or {}
    temporal = details.get("temporal_coverage") or {}
    for key in ("end_time", "start_time"):
        raw = temporal.get(key)
        if not raw:
            continue
        try:
            # DLR timestamps are UTC without Z.
            return datetime.fromisoformat(str(raw).replace("Z", "")).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    created = metadata.get("created")
    if created:
        try:
            return datetime.fromisoformat(str(created).replace("Z", "")).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(tz=timezone.utc)


def _build_grid(payload: dict[str, Any]) -> tuple[dict[tuple[float, float], float], list[float], list[float]]:
    features = (((payload.get("data") or {}).get("grid") or {}).get("features")) or []
    values: dict[tuple[float, float], float] = {}
    lats: set[float] = set()
    lons: set[float] = set()
    for feat in features:
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon = float(coords[0])
        lat = float(coords[1])
        props = feat.get("properties") or {}
        raw = props.get("vtec_1h_forecast_tecu")
        if raw is None:
            raw = props.get("vtec_forecast_tecu")
        if raw is None:
            continue
        try:
            vtec = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(vtec):
            continue
        values[(lat, lon)] = vtec
        lats.add(lat)
        lons.add(lon)
    return values, sorted(lats), sorted(lons)


def _bilinear(
    lat: float,
    lon: float,
    values: dict[tuple[float, float], float],
    lats: list[float],
    lons: list[float],
) -> float | None:
    if not values or not lats or not lons:
        return None
    # Clamp into grid bounds.
    lat_c = min(max(lat, lats[0]), lats[-1])
    lon_c = min(max(lon, lons[0]), lons[-1])

    i1 = 0
    while i1 < len(lats) - 1 and lats[i1 + 1] < lat_c:
        i1 += 1
    i0 = max(0, i1)
    i1 = min(len(lats) - 1, i0 + 1)

    j1 = 0
    while j1 < len(lons) - 1 and lons[j1 + 1] < lon_c:
        j1 += 1
    j0 = max(0, j1)
    j1 = min(len(lons) - 1, j0 + 1)

    lat0, lat1 = lats[i0], lats[i1]
    lon0, lon1 = lons[j0], lons[j1]
    q00 = values.get((lat0, lon0))
    q01 = values.get((lat0, lon1))
    q10 = values.get((lat1, lon0))
    q11 = values.get((lat1, lon1))
    samples = [v for v in (q00, q01, q10, q11) if v is not None]
    if not samples:
        return None
    if lat0 == lat1 and lon0 == lon1:
        return float(samples[0])
    if any(v is None for v in (q00, q01, q10, q11)):
        return float(sum(samples) / len(samples))

    ty = 0.0 if lat1 == lat0 else (lat_c - lat0) / (lat1 - lat0)
    tx = 0.0 if lon1 == lon0 else (lon_c - lon0) / (lon1 - lon0)
    return float(
        q00 * (1 - tx) * (1 - ty)
        + q01 * tx * (1 - ty)
        + q10 * (1 - tx) * ty
        + q11 * tx * ty
    )


def sample_global_tec_at_points(
    points: list[tuple[str, float, float]],
    *,
    timeout_sec: float = 45.0,
) -> dict[str, Any]:
    """Return DLR Global TEC samples at (code, lat, lon) points.

    ``points`` entries are ``(station_code, lat, lon)``.
    """
    try:
        resp = requests.get(
            DLR_GLOBAL_TEC_FORECAST_JSON,
            timeout=timeout_sec,
            headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        log.warning("DLR Global TEC JSON fetch failed: %s", exc)
        return {"available": False, "epoch": None, "stations": [], "message": str(exc)}

    values, lats, lons = _build_grid(payload if isinstance(payload, dict) else {})
    if not values:
        return {"available": False, "epoch": None, "stations": [], "message": "DLR grid empty"}

    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    epoch = _parse_epoch(metadata if isinstance(metadata, dict) else {})
    stations: list[dict[str, Any]] = []
    for code, lat, lon in points:
        vtec = _bilinear(float(lat), float(lon), values, lats, lons)
        if vtec is None or not math.isfinite(vtec) or vtec <= 0:
            continue
        stations.append(
            {
                "station": str(code).lower().rstrip("_"),
                "lat": float(lat),
                "lon": float(lon),
                "vtec_tecu": round(float(vtec), 2),
            }
        )

    return {
        "available": bool(stations),
        "epoch": epoch.isoformat().replace("+00:00", "Z"),
        "stations": stations,
        "source": "DLR IMPC 1h forecast Global TEC",
        "message": None,
    }


def _global_epoch_already_stored(db: Any, epoch: datetime) -> bool:
    """True when this DLR hour is already in the observation table."""
    start = (epoch - timedelta(minutes=10)).isoformat()
    end = (epoch + timedelta(minutes=10)).isoformat()
    placeholder = "%s" if getattr(db, "_is_pg", False) else "?"
    sql = f"""
    SELECT 1 AS present
    FROM vtec_obs
    WHERE tec_method = {placeholder}
      AND time >= {placeholder}
      AND time <= {placeholder}
    LIMIT 1
    """
    found = db._read_sql(sql, [DLR_TEC_METHOD, start, end])
    return found is not None and not getattr(found, "empty", True)


def _schedule_global_tec_refresh(points: list[tuple[str, float, float]]) -> None:
    """Download a new DLR map in the background when the last sample is stale.

    The comparison request itself keeps returning the stored sample so the
    table does not wait on the forecast file.
    """
    global _refresh_running
    now = time.time()
    cached = _SNAPSHOT_CACHE.get("snapshot")
    fresh = (
        isinstance(cached, dict)
        and cached.get("available")
        and now - float(_SNAPSHOT_CACHE.get("at") or 0.0) < _SNAPSHOT_TTL_S
    )
    if fresh or now - float(_SNAPSHOT_CACHE.get("fail_at") or 0.0) < 300.0:
        return
    with _REFRESH_LOCK:
        if _refresh_running:
            return
        _refresh_running = True

    def _run() -> None:
        global _refresh_running
        try:
            snapshot = cached_global_tec_snapshot(points)
            if not isinstance(snapshot, dict) or not snapshot.get("available"):
                _SNAPSHOT_CACHE["fail_at"] = time.time()
        except Exception as exc:
            log.debug("background DLR Global TEC refresh skipped: %s", exc)
            _SNAPSHOT_CACHE["fail_at"] = time.time()
        finally:
            with _REFRESH_LOCK:
                _refresh_running = False

    threading.Thread(target=_run, name="zgiis-dlr-global-refresh", daemon=True).start()


def persist_global_tec_samples(snapshot: dict[str, Any]) -> int:
    """Write sampled Global TEC into TecDB as tagged rows for time-series charts."""
    if not snapshot.get("available"):
        return 0
    epoch_raw = snapshot.get("epoch")
    try:
        epoch = datetime.fromisoformat(str(epoch_raw).replace("Z", "+00:00"))
    except Exception:
        epoch = datetime.now(tz=timezone.utc)

    try:
        from backend.live_manager import get_db

        db = get_db()
        # Skip re-insert when this forecast epoch was already logged (DLR updates ~hourly).
        # A targeted lookup — scanning the live observation table locks SQLite.
        if _global_epoch_already_stored(db, epoch):
            return 0
    except Exception as exc:
        log.debug("DLR Global TEC dedup check skipped: %s", exc)

    records = []
    for row in snapshot.get("stations") or []:
        records.append(
            {
                "epoch": epoch,
                "station": str(row["station"]).lower().rstrip("_"),
                "constellation": DLR_CONSTELLATION,
                "prn": DLR_PRN,
                "vtec_tecu": float(row["vtec_tecu"]),
                "stec_tecu": None,
                "elevation_deg": None,
                "cnr_dbhz": None,
                "tecg_tecu": None,
                "tecp_tecu": None,
                "tec_method": DLR_TEC_METHOD,
                "bias_method": None,
            }
        )
    if not records:
        return 0
    try:
        from backend.live_manager import get_db

        return int(get_db().insert_vtec(records) or 0)
    except Exception as exc:
        log.warning("persist DLR Global TEC samples failed: %s", exc)
        return 0


def query_global_tec_series(*, hours: float = 6.0) -> list[dict[str, Any]]:
    """Return logged DLR Global TEC samples grouped by station."""
    try:
        from backend.live_manager import get_db

        df = get_db().query_recent(hours=hours)
    except Exception:
        return []
    if df is None or getattr(df, "empty", True):
        return []
    if "tec_method" not in df.columns:
        return []
    work = df[df["tec_method"].astype(str) == DLR_TEC_METHOD].copy()
    if work.empty:
        return []
    work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
    work["time"] = pd_to_datetime(work["time"])
    work["vtec_tecu"] = to_numeric(work["vtec_tecu"])
    work = work.dropna(subset=["time", "vtec_tecu", "station"])
    out: list[dict[str, Any]] = []
    for code, group in work.groupby("station"):
        points = []
        for _, row in group.sort_values("time").iterrows():
            points.append(
                {
                    "time": row["time"].isoformat().replace("+00:00", "Z"),
                    "vtec_tecu": round(float(row["vtec_tecu"]), 2),
                }
            )
        if not points:
            continue
        out.append(
            {
                "station": str(code),
                "points": points,
                "latest_vtec": points[-1]["vtec_tecu"],
            }
        )
    return out


def pd_to_datetime(series):
    import pandas as pd

    return pd.to_datetime(series, utc=True, errors="coerce")


def to_numeric(series):
    import pandas as pd

    return pd.to_numeric(series, errors="coerce")


def stored_latest_global_tec() -> dict[str, Any] | None:
    """Last persisted DLR sample. Avoids a live-table scan and a DLR download."""
    try:
        from backend.live_manager import get_db

        db = get_db()
        placeholder = "%s" if db._is_pg else "?"
        sql = f"""
        SELECT station, vtec_tecu, time
        FROM vtec_obs
        WHERE tec_method = {placeholder}
          AND time = (
            SELECT MAX(time) FROM vtec_obs WHERE tec_method = {placeholder}
          )
        """
        df = db._read_sql(sql, [DLR_TEC_METHOD, DLR_TEC_METHOD])
    except Exception as exc:
        log.debug("stored global TEC lookup skipped: %s", exc)
        return None
    if df is None or getattr(df, "empty", True):
        return None
    stations = []
    epoch = None
    for _, row in df.iterrows():
        try:
            vtec = float(row["vtec_tecu"])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(vtec) or vtec <= 0:
            continue
        raw_time = row["time"]
        if epoch is None and raw_time is not None:
            text = raw_time.isoformat() if hasattr(raw_time, "isoformat") else str(raw_time)
            epoch = text.replace("+00:00", "Z")
        stations.append(
            {
                "station": str(row["station"]).lower().rstrip("_"),
                "vtec_tecu": round(vtec, 2),
            }
        )
    if not stations:
        return None
    return {
        "available": True,
        "epoch": epoch,
        "stations": stations,
        "source": "DLR IMPC 1h forecast Global TEC",
        "message": None,
    }


def cached_global_tec_snapshot(points: list[tuple[str, float, float]]) -> dict[str, Any]:
    """Latest DLR sample at the CORS sites, without scanning the live TEC table."""
    now = time.time()
    cached = _SNAPSHOT_CACHE.get("snapshot")
    if (
        isinstance(cached, dict)
        and cached.get("available")
        and now - float(_SNAPSHOT_CACHE.get("at") or 0.0) < _SNAPSHOT_TTL_S
    ):
        return cached
    snapshot = sample_global_tec_at_points(points)
    if snapshot.get("available"):
        _SNAPSHOT_CACHE["at"] = now
        _SNAPSHOT_CACHE["snapshot"] = snapshot
        threading.Thread(
            target=persist_global_tec_samples,
            args=(snapshot,),
            name="zgiis-dlr-global-persist",
            daemon=True,
        ).start()
    return snapshot


def refresh_and_query_global_tec(*, hours: float = 6.0, latest_only: bool = False) -> dict[str, Any]:
    """Fetch latest DLR map, sample every CORS site, persist, return series."""
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    points = [(s.code, float(s.lat), float(s.lon)) for s in ZIMBABWE_CORS_STATIONS]
    if latest_only:
        _schedule_global_tec_refresh(points)
        stored = stored_latest_global_tec()
        if stored and stored.get("stations"):
            return {
                "available": True,
                "epoch": stored.get("epoch"),
                "source": stored.get("source") or "DLR IMPC 1h forecast Global TEC",
                "inserted": 0,
                "stations": [],
                "latest": stored.get("stations") or [],
                "message": None,
            }
        snapshot = cached_global_tec_snapshot(points)
        return {
            "available": bool(snapshot.get("available")),
            "epoch": snapshot.get("epoch"),
            "source": snapshot.get("source") or "DLR IMPC 1h forecast Global TEC",
            "inserted": 0,
            "stations": [],
            "latest": snapshot.get("stations") or [],
            "message": snapshot.get("message"),
        }
    snapshot = cached_global_tec_snapshot(points)
    inserted = 0
    series = query_global_tec_series(hours=hours)
    return {
        "available": bool(series) or bool(snapshot.get("available")),
        "epoch": snapshot.get("epoch"),
        "source": snapshot.get("source") or "DLR IMPC 1h forecast Global TEC",
        "inserted": inserted,
        "stations": series,
        "latest": snapshot.get("stations") or [],
        "message": snapshot.get("message"),
    }
