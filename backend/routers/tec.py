from __future__ import annotations

from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, Query

from backend.deps import require_api_key
from backend.schemas import (
    ArchiveMeta,
    AnomalyAnalysisResponse,
    AnomalyDay,
    CelestrakAnalysisResponse,
    DiurnalPoint,
    EiaSummary,
    GeomagneticDailyPoint,
    GfzKpAnalysisResponse,
    GuviOn2Response,
    IntermagnetAnalysisResponse,
    OmniAnalysisResponse,
    StormComparisonDoy,
    WdcKyotoAnalysisResponse,
    PrnExplorerResponse,
    PrnMeta,
    PrnObservation,
    PrnRow,
    SeasonalRow,
    SolarCycleRow,
    TecHeatmapGrid,
    TecHeatmapDiagnostics,
    TecHeatmapPoint,
    TecHeatmapResponse,
    TecHeatmapStation,
    TecObservation,
)

router = APIRouter(prefix="/tec", tags=["tec"])


@lru_cache(maxsize=1)
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


def _vtec_by_date(start: str, end: str, station: str | None) -> dict[str, float]:
    df = _archive()
    if df.empty:
        return {}
    work = df.copy()
    if "date" in work.columns:
        work["timestamp"] = pd.to_datetime(work["date"])
    if station and "station" in work.columns:
        work = work[work["station"] == station]
    work = work[
        (work["timestamp"] >= pd.Timestamp(start))
        & (work["timestamp"] <= pd.Timestamp(end))
    ]
    if work.empty:
        return {}
    work["day"] = work["timestamp"].dt.strftime("%Y-%m-%d")
    daily = work.groupby("day")["vtec"].mean()
    return {str(k): round(float(v), 2) for k, v in daily.items() if pd.notna(v)}


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

    vtec_by_date = _vtec_by_date(start, end, station)
    payload = build_analysis(omni_rows, vtec_by_date)
    return OmniAnalysisResponse(**payload)


@router.get("/celestrak-analysis", response_model=CelestrakAnalysisResponse)
async def celestrak_analysis(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Fetch CelesTrak space-weather indices (SSN, Kp, Ap, F10.7) and correlate with archived VTEC."""
    try:
        start_d = date.fromisoformat(start[:10])
        end_d = date.fromisoformat(end[:10])
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc

    from zgiis.space_weather.celestrak_client import build_analysis as build_celestrak_analysis, fetch_celestrak_daily

    try:
        celestrak_rows = fetch_celestrak_daily(start_d, end_d)
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"CelesTrak fetch failed: {exc}") from exc

    vtec_by_date = _vtec_by_date(start, end, station)
    payload = build_celestrak_analysis(celestrak_rows, vtec_by_date)
    return CelestrakAnalysisResponse(**payload)


@router.get("/gfz-kp-analysis", response_model=GfzKpAnalysisResponse)
async def gfz_kp_analysis(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Fetch GFZ Potsdam Kp/ap/Ap/Cp indices and correlate with archived VTEC."""
    try:
        start_d = date.fromisoformat(start[:10])
        end_d = date.fromisoformat(end[:10])
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc

    from zgiis.space_weather.gfz_kp_client import build_analysis as build_gfz_analysis, fetch_gfz_daily

    try:
        rows = fetch_gfz_daily(start_d, end_d)
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"GFZ Kp fetch failed: {exc}") from exc

    vtec_by_date = _vtec_by_date(start, end, station)
    payload = build_gfz_analysis(rows, vtec_by_date)
    return GfzKpAnalysisResponse(**payload)


