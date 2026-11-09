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
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query, Header
from datetime import datetime, timedelta, timezone
import os
import secrets
from zgiis.gic.operations import StationConfiguration, observation_summary, validate_ekf
from zgiis.gic.quality import canonical_record, valid_frame
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
    from zgiis.gic.network import (
        GENERATION_LINKS,
        LINES,
        MONITORING_STATIONS,
        POWER_PLANTS,
        RISK_BANDS,
        SUBSTATIONS,
    )

    by_code = {s["code"]: s for s in SUBSTATIONS}
    by_plant = {p["code"]: p for p in POWER_PLANTS}
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
    generation_links = [
        {
            "from": link["from"],
            "to": link["to"],
            "coords": [
                [by_plant[link["from"]]["lat"], by_plant[link["from"]]["lon"]],
                [by_code[link["to"]]["lat"], by_code[link["to"]]["lon"]],
            ],
        }
        for link in GENERATION_LINKS
        if link["from"] in by_plant and link["to"] in by_code
    ]
    return {
        "substations": SUBSTATIONS,
        "power_plants": POWER_PLANTS,
        "lines": lines,
        "generation_links": generation_links,
        "monitoring_stations": MONITORING_STATIONS,
        "risk_bands": RISK_BANDS,
        "provenance": {"status": "unverified schematic", "coordinates": "Approximate; no authoritative ZETDC coordinate register supplied", "topology": "Straight schematic connections; not surveyed line routes or a validated electrical network model", "approved": False},
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

    for station in stations:
        config = _db().station_config(station["station_id"])
        stamp = pd.Timestamp(station["last_sample"]) if station["last_sample"] else None
        age = (datetime.now(timezone.utc)-stamp.to_pydatetime()).total_seconds() if stamp is not None else None
        cadence = config.get("expected_cadence_seconds")
        station["data_age_seconds"] = age
        station["reporting"] = bool(age is not None and cadence and 0 <= age <= 3*cadence)
        if station["latest_gic_a"] is not None:
            categories = config.get("thresholds_a", [5,10,25,35])
            station["latest_level"] = ["Quiet", "Elevated", "Large", "High", "Severe"][sum(abs(station["latest_gic_a"])>=t for t in categories)]
    return {"stations": stations, "total_records": _db().record_count()}


# ── Ingest (live path from Raspberry Pi gateway) ─────────────────────────────
class GicReading(BaseModel):
    time: str = Field(..., description="ISO-8601 UTC timestamp")
    gic_a: float = Field(..., description="Transformer neutral DC current (A)")
    temp_c: Optional[float] = None
    original_time: str | None = None
    logger_timezone: str | None = None
    units: str = "A"
    calibration_id: str | None = None
    calibration: dict | None = None
    polarity_convention: str | None = None
    quality_flags: list[str] = Field(default_factory=list)
    bx_nt: float | None = None
    by_nt: float | None = None
    bz_nt: float | None = None
    clock_offset_seconds: float | None = None
    logger_record: str | None = None
    raw_fields: dict | None = None
    toa5_headers: list | None = None


class GicIngestBody(BaseModel):
    station_id: str
    readings: list[GicReading] = Field(..., min_length=1, max_length=10000)


@router.post("/ingest", status_code=201)
async def ingest(body: GicIngestBody, _=Depends(require_api_key)) -> dict[str, Any]:
    if not body.readings:
        raise HTTPException(status_code=400, detail="No readings supplied.")
    _known_station(body.station_id)
    try:
        rows = [canonical_record({**r.model_dump(), "station_id": body.station_id, "source": "gateway"}) for r in body.readings]
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        inserted = _db().insert_rows(rows)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"received": len(rows), "inserted": inserted, "station_id": body.station_id.upper()}


