"""GIC Monitor API — ZETDC grid geomagnetically induced current monitoring.

Data flow (per the ZINGSA/ZETDC field architecture): GMW CPCO clamp sensor
on the transformer neutral → Campbell CR1000 datalogger → Raspberry Pi 4
gateway → 4G/LTE → POST /gic/ingest (live path), or TOA5/CSV file upload
via POST /gic/upload (offline path). No demo data: endpoints return empty
series until real measurements have been ingested.
"""
from __future__ import annotations

from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.deps import require_api_key

router = APIRouter(prefix="/gic", tags=["gic"])

_db_instance = None


def _db():
    global _db_instance
    if _db_instance is None:
        from zgiis.db.gic_db import GicDB
        _db_instance = GicDB()
    return _db_instance


# ── Network / infrastructure ──────────────────────────────────────────────────
@router.get("/network")
async def network(_=Depends(require_api_key)) -> dict[str, Any]:
    from zgiis.gic.network import LINES, MONITORING_STATIONS, RISK_BANDS, SUBSTATIONS

    by_code = {s["code"]: s for s in SUBSTATIONS}
    lines = [
        {
            "from": l["from"],
            "to": l["to"],
            "kv": l["kv"],
            "coords": [
                [by_code[l["from"]]["lat"], by_code[l["from"]]["lon"]],
                [by_code[l["to"]]["lat"], by_code[l["to"]]["lon"]],
            ],
        }
        for l in LINES
    ]
    return {
        "substations": SUBSTATIONS,
        "lines": lines,
        "monitoring_stations": MONITORING_STATIONS,
        "risk_bands": RISK_BANDS,
    }


# ── Status ────────────────────────────────────────────────────────────────────
@router.get("/status")
async def status(_=Depends(require_api_key)) -> dict[str, Any]:
    from zgiis.gic.network import MONITORING_STATIONS, classify_gic

    summaries = {s["station_id"]: s for s in _db().station_summaries()}
    stations: list[dict[str, Any]] = []

    ids = list(summaries.keys())
    for m in MONITORING_STATIONS:
        if m["station_id"] not in ids:
            ids.append(m["station_id"])

    registry = {m["station_id"]: m for m in MONITORING_STATIONS}
    for sid in sorted(ids):
        s = summaries.get(sid)
        meta = registry.get(sid, {})
        latest = s["latest_gic_a"] if s else None
        band = classify_gic(abs(latest)) if latest is not None else None
        stations.append({
            "station_id": sid,
            "name": meta.get("name", sid),
            "substation": meta.get("substation"),
            "sensor": meta.get("sensor"),
            "datalogger": meta.get("datalogger"),
            "gateway": meta.get("gateway"),
            "record_count": s["count"] if s else 0,
            "first_sample": s["first"] if s else None,
            "last_sample": s["last"] if s else None,
            "latest_gic_a": latest,
            "latest_level": band["level"] if band else None,
            "has_data": bool(s),
        })

    return {"stations": stations, "total_records": _db().record_count()}


# ── Ingest (live path from Raspberry Pi gateway) ─────────────────────────────
class GicReading(BaseModel):
    time: str = Field(..., description="ISO-8601 UTC timestamp")
    gic_a: float = Field(..., description="Transformer neutral DC current (A)")
    temp_c: Optional[float] = None


class GicIngestBody(BaseModel):
    station_id: str
    readings: list[GicReading]


@router.post("/ingest", status_code=201)
async def ingest(body: GicIngestBody, _=Depends(require_api_key)) -> dict[str, Any]:
    if not body.readings:
        raise HTTPException(status_code=400, detail="No readings supplied.")
    rows = [
        {
            "time": r.time,
            "station_id": body.station_id,
            "gic_a": r.gic_a,
            "temp_c": r.temp_c,
            "source": "gateway",
        }
        for r in body.readings
    ]
    inserted = _db().insert_rows(rows)
    return {"received": len(rows), "inserted": inserted, "station_id": body.station_id.upper()}