@router.get("/wdc-kyoto-analysis", response_model=WdcKyotoAnalysisResponse)
async def wdc_kyoto_analysis(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Fetch WDC Kyoto Dst and definitive Kp/ap/Ap indices; correlate with archived VTEC."""
    try:
        start_d = date.fromisoformat(start[:10])
        end_d = date.fromisoformat(end[:10])
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc

    from zgiis.space_weather.wdc_kyoto_client import build_analysis as build_kyoto_analysis, fetch_kyoto_daily

    try:
        rows = fetch_kyoto_daily(start_d, end_d)
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"WDC Kyoto fetch failed: {exc}") from exc

    vtec_by_date = _vtec_by_date(start, end, station)
    payload = build_kyoto_analysis(rows, vtec_by_date)
    return WdcKyotoAnalysisResponse(**payload)


@router.get("/intermagnet-analysis", response_model=IntermagnetAnalysisResponse)
async def intermagnet_analysis(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    observatory: str = Query("HER", description="IAGA observatory code (HER, HBK, TSU, KMH)"),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    """Fetch INTERMAGNET ground-magnetometer minute data (BGS GIN), aggregate to
    daily H-field statistics and dB/dt-based storm days, and correlate with archived VTEC."""
    from fastapi import HTTPException

    try:
        start_d = date.fromisoformat(start[:10])
        end_d = date.fromisoformat(end[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid date format; use YYYY-MM-DD") from exc

    from zgiis.space_weather.intermagnet_client import (
        build_analysis as build_intermagnet_analysis,
        fetch_intermagnet_daily,
    )

    try:
        rows = fetch_intermagnet_daily(observatory, start_d, end_d)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"INTERMAGNET fetch failed: {exc}") from exc

    vtec_by_date = _vtec_by_date(start, end, station)
    payload = build_intermagnet_analysis(rows, vtec_by_date, observatory=observatory)
    return IntermagnetAnalysisResponse(**payload)


@router.get("/guvi-on2", response_model=GuviOn2Response)
async def guvi_on2(
    start: str | None = Query(None, description="Start date YYYY-MM-DD"),
    end: str | None = Query(None, description="End date YYYY-MM-DD"),
    _=Depends(require_api_key),
):
    """Return TIMED/GUVI thermospheric O/N2 overpass context for Africa."""
    from zgiis.space_weather.guvi_on2 import build_guvi_on2_payload

    payload = build_guvi_on2_payload(start=start, end=end)
    return GuviOn2Response(**payload)


@router.get("/anomalies", response_model=list[AnomalyDay])
async def anomalies(
    threshold_pct: int = Query(95, ge=50, le=99),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    from zgiis.processing.anomaly_analysis import build_anomaly_analysis

    payload = build_anomaly_analysis(_archive(), station=station, threshold_pct=threshold_pct)
    return [AnomalyDay(**day) for day in payload["days"]]


@router.get("/anomaly-analysis", response_model=AnomalyAnalysisResponse)
async def anomaly_analysis(
    threshold_pct: int = Query(95, ge=50, le=99),
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    from zgiis.processing.anomaly_analysis import build_anomaly_analysis

    payload = build_anomaly_analysis(_archive(), station=station, threshold_pct=threshold_pct)
    return AnomalyAnalysisResponse(
        days=[AnomalyDay(**day) for day in payload["days"]],
        storm_comparison=[StormComparisonDoy(**row) for row in payload["storm_comparison"]],
        eia=EiaSummary(**payload["eia"]),
        stations=payload["stations"],
        kp_available=payload["kp_available"],
        dst_available=payload["dst_available"],
        geomagnetic_daily=[GeomagneticDailyPoint(**row) for row in payload["geomagnetic_daily"]],
        diurnal=[DiurnalPoint(**row) for row in payload["diurnal"]],
        seasonal=[SeasonalRow(**row) for row in payload["seasonal"]],
        solar_cycle=[SolarCycleRow(**row) for row in payload["solar_cycle"]],
    )


@router.get("/diurnal", response_model=list[DiurnalPoint])
async def diurnal(
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    from zgiis.processing.anomaly_analysis import compute_diurnal

    rows = compute_diurnal(_archive(), station)
    return [DiurnalPoint(**row) for row in rows]


@router.get("/seasonal", response_model=list[SeasonalRow])
async def seasonal(
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    from zgiis.processing.anomaly_analysis import compute_seasonal

    rows = compute_seasonal(_archive(), station)
    return [SeasonalRow(**row) for row in rows]


@router.get("/solar-cycle", response_model=list[SolarCycleRow])
async def solar_cycle(
    station: str | None = Query(None),
    _=Depends(require_api_key),
):
    from zgiis.processing.anomaly_analysis import compute_solar_cycle

    rows = compute_solar_cycle(_archive(), station)
    return [SolarCycleRow(**row) for row in rows]


@router.get("/heatmap", response_model=TecHeatmapResponse)
async def tec_heatmap(
    hours: float = Query(2.0, ge=0.5, le=24),
    _=Depends(require_api_key),
):
    from zgiis.maps.heatmap_data import build_tec_heatmap

    payload = build_tec_heatmap(hours=hours)

    grid = payload.get("grid")
    return TecHeatmapResponse(
        available=payload["available"],
        stations=[TecHeatmapStation(**s) for s in payload["stations"]],
        heat_points=[TecHeatmapPoint(**p) for p in payload["heat_points"]],
        grid=TecHeatmapGrid(**grid) if grid else None,
        bounds=payload["bounds"],
        tec_min=payload["tec_min"],
        tec_max=payload["tec_max"],
        station_count=payload["station_count"],
        updated_at=payload["updated_at"],
        message=payload["message"],
        data_quality=payload.get("data_quality", "none"),
        icao_mod_tecu=payload.get("icao_mod_tecu", 125.0),
        icao_sev_tecu=payload.get("icao_sev_tecu", 175.0),
        diagnostics=TecHeatmapDiagnostics(**payload["diagnostics"]) if payload.get("diagnostics") else None,
    )


@router.get("/prn/explorer", response_model=PrnExplorerResponse)
async def prn_explorer(
    constellation: str | None = Query(None),
    station: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    hours: float = Query(168.0, ge=1, le=8760),
    elev_min: float = Query(20.0, ge=0, le=90),
    prns: str | None = Query(None, description="Comma-separated PRN list, e.g. G01,G02"),
    limit: int = Query(5000, ge=100, le=20000),
    _=Depends(require_api_key),
):
    from zgiis.gnss_prn.prn_data import aggregate_prn_rows, load_prn_observations

    prn_list = [p.strip() for p in prns.split(",") if p.strip()] if prns else None
    df, meta_raw = load_prn_observations(
        hours=hours,
        station=station,
        constellation=constellation,
        prns=prn_list,
        elev_min=elev_min,
        start=start,
        end=end,
        limit=limit,
    )
    meta = PrnMeta(**meta_raw)
    summary = [PrnRow(**row) for row in aggregate_prn_rows(df)]
    observations: list[PrnObservation] = []
    for _, row in df.iterrows():
        observations.append(PrnObservation(
            timestamp=str(row.get("timestamp", "")),
            station=str(row.get("station", "")),
            prn=str(row.get("prn", "")),
            constellation=str(row.get("constellation", "")) if pd.notna(row.get("constellation")) else None,
            vtec=float(row["vtec"]) if "vtec" in row and pd.notna(row["vtec"]) else None,
            stec=float(row["stec"]) if "stec" in row and pd.notna(row["stec"]) else None,
            elevation_deg=float(row["elevation_deg"]) if "elevation_deg" in row and pd.notna(row.get("elevation_deg")) else None,
            azimuth_deg=float(row["azimuth_deg"]) if "azimuth_deg" in row and pd.notna(row.get("azimuth_deg")) else None,
            quality=float(row["quality"]) if "quality" in row and pd.notna(row.get("quality")) else None,
        ))
    return PrnExplorerResponse(meta=meta, summary=summary, observations=observations)


@router.get("/prn", response_model=list[PrnRow])
async def prn(
    constellation: str | None = Query(None),
    station: str | None = Query(None),
    hours: float = Query(168.0, ge=1, le=8760),
    elev_min: float = Query(20.0, ge=0, le=90),
    _=Depends(require_api_key),
):
    from zgiis.gnss_prn.prn_data import aggregate_prn_rows, load_prn_observations

    df, _ = load_prn_observations(
        hours=hours,
        station=station,
        constellation=constellation,
        elev_min=elev_min,
        limit=20000,
    )
    if not df.empty:
        return [PrnRow(**row) for row in aggregate_prn_rows(df)]

    # Legacy archive path (non-ALL rows only)
    archive_df = _archive()
    if archive_df.empty or "prn" not in archive_df.columns:
        return []
    archive_df = archive_df[~archive_df["prn"].astype(str).str.upper().isin({"ALL", ""})]
    if constellation and "constellation" in archive_df.columns:
        archive_df = archive_df[archive_df["constellation"].str.upper() == constellation.upper()]
    if archive_df.empty:
        return []
    grp_keys = ["prn", "constellation"] if "constellation" in archive_df.columns else ["prn"]
    agg_spec: dict = {
        "mean_vtec": ("vtec", "mean"),
        "max_vtec":  ("vtec", "max"),
        "samples":   ("vtec", "count"),
    }
    if "stec" in archive_df.columns:
        agg_spec["mean_stec"] = ("stec", "mean")
    if "elevation_deg" in archive_df.columns:
        agg_spec["mean_elevation"] = ("elevation_deg", "mean")
    if "quality" in archive_df.columns:
        agg_spec["mean_qual"] = ("quality", "mean")
    grp = archive_df.groupby(grp_keys).agg(**agg_spec).reset_index()
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
