"""Live VTEC operational health for dashboard banners and diagnostics."""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
_COLLECTOR_LOCK = ROOT / "static" / "data" / ".live_ntrip_collector.lock"
_FRESH_OBS_S = 120.0


def _collector_pid_alive() -> bool:
    try:
        if not _COLLECTOR_LOCK.is_file():
            return False
        pid = int(_COLLECTOR_LOCK.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def _newest_obs_age_s(db) -> float | None:
    try:
        df = db.query_recent(hours=0.25)
        if df is None or df.empty or "time" not in df.columns:
            return None
        if "tec_method" in df.columns:
            method = df["tec_method"].astype(str)
            df = df[method.str.contains("live", case=False, na=False)]
        if df.empty:
            return None
        times = pd.to_datetime(df["time"], utc=True, errors="coerce").dropna()
        if times.empty:
            return None
        age = (datetime.now(timezone.utc) - times.max().to_pydatetime()).total_seconds()
        return max(0.0, float(age))
    except Exception:
        return None


def _station_blocker(
    *,
    code: str,
    has_fresh_vtec: bool,
    stream: dict[str, Any] | None,
    diag: dict[str, Any] | None,
) -> str | None:
    if has_fresh_vtec:
        return None
    if diag:
        missing_el = int(diag.get("missing_elevation") or 0)
        obs = int(diag.get("observations") or 0)
        emitted = int(diag.get("vtec_emitted") or 0)
        if obs > 0 and missing_el > obs * 0.5:
            return "awaiting_gps_ephemeris"
        if obs > 0 and emitted == 0:
            return "msm_without_vtec_decode"
    if stream:
        if stream.get("connected") and not stream.get("last_seen"):
            return "ntrip_connected_no_msm"
        if stream.get("last_seen"):
            return "no_recent_vtec_in_db"
    return "no_recent_observations"


def build_live_vtec_health() -> dict[str, Any]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    from zgiis.maps.heatmap_data import LIVE_VTEC_RECENT_MINUTES, build_tec_heatmap

    global_blockers: list[str] = []
    collector_running = _collector_pid_alive()
    external_collector = os.getenv("ZGIIS_EXTERNAL_COLLECTOR", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    db = None
    db_backend = "unknown"
    try:
        from backend.live_manager import get_db

        db = get_db()
        db_backend = db.backend
    except Exception:
        global_blockers.append("database_unavailable")

    newest_age = _newest_obs_age_s(db) if db else None
    if db and db_backend == "sqlite" and not collector_running and external_collector:
        global_blockers.append("collector_not_running")

    if newest_age is not None and newest_age > _FRESH_OBS_S:
        global_blockers.append("observations_stale")

    hm = build_tec_heatmap(hours=0.05, refresh_ntrip=False)
    hm_stations = {str(s.get("code", "")).lower().rstrip("_"): s for s in hm.get("stations") or []}

    fresh_vtec: dict[str, float] = {}
    if db:
        try:
            agg = db.recent_station_vtec(
                minutes=LIVE_VTEC_RECENT_MINUTES,
                code_live_only=True,
            )
            if agg is not None and not agg.empty:
                for _, row in agg.iterrows():
                    code = str(row["station"]).lower().rstrip("_")
                    fresh_vtec[code] = float(row["mean_vtec"])
        except Exception:
            pass

    pipeline_diag: dict[str, Any] = {}
    streams: dict[str, Any] = {}
    ephemeris_svs: int | None = None
    try:
        from backend import live_manager

        pipeline_diag = live_manager.diagnostics_by_station()
        status = live_manager.status(include_record_counts=False)
        streams = status.get("streams") or {}
        gps = pipeline_diag.get("gps_ephemeris_svs")
        if isinstance(gps, int):
            ephemeris_svs = gps
    except Exception:
        pass

    measured = 0
    interpolated = 0
    station_rows: list[dict[str, Any]] = []

    for st in ZIMBABWE_CORS_STATIONS:
        code = st.code.lower().rstrip("_")
        hm_row = hm_stations.get(code) or {}
        source = str(hm_row.get("source") or "")
        obs_count = int(hm_row.get("obs_count") or 0)
        is_live = obs_count > 0 and "estimate" not in source and "surface" not in source
        is_est = "estimate" in source or "surface" in source

        vtec = fresh_vtec.get(code)
        if vtec is None and isinstance(hm_row.get("vtec"), (int, float)):
            vtec = float(hm_row["vtec"])

        if is_live:
            measured += 1
        elif is_est:
            interpolated += 1

        stream = streams.get(code)
        blocker = _station_blocker(
            code=code,
            has_fresh_vtec=code in fresh_vtec,
            stream=stream,
            diag=pipeline_diag.get(code) if isinstance(pipeline_diag.get(code), dict) else None,
        )

        source_label = "none"
        if code in fresh_vtec or is_live:
            source_label = "live"
        elif is_est:
            source_label = "estimate"

        station_rows.append(
            {
                "station": code,
                "name": st.name,
                "vtec": round(vtec, 2) if vtec is not None else None,
                "source": source_label,
                "obs_age_s": newest_age if code in fresh_vtec else None,
                "blocker": blocker,
            }
        )

    fresh_count = len(fresh_vtec)
    live_available = fresh_count >= 1 and (newest_age is None or newest_age <= _FRESH_OBS_S)
    degraded = bool(global_blockers) or not live_available

    degraded_reason: str | None = None
    if not live_available:
        if not collector_running and external_collector:
            degraded_reason = "NTRIP collector is not running — start scripts/run_local_live.sh"
        elif newest_age is not None and newest_age > _FRESH_OBS_S:
            degraded_reason = f"Newest live observation is {int(newest_age)}s old"
        elif fresh_count == 0:
            degraded_reason = "No fresh live NTRIP VTEC in the last few minutes"
    elif global_blockers:
        degraded_reason = "; ".join(global_blockers)

    message: str | None = None
    if live_available:
        message = (
            f"Live NTRIP VTEC on {fresh_count} site(s)"
            + (f" · newest obs {int(newest_age)}s ago" if newest_age is not None else "")
        )
    elif degraded_reason:
        message = degraded_reason

    return {
        "live_available": live_available,
        "degraded": degraded,
        "db_backend": db_backend,
        "collector_running": collector_running,
        "collector_expected": external_collector or collector_running,
        "stations_with_fresh_vtec": fresh_count,
        "stations_measured_live": measured,
        "stations_interpolated": interpolated,
        "newest_obs_age_s": newest_age,
        "degraded_reason": degraded_reason,
        "blockers": global_blockers,
        "stations": station_rows,
        "ephemeris_svs": ephemeris_svs,
        "heatmap_available": bool(hm.get("available")),
        "message": message,
    }
