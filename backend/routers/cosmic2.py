"""COSMIC-2 Zimbabwe research module (Phase 1): real ionPrf profile
ingestion, quality control, NmF2/hmF2/foF2/partial-TEC calculation, CORS
matching, and OLS calibration.

Distinct from /tec/cosmic2-analysis (backend/routers/tec.py), which stays
unchanged and keeps doing archive-coverage checks only. No frontend wiring,
no maps, no IRI-2020/Madimbo numeric comparison, no background-job
architecture, no exports this round — see the implementation plan.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import (
    Cosmic2AnalyseRequest,
    Cosmic2AnalyseResponse,
    Cosmic2CalibrationResponse,
    Cosmic2CalibrationResult,
    Cosmic2Match,
    Cosmic2MatchListResponse,
    Cosmic2Profile,
    Cosmic2ProfileListResponse,
    Cosmic2StatusResponse,
)

router = APIRouter(prefix="/cosmic2", tags=["cosmic2"])


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc


def _stringify_dates(row: dict) -> dict:
    """Postgres returns native datetime.date/Timestamp objects via
    pd.read_sql; SQLite returns the TEXT already stored. Both need to end
    up as plain strings for the Pydantic response models.

    NULL datetime columns come back as pandas NaT, which has an
    .isoformat() method that returns the literal string "NaT" rather than
    raising — must check for NA before calling isoformat, or a missing
    timestamp silently becomes the text "NaT" instead of null."""
    import pandas as pd

    out: dict = {}
    for key, value in row.items():
        if value is None:
            out[key] = None
        elif hasattr(value, "isoformat"):
            out[key] = None if pd.isna(value) else value.isoformat()
        elif isinstance(value, float) and pd.isna(value):
            out[key] = None
        else:
            out[key] = value
    return out


@router.get("/status", response_model=Cosmic2StatusResponse)
async def status(_=Depends(require_api_key)):
    from zgiis.cosmic2.pipeline import get_status

    try:
        payload = get_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 status read failed: {exc}") from exc
    return Cosmic2StatusResponse(**payload)


@router.get("/profiles", response_model=Cosmic2ProfileListResponse)
async def profiles(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    quality_status: str | None = Query(None),
    _=Depends(require_api_key),
):
    start_d = _parse_date(start)
    end_d = _parse_date(end)

    from zgiis.cosmic2.pipeline import list_profiles

    try:
        rows = list_profiles(start_d, end_d, quality_status=quality_status)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 profiles read failed: {exc}") from exc
    return Cosmic2ProfileListResponse(
        start=start, end=end, quality_status=quality_status,
        profiles=[Cosmic2Profile(**_stringify_dates(r)) for r in rows],
    )


@router.get("/profiles/{profile_id}", response_model=Cosmic2Profile)
async def profile_detail(profile_id: str, _=Depends(require_api_key)):
    from zgiis.cosmic2.pipeline import get_profile

    try:
        row = get_profile(profile_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 profile read failed: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail=f"No COSMIC-2 profile found for id {profile_id!r}")
    return Cosmic2Profile(**_stringify_dates(row))


@router.get("/matches", response_model=Cosmic2MatchListResponse)
async def matches(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    match_quality: str | None = Query(None),
    _=Depends(require_api_key),
):
    start_d = _parse_date(start)
    end_d = _parse_date(end)

    from zgiis.cosmic2.pipeline import list_matches

    try:
        rows = list_matches(start_d, end_d, match_quality=match_quality)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 matches read failed: {exc}") from exc
    return Cosmic2MatchListResponse(
        start=start, end=end, match_quality=match_quality,
        matches=[Cosmic2Match(**_stringify_dates(r)) for r in rows],
    )


@router.get("/calibration", response_model=Cosmic2CalibrationResponse)
async def calibration(
    start: str | None = Query(None, description="Start date YYYY-MM-DD"),
    end: str | None = Query(None, description="End date YYYY-MM-DD"),
    _=Depends(require_api_key),
):
    start_d = _parse_date(start) if start else None
    end_d = _parse_date(end) if end else None

    from zgiis.cosmic2.pipeline import get_latest_calibration

    try:
        row = get_latest_calibration(start=start_d, end=end_d)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 calibration read failed: {exc}") from exc
    return Cosmic2CalibrationResponse(calibration=Cosmic2CalibrationResult(**_stringify_dates(row)) if row else None)


@router.post("/analyse", response_model=Cosmic2AnalyseResponse)
async def analyse(body: Cosmic2AnalyseRequest, _=Depends(require_api_key)):
    """The only writer: downloads/extracts real ionPrf tarballs, QCs and
    computes profile parameters, matches to Zimbabwe CORS, and fits one OLS
    calibration across the range."""
    start_d = _parse_date(body.start)
    end_d = _parse_date(body.end)

    from zgiis.cosmic2.pipeline import analyse_range

    try:
        payload = analyse_range(start_d, end_d, force_redownload=body.force_redownload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"COSMIC-2 analysis failed: {exc}") from exc

    calib = payload.get("calibration")
    return Cosmic2AnalyseResponse(
        **{k: v for k, v in payload.items() if k != "calibration"},
        calibration=Cosmic2CalibrationResult(**calib) if calib else None,
    )