# ── Upload (offline path: CR1000 TOA5 / CSV files) ───────────────────────────
@router.post("/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    station_id: str = Form(...),
    logger_timezone: str | None = Form(None),
    units: str | None = Form(None),
    calibration_id: str | None = Form(None),
    _=Depends(require_api_key),
) -> dict[str, Any]:
    _known_station(station_id)
    from zgiis.gic.ingest import parse_gic_file

    content = await file.read()
    try:
        rows = parse_gic_file(content, file.filename or "upload.csv", station_id, logger_timezone=logger_timezone, units=units, calibration_id=calibration_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        inserted = _db().insert_rows(rows)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
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
    hours: float = Query(24.0, gt=0, le=8760),
    resample: str | None = None,
    _=Depends(require_api_key),
) -> dict[str, Any]:
    from zgiis.space_weather.ekf import run_ekf_series
    from zgiis.gic.analysis import _bands

    _known_station(station_id)
    df = valid_frame(_db().query_dataframe(station_id=station_id, hours=hours))

    points: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []
    banner = None
    deviation = None

    if not df.empty:
        times = pd.to_datetime(df["time"], utc=True)
        labels = [t.isoformat() for t in times]
        obs = [float(v) for v in df["gic_a"]]

        ekf_points = run_ekf_series(list(zip(labels, obs)), "gic")

        # Current derivative (A/min) is distinct from ground-field derivative (nT/min).
        rate: list[float | None] = [None]
        cadence = _db().station_config(station_id).get("expected_cadence_seconds")
        for i in range(1, len(obs)):
            dt_min = (times.iloc[i] - times.iloc[i - 1]).total_seconds() / 60.0
            rate.append(round((obs[i] - obs[i - 1]) / dt_min, 4) if cadence and 0 < dt_min * 60 <= cadence * 1.5 else None)

        for i, p in enumerate(ekf_points):
            points.append({
                "t": p.t,
                "observed": obs[i],
                "predicted": None,
                "error": p.error,
                "confidence": None,
                "rate_a_per_min": rate[i] if i < len(rate) else None,
            })

        # Residual evaluation is research-only until independent validation and engineering approval.
        # GET never persists or dispatches prediction-based warnings.
        deviation = None

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
        "resample": None,
        "monitoring_bands": _bands(_db().station_config(station_id)),
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
        resample=None,
    )
    sw_df = _sw_context(meta["hours"])
    _known_station(station_id)
    result = build_report(df, station_id=station_id.upper(), period=period, sw_df=sw_df, configuration=_db().station_config(station_id))

    if format == "csv":
        csv_text = report_to_csv(result, df)
        fname = f"gic_{station_id.lower()}_{period}_report.csv"
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    return result


def _known_station(station_id: str):
    from zgiis.gic.network import MONITORING_STATIONS
    if station_id.upper() not in {m["station_id"] for m in MONITORING_STATIONS}:
        raise HTTPException(422, "Station must be in the monitoring registry")


def _gic_admin(key: str | None = Header(None, alias="X-GIC-Admin-Key")):
    expected = os.getenv("GIC_ADMIN_KEY", "")
    if not expected:
        raise HTTPException(503, "GIC administrator credentials are not configured")
    if not key or not secrets.compare_digest(key, expected):
        raise HTTPException(403, "GIC administrator credentials required")


@router.get("/configuration")
def configuration(station_id: str, _=Depends(require_api_key)):
    _known_station(station_id)
    return StationConfiguration(**_db().station_config(station_id)).model_dump()


@router.put("/configuration")
def save_configuration(station_id: str, body: StationConfiguration, _=Depends(_gic_admin)):
    _known_station(station_id)
    _db().save_station_config(station_id, body.model_dump())
    return {"station_id": station_id.upper(), "configuration": body.model_dump(), "persisted": True}