# ── Upload (offline path: CR1000 TOA5 / CSV files) ───────────────────────────
@router.post("/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    station_id: str = Form(...),
    _=Depends(require_api_key),
) -> dict[str, Any]:
    from zgiis.gic.ingest import parse_gic_file

    content = await file.read()
    try:
        rows = parse_gic_file(content, file.filename or "upload.csv", station_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    inserted = _db().insert_rows(rows)
    times = [r["time"] for r in rows]
    return {
        "filename": file.filename,
        "station_id": station_id.upper(),
        "parsed": len(rows),
        "inserted": inserted,
        "from": min(times),
        "to": max(times),
    }


# ── Series (observed + EKF overlay + space-weather context) ─────────────────
def _sw_context(hours: float) -> pd.DataFrame:
    try:
        from backend.space_weather_logger import get_db
        return get_db().query_dataframe(hours=hours)
    except Exception:
        return pd.DataFrame()


@router.get("/series")
async def series(
    station_id: str,
    hours: float = 24.0,
    resample: str | None = None,
    _=Depends(require_api_key),
) -> dict[str, Any]:
    from zgiis.db.ekf_alert_db import EkfAlertDB
    from zgiis.gic.ekf_context import evaluate_gic_with_context
    from zgiis.space_weather.ekf import run_ekf_series

    df = _db().query_dataframe(station_id=station_id, hours=hours, resample=resample)

    points: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []
    banner = None
    deviation = None

    if not df.empty:
        times = pd.to_datetime(df["time"], utc=True)
        labels = [t.isoformat() for t in times]
        obs = [round(float(v), 4) for v in df["gic_a"]]

        ekf_points = run_ekf_series(list(zip(labels, obs)), "gic")

        # Rate of change (A/min) — the GIC analogue of dB/dt, indicating how
        # impulsive the driving geomagnetic variation is.
        rate: list[float | None] = [None]
        for i in range(1, len(obs)):
            dt_min = (times.iloc[i] - times.iloc[i - 1]).total_seconds() / 60.0
            rate.append(round((obs[i] - obs[i - 1]) / dt_min, 4) if dt_min > 0 else None)

        for i, p in enumerate(ekf_points):
            points.append({
                "t": p.t,
                "observed": p.observed,
                "predicted": p.predicted,
                "error": p.error,
                "confidence": p.confidence,
                "rate_a_per_min": rate[i] if i < len(rate) else None,
            })

        # EKF deviation alerting — cross-check GIC with Kp/Dst/S4/solar-wind context.
        sw_df = _sw_context(hours)
        result = evaluate_gic_with_context(ekf_points, sw_df)
        deviation = result["status"]
        if result["alerts"]:
            db = EkfAlertDB()
            stored = [db.insert_if_new(a) for a in result["alerts"]]
            alerts = stored
            worst = stored[0]
            banner = (
                f"⚠ Possible geomagnetic disturbance detected: {worst['parameter_label']} "
                f"at {station_id.upper()} differs significantly from EKF prediction. "
                "Check Kp, Dst, TEC and solar wind conditions."
            )

    # Kp/Dst context over the same window (independent series for frontend charts).
    if "sw_df" not in locals():
        sw_df = _sw_context(hours)
    context = []
    if not sw_df.empty:
        for _, r in sw_df.iterrows():
            t = r["time"]
            context.append({
                "t": t.isoformat() if hasattr(t, "isoformat") else str(t),
                "kp": None if pd.isna(r.get("kp")) else round(float(r["kp"]), 2),
                "dst": None if pd.isna(r.get("dst")) else round(float(r["dst"]), 1),
            })

    return {
        "station_id": station_id.upper(),
        "hours": hours,
        "resample": resample,
        "count": len(points),
        "points": points,
        "space_weather": context,
        "deviation": deviation,
        "alerts": alerts,
        "banner": banner,
    }


# ── Live modelled GIC (plane-wave estimate from live magnetometer data) ─────
@router.get("/live-model")
async def live_model(hours: float = 24.0, _=Depends(require_api_key)) -> dict[str, Any]:
    from zgiis.gic.live_model import build_live_model

    return build_live_model(hours=hours)


# ── Reports ───────────────────────────────────────────────────────────────────
@router.get("/report")
async def report(
    station_id: str,
    period: str = "daily",
    format: str = "json",
    _=Depends(require_api_key),
):
    from zgiis.gic.analysis import REPORT_PERIODS, build_report, report_to_csv

    if period not in REPORT_PERIODS:
        raise HTTPException(
            status_code=422,
            detail=f"period must be one of: {', '.join(REPORT_PERIODS)}",
        )

    meta = REPORT_PERIODS[period]
    df = _db().query_dataframe(
        station_id=station_id,
        hours=meta["hours"],
        resample=meta.get("resample"),
    )
    sw_df = _sw_context(meta["hours"])
    result = build_report(df, station_id=station_id.upper(), period=period, sw_df=sw_df)

    if format == "csv":
        csv_text = report_to_csv(result, df)
        fname = f"gic_{station_id.lower()}_{period}_report.csv"
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    return result
