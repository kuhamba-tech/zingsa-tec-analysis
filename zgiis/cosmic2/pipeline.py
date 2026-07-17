"""COSMIC-2 Phase 1 orchestration: download, extract, QC, compute
parameters, match to Zimbabwe CORS, calibrate, and persist.

CORS VTEC loading is a small self-contained dual-source loader (live TecDB
first, historical archive CSV fallback) mirroring the pattern in
zgiis/gnss_prn/prn_data.py — this branch does not include the separately
developed zgiis/tec_intelligence package (different feature branch), so it
is not imported here.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from zgiis.cosmic2.archive_client import fetch_and_extract_daily
from zgiis.cosmic2.calibration import fit_ols_calibration
from zgiis.cosmic2.matching import is_in_box, match_profile_to_cors
from zgiis.cosmic2.models import Cosmic2Config
from zgiis.cosmic2.netcdf_reader import NetcdfSchemaError, read_profile
from zgiis.cosmic2.profile_parameters import ProfileParameters, compute_profile_parameters
from zgiis.cosmic2.quality import evaluate_profile
from zgiis.cosmic2.schemas import daterange

log = logging.getLogger(__name__)


def _load_cors_observations(start: date, end: date) -> tuple[pd.DataFrame, str]:
    """All-station VTEC observations for the range: live TecDB first,
    historical archive CSV fallback. Returns (df[station,timestamp,vtec], source)."""
    start_ts = pd.Timestamp(start, tz="UTC")
    end_ts = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)

    try:
        from zgiis.db.timescale import TecDB

        hours = max(1.0, (datetime.now(timezone.utc) - start_ts.to_pydatetime()).total_seconds() / 3600.0)
        db = TecDB()
        try:
            raw = db.query_recent(hours=hours)
        finally:
            db.close()
        if not raw.empty:
            live = raw.rename(columns={"time": "timestamp", "vtec_tecu": "vtec"}).copy()
            live["timestamp"] = pd.to_datetime(live["timestamp"], utc=True, errors="coerce")
            live["station"] = live["station"].astype(str).str.lower()
            live["vtec"] = pd.to_numeric(live["vtec"], errors="coerce")
            live = live[(live["timestamp"] >= start_ts) & (live["timestamp"] < end_ts)]
            live = live.dropna(subset=["timestamp", "vtec"])
            if not live.empty:
                return live[["station", "timestamp", "vtec"]].reset_index(drop=True), "live"
    except Exception as exc:
        log.debug("Live CORS VTEC load failed: %s", exc)

    try:
        from zgiis.data.tec_archive import load_historical_tec

        archive_df, _ = load_historical_tec()
        if not archive_df.empty:
            archive = archive_df.copy()
            archive["timestamp"] = pd.to_datetime(archive["timestamp"], utc=True, errors="coerce")
            archive["station"] = archive["station"].astype(str).str.lower()
            archive["vtec"] = pd.to_numeric(archive["vtec"], errors="coerce")
            archive = archive[(archive["timestamp"] >= start_ts) & (archive["timestamp"] < end_ts)]
            archive = archive.dropna(subset=["timestamp", "vtec"])
            if not archive.empty:
                return archive[["station", "timestamp", "vtec"]].reset_index(drop=True), "archive"
    except Exception as exc:
        log.debug("Archive CORS VTEC load failed: %s", exc)

    return pd.DataFrame(columns=["station", "timestamp", "vtec"]), "none"


def analyse_range(
    start: date, end: date, *, config: Cosmic2Config | None = None, force_redownload: bool = False
) -> dict[str, Any]:
    """The only writer in this module. Downloads/extracts real ionPrf
    tarballs, QCs and computes profile parameters, matches to Zimbabwe CORS,
    fits one OLS calibration across the range, and persists all of it."""
    config = config or Cosmic2Config()
    span_days = (end - start).days + 1
    if span_days > config.max_analyse_days:
        raise ValueError(
            f"Date range too large for synchronous processing ({span_days} days, "
            f"max {config.max_analyse_days}); choose a smaller range."
        )

    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    days = daterange(start, end, max_days=config.max_analyse_days)
    obs_df, obs_source = _load_cors_observations(start, end)

    profile_rows: list[dict[str, Any]] = []
    match_rows: list[dict[str, Any]] = []
    files_checked = 0
    files_downloaded = 0
    profiles_found = 0
    profiles_valid = 0
    profiles_matched = 0
    stations_used: set[str] = set()
    warnings: list[str] = []

    for day in days:
        files_checked += 1
        extract = fetch_and_extract_daily(day, force=force_redownload)
        if extract.download.status == "downloaded":
            files_downloaded += 1
        if extract.status != "ok":
            warnings.append(f"{day.isoformat()}: {extract.note}")
            continue

        for profile_path in extract.profile_files:
            try:
                raw = read_profile(profile_path)
            except NetcdfSchemaError as exc:
                warnings.append(f"{profile_path.name}: {exc}")
                continue
            except Exception as exc:
                warnings.append(f"{profile_path.name}: unexpected read error: {exc}")
                continue

            if not is_in_box(raw.tangent_lat, raw.tangent_lon, config=config):
                continue  # out-of-box profiles are never persisted (see plan)

            profiles_found += 1
            qc = evaluate_profile(raw, config=config)
            params = ProfileParameters(None, None, None, None, None, None)
            if qc.status == "ok":
                profiles_valid += 1
                params = compute_profile_parameters(qc.cleaned_altitude_km, qc.cleaned_density_m3)

            profile_rows.append({
                "profile_id": raw.profile_id,
                "day": day.isoformat(),
                "occ_time": raw.occ_time.isoformat(),
                "tangent_lat": raw.tangent_lat,
                "tangent_lon": raw.tangent_lon,
                "source_file": raw.source_file,
                "quality_status": qc.status,
                "quality_reasons": ",".join(qc.reasons),
                "valid_sample_count": qc.valid_sample_count,
                "nmf2_el_m3": params.nmf2_el_m3,
                "hmf2_km": params.hmf2_km,
                "fof2_mhz": params.fof2_mhz,
                "partial_tec_tecu": params.partial_tec_tecu,
                "tec_integration_min_km": params.integration_min_km,
                "tec_integration_max_km": params.integration_max_km,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            })

            if qc.status == "ok" and params.partial_tec_tecu is not None:
                match = match_profile_to_cors(
                    raw.tangent_lat, raw.tangent_lon, raw.occ_time, obs_df, ZIMBABWE_CORS_STATIONS, config=config
                )
                if match.match_valid:
                    profiles_matched += 1
                    if match.station_code:
                        stations_used.add(match.station_code)
                match_rows.append({
                    "profile_id": raw.profile_id,
                    "day": day.isoformat(),
                    "station_code": match.station_code,
                    "station_distance_km": match.station_distance_km,
                    "cors_timestamp": match.cors_timestamp,
                    "cors_vtec_tecu": match.cors_vtec_tecu,
                    "time_delta_minutes": match.time_delta_minutes,
                    "match_valid": match.match_valid,
                    "match_quality": match.match_quality,
                    "match_reason": match.match_reason,
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                })

    partial_tec_by_id = {p["profile_id"]: p["partial_tec_tecu"] for p in profile_rows}
    valid_matches = [m for m in match_rows if m["match_valid"]]
    x = np.array([partial_tec_by_id[m["profile_id"]] for m in valid_matches], dtype=float)
    y = np.array([m["cors_vtec_tecu"] for m in valid_matches], dtype=float)
    calib = fit_ols_calibration(x, y, min_samples=config.min_calibration_samples)

    calibration_row = {
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "slope": calib.slope, "intercept": calib.intercept, "r_squared": calib.r_squared,
        "pearson_r": calib.pearson_r, "rmse_tecu": calib.rmse_tecu, "mae_tecu": calib.mae_tecu,
        "mean_bias_tecu": calib.mean_bias_tecu, "sample_count": calib.sample_count,
        "status": calib.status, "message": calib.message,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        if profile_rows:
            db.upsert_profiles(profile_rows, start, end)
        if match_rows:
            db.upsert_matches(match_rows, start, end)
        db.upsert_calibration_run(calibration_row)
    finally:
        db.close()

    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "files_checked": files_checked, "files_downloaded": files_downloaded,
        "profiles_found": profiles_found, "profiles_valid": profiles_valid, "profiles_matched": profiles_matched,
        "cors_stations_used": len(stations_used), "cors_observation_source": obs_source,
        "calibration": calibration_row, "warnings": warnings, "status": "complete",
    }


def get_status() -> dict[str, Any]:
    from zgiis.cosmic2.archive_client import LEVEL2_URL
    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        counts = db.summary_counts()
    finally:
        db.close()
    return {
        "source": "UCAR COSMIC-2 provisional Level-2 ionPrf",
        "level2_url": LEVEL2_URL + "/",
        **counts,
    }


def list_profiles(start: date, end: date, *, quality_status: str | None = None) -> list[dict[str, Any]]:
    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        df = db.query_profiles(start, end, quality_status=quality_status)
    finally:
        db.close()
    return df.to_dict("records") if not df.empty else []


def get_profile(profile_id: str) -> dict[str, Any] | None:
    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        return db.query_profile(profile_id)
    finally:
        db.close()


def list_matches(start: date, end: date, *, match_quality: str | None = None) -> list[dict[str, Any]]:
    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        df = db.query_matches(start, end, match_quality=match_quality)
    finally:
        db.close()
    return df.to_dict("records") if not df.empty else []


def get_latest_calibration(start: date | None = None, end: date | None = None) -> dict[str, Any] | None:
    from zgiis.db.cosmic2_db import Cosmic2DB

    db = Cosmic2DB()
    try:
        return db.query_latest_calibration(start=start, end=end)
    finally:
        db.close()