@router.get("/assessment")
def assessment(hours: float = Query(24, gt=0, le=8760), _=Depends(require_api_key)):
    from zgiis.gic.network import MONITORING_STATIONS
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    result = []
    synchronized = {}
    for station in MONITORING_STATIONS:
        sid = station["station_id"]
        config = StationConfiguration(**_db().station_config(sid)).model_dump()
        raw = _db().query_dataframe(station_id=sid, start=start.isoformat(), end=now.isoformat())
        data = valid_frame(raw)
        summary = observation_summary(raw, config, start, now)
        receipt = _db().receipt(sid)
        last = data.iloc[-1] if not data.empty else None
        age = (now - pd.Timestamp(last.time).to_pydatetime()).total_seconds() if last is not None else None
        metadata = (last.get("metadata") or {}) if last is not None else {}
        last_clock = metadata.get("clock_offset_seconds")
        observed_alerts = []
        thresholds = config["thresholds_a"]
        if last is not None and abs(last.gic_a) >= thresholds[0]:
            observed_alerts.append({"kind": "observed_current", "time": pd.Timestamp(last.time).isoformat(),
                "current_a": float(last.gic_a), "magnitude_a": abs(float(last.gic_a)),
                "polarity": "positive" if last.gic_a > 0 else "negative", "quality": "No supplied exclusion flags",
                "category": sum(abs(last.gic_a) >= threshold for threshold in thresholds),
                "provisional": not bool(config["engineer_approval_reference"]),
                "fresh": bool(age is not None and config["expected_cadence_seconds"] and age <= 3 * config["expected_cadence_seconds"]),
                "transformer_id": config["transformer_id"], "engineering_action_authorized": bool(config["commissioned"] and config["engineer_approval_reference"]),
                "duration_seconds": summary["above_event_threshold_seconds"]})
        for row in data.itertuples():
            stamp = pd.Timestamp(row.time).isoformat()
            synchronized.setdefault(stamp, {"t": stamp})[sid] = float(row.gic_a)
        result.append({"station_id": sid, "name": station["name"], **summary,
            "configuration": config, "latest_valid_observation": pd.Timestamp(last.time).isoformat() if last is not None else None,
            "data_age_seconds": age, "latest_stored_measurement": pd.Timestamp(raw.time.max()).isoformat() if not raw.empty else None,
            "sensor_health": "Commissioning and calibration unverified" if not config["commissioned"] else "No exclusion flags" if last is not None else "No valid observations",
            "communications": "No receipt recorded" if not receipt else "Recent receipt" if (now-pd.Timestamp(receipt["received_at"]).to_pydatetime()).total_seconds() <= 300 else "Historical receipt; communications unverified",
            "last_ingest_receipt": receipt, "clock_offset_seconds": last_clock,
            "clock_check": "Not measured" if last_clock is None else "Offset exceeds 5 seconds" if abs(last_clock)>5 else "Within 5 seconds at reported check",
            "observed_alerts": observed_alerts, "validation": validate_ekf(raw, config["expected_cadence_seconds"]),
        })
    return {"window_start": start.isoformat(), "window_end": now.isoformat(), "operational": False,
            "operational_note": "Field measurements and commissioning must be independently verified before operational declaration",
            "stations": result, "comparison": [synchronized[t] for t in sorted(synchronized)],
            "comparison_method": "Exact UTC union; no interpolation or nearest-neighbour matching"}


@router.get("/context")
def context(station_id: str, hours: float = Query(24, gt=0, le=8760), _=Depends(require_api_key)):
    _known_station(station_id)
    from zgiis.gic.context import scientific_context
    return scientific_context(_db(), _sw_context(hours), station_id.upper(), hours)


@router.get("/climatology")
def research_climatology(station_id: str, grouping: str = "daily", hours: float = Query(8760, gt=0, le=8760), seasons: str | None = None, _=Depends(require_api_key)):
    import json
    _known_station(station_id)
    from zgiis.gic.climatology import climatology
    try:
        return climatology(_db().query_dataframe(station_id=station_id, hours=hours), _sw_context(hours), _db().station_config(station_id), grouping, json.loads(seasons) if seasons else None)
    except (ValueError, TypeError, StopIteration) as exc:
        raise HTTPException(422, str(exc)) from exc
