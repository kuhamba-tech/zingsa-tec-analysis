from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, Query

from backend.deps import require_api_key
from backend.schemas import (
    ArchiveMeta,
    AnomalyDay,
    DiurnalPoint,
    OmniAnalysisResponse,
    PrnRow,
    SeasonalRow,
    SolarCycleRow,
    TecObservation,
)

router = APIRouter(prefix="/tec", tags=["tec"])


def _archive() -> pd.DataFrame:
    try:
        from zgiis.data.tec_archive import load_historical_tec
        df, _ = load_historical_tec()
        return df
    except Exception:
        return pd.DataFrame()


def _archive_meta() -> dict:
    try:
        from zgiis.data.tec_archive import load_historical_tec
        _, meta = load_historical_tec()
        return meta
    except Exception:
        return {}


@router.get("/archive-meta", response_model=ArchiveMeta)
async def archive_meta(_=Depends(require_api_key)):
    df = _archive()
    meta = _archive_meta()
    return ArchiveMeta(
        available=not df.empty,
        stations=meta.get("stations", []),
        first_date=str(meta["first_date"].date()) if meta.get("first_date") is not None else None,
        last_date=str(meta["last_date"].date()) if meta.get("last_date") is not None else None,
        observations=meta.get("observations", 0),
        source_files=meta.get("source_files", 0),
        total_rows=len(df),
    )


@router.get("/time-series", response_model=list[TecObservation])
async def time_series(
    station: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    limit: int = Query(2000, le=10000),
    _=Depends(require_api_key),
):
    df = _archive()
    if df.empty:
        return []
    if "date" in df.columns:
        df["timestamp"] = pd.to_datetime(df["date"])
    if station and "station" in df.columns:
        df = df[df["station"] == station]
    if start:
        df = df[df["timestamp"] >= pd.Timestamp(start)]
    if end:
        df = df[df["timestamp"] <= pd.Timestamp(end)]
    df = df.sort_values("timestamp").tail(limit)

    result = []
    for _, row in df.iterrows():
        result.append(TecObservation(
            timestamp=str(row["timestamp"]),
            station=str(row.get("station", "")),
            vtec=float(row["vtec"]) if "vtec" in row and pd.notna(row["vtec"]) else None,
            stec=float(row["stec"]) if "stec" in row and pd.notna(row["stec"]) else None,
            constellation=str(row["constellation"]) if "constellation" in row else None,
            prn=str(row["prn"]) if "prn" in row else None,
            elevation_deg=float(row["elevation_deg"]) if "elevation_deg" in row and pd.notna(row.get("elevation_deg")) else None,
        ))
    return result


@router.get("/omni-analysis", response_model=OmniAnalysisResponse)
async def omni_analysis(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Fetch NASA OMNIWeb indices (SSN, Kp, Dst, F10.7) and correlate with archived VTEC."""
    try:
        start_d = date.fromisoformat(start[:10])
        end_d = date.fromisoformat(end[:10])
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc

    from zgiis.space_weather.omniweb_client import build_analysis, fetch_omni_daily

    try:
        omni_rows = fetch_omni_daily(start_d, end_d)
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"OMNIWeb fetch failed: {exc}") from exc

    vtec_by_date: dict[str, float] = {}
    df = _archive()
    if not df.empty:
        work = df.copy()
        if "date" in work.columns:
            work["timestamp"] = pd.to_datetime(work["date"])
        if station and "station" in work.columns:
            work = work[work["station"] == station]
        work = work[
            (work["timestamp"] >= pd.Timestamp(start))
            & (work["timestamp"] <= pd.Timestamp(end))
        ]
        if not work.empty:
            work["day"] = work["timestamp"].dt.strftime("%Y-%m-%d")
            daily = work.groupby("day")["vtec"].mean()
            vtec_by_date = {str(k): round(float(v), 2) for k, v in daily.items() if pd.notna(v)}

    payload = build_analysis(omni_rows, vtec_by_date)
    return OmniAnalysisResponse(**payload)


@router.get("/anomalies", response_model=list[AnomalyDay])
async def anomalies(
    threshold_pct: int = Query(95, ge=50, le=99),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    df = _archive()
    if df.empty:
        return []
    if station and "station" in df.columns:
        df = df[df["station"] == station]
    df["date"] = pd.to_datetime(df.get("date", df.get("timestamp")))
    daily = df.groupby("date")["vtec"].mean().reset_index()
    daily.columns = ["date", "mean_vtec"]
    threshold = float(daily["mean_vtec"].quantile(threshold_pct / 100))
    return [
        AnomalyDay(
            date=str(row["date"].date()),
            mean_vtec=float(row["mean_vtec"]),
            anomaly=bool(row["mean_vtec"] >= threshold),
            threshold=threshold,
        )
        for _, row in daily.iterrows()
    ]


@router.get("/diurnal", response_model=list[DiurnalPoint])
async def diurnal(_=Depends(require_api_key)):
    df = _archive()
    if df.empty:
        return []
    if "time_hours" in df.columns:
        df["hour"] = df["time_hours"].astype(int) % 24
    elif "timestamp" in df.columns:
        df["hour"] = pd.to_datetime(df["timestamp"]).dt.hour
    else:
        df["hour"] = pd.to_datetime(df["date"]).dt.hour
    grp = df.groupby("hour")["vtec"].agg(["mean", "std"]).reset_index()
    return [
        DiurnalPoint(hour=int(r["hour"]), mean_vtec=float(r["mean"]), std_vtec=float(r["std"] or 0))
        for _, r in grp.iterrows()
    ]


@router.get("/seasonal", response_model=list[SeasonalRow])
async def seasonal(_=Depends(require_api_key)):
    df = _archive()
    if df.empty:
        return []
    df["date"] = pd.to_datetime(df.get("date", df.get("timestamp")))
    df["month"] = df["date"].dt.month
    df["season"] = pd.cut(
        df["month"], bins=[0, 3, 6, 9, 12],
        labels=["Jan–Mar (Summer)", "Apr–Jun (Autumn)", "Jul–Sep (Winter)", "Oct–Dec (Spring)"],
    )
    grp = df.groupby("season", observed=True)["vtec"].agg(["mean", "max", "min", "std"]).reset_index()
    return [
        SeasonalRow(season=str(r["season"]), mean=float(r["mean"]), max=float(r["max"]),
                    min=float(r["min"]), std=float(r["std"] or 0))
        for _, r in grp.iterrows()
    ]


@router.get("/solar-cycle", response_model=list[SolarCycleRow])
async def solar_cycle(_=Depends(require_api_key)):
    df = _archive()
    if df.empty:
        return []
    df["date"] = pd.to_datetime(df.get("date", df.get("timestamp")))
    df["year"] = df["date"].dt.year
    grp = df.groupby("year")["vtec"].agg(["mean", "max", "min"]).reset_index()
    return [
        SolarCycleRow(year=int(r["year"]), mean_vtec=float(r["mean"]),
                      max_vtec=float(r["max"]), min_vtec=float(r["min"]))
        for _, r in grp.iterrows()
    ]


@router.get("/prn", response_model=list[PrnRow])
async def prn(
    constellation: str | None = Query(None),
    _=Depends(require_api_key),
):
    df = _archive()
    if df.empty or "prn" not in df.columns:
        return []
    if constellation and "constellation" in df.columns:
        df = df[df["constellation"].str.upper() == constellation.upper()]
    grp_keys = ["prn", "constellation"] if "constellation" in df.columns else ["prn"]
    agg_spec: dict = {
        "mean_vtec": ("vtec", "mean"),
        "max_vtec":  ("vtec", "max"),
        "samples":   ("vtec", "count"),
    }
    if "stec" in df.columns:
        agg_spec["mean_stec"] = ("stec", "mean")
    if "elevation_deg" in df.columns:
        agg_spec["mean_elevation"] = ("elevation_deg", "mean")
    if "quality" in df.columns:
        agg_spec["mean_qual"] = ("quality", "mean")
    grp = df.groupby(grp_keys).agg(**agg_spec).reset_index()
    result = []
    for _, r in grp.iterrows():
        result.append(PrnRow(
            prn=str(r["prn"]),
            constellation=str(r.get("constellation", "")),
            mean_vtec=float(r["mean_vtec"]) if pd.notna(r["mean_vtec"]) else None,
            max_vtec=float(r["max_vtec"]) if pd.notna(r.get("max_vtec", float("nan"))) else None,
            mean_stec=float(r["mean_stec"]) if "mean_stec" in r and pd.notna(r["mean_stec"]) else None,
            mean_elevation=float(r["mean_elevation"]) if "mean_elevation" in r and pd.notna(r["mean_elevation"]) else None,
            mean_qual=float(r["mean_qual"]) if "mean_qual" in r and pd.notna(r["mean_qual"]) else None,
            samples=int(r["samples"]),
        ))
    return result
