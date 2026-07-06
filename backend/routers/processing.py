from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.deps import require_api_key
from backend.schemas import BiasRow, ProcessingSession, TecHourlyRow, TecPlotSeries, TecSummaryRow

router = APIRouter(prefix="/processing", tags=["processing"])

# In-memory session store (replace with Redis/DB for multi-worker deployments)
_sessions: dict[str, dict] = {}
# OS temp dir, not a project-relative path — Vercel's filesystem is read-only
# outside of /tmp.
_TMP = Path(tempfile.gettempdir()) / "zgiis_upload_tmp"
_TMP.mkdir(parents=True, exist_ok=True)


def _get_session(session_id: str) -> dict:
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


def _build_cfg(elevation_min: float, ipp_height: float, dcb_folder: str):
    import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tec_core import TecConfig
    return TecConfig(
        elevation_min_deg=elevation_min,
        ipp_height_km=ipp_height,
        dcb_folder=dcb_folder.strip() or None,
    )


def _filter_stations(df, stations: str):
    codes = [s.strip().lower() for s in stations.split(",") if s.strip()]
    if codes and "station" in df.columns:
        return df[df["station"].astype(str).str.lower().isin(codes)].copy()
    return df


def _storm_daily(df, kp_csv: str):
    from tec_core import mark_storm_days, read_kp_csv, summarize_daily
    daily = summarize_daily(df)
    kp_df = None
    if kp_csv.strip():
        try:
            kp_df = read_kp_csv(Path(kp_csv.strip()))
        except Exception:
            kp_df = None
    return mark_storm_days(daily, kp_df=kp_df)


@router.post("/cmn", response_model=ProcessingSession)
async def upload_cmn(
    file: UploadFile = File(...),
    elevation_min: float = Form(30.0),
    ipp_height: float = Form(350.0),
    dcb_folder: str = Form(""),
    stations: str = Form(""),
    kp_csv: str = Form(""),
    _=Depends(require_api_key),
):
    sid = str(uuid.uuid4())
    tmp_path = _TMP / f"{sid}_{file.filename}"
    content = await file.read()
    tmp_path.write_bytes(content)

    _sessions[sid] = {"status": "running", "path": str(tmp_path), "df": None, "daily": None}
    try:
        import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from tec_core import read_cmn_file
        from zgiis.processing.goptec_plot import build_tec_plot_series

        cfg = _build_cfg(elevation_min, ipp_height, dcb_folder)
        df = read_cmn_file(str(tmp_path), cfg)
        df = _filter_stations(df, stations)
        daily = _storm_daily(df, kp_csv)
        plot = build_tec_plot_series(df, value_col="vtec")
        raw_col = "vtec_raw" if "vtec_raw" in df.columns else "vtec"
        plot_raw = build_tec_plot_series(df, value_col=raw_col)
        _sessions[sid].update({
            "status": "done",
            "df": df,
            "daily": daily,
            "rows": len(df),
            "plot": plot,
            "plot_raw": plot_raw,
            "kind": "cmn",
            "cfg": cfg,
        })
        return ProcessingSession(session_id=sid, status="done", rows=len(df))
    except HTTPException:
        _sessions[sid]["status"] = "error"
        raise
    except Exception as exc:
        _sessions[sid]["status"] = "error"
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/rinex", response_model=ProcessingSession)
async def upload_rinex(
    obs: list[UploadFile] = File(...),
    nav: list[UploadFile] = File(default=[]),
    elevation_min: float = Form(30.0),
    ipp_height: float = Form(350.0),
    dcb_folder: str = Form(""),
    stations: str = Form(""),
    kp_csv: str = Form(""),
    _=Depends(require_api_key),
):
    sid = str(uuid.uuid4())
    obs_paths, nav_paths = [], []
    for f in obs:
        p = _TMP / f"{sid}_obs_{f.filename}"
        p.write_bytes(await f.read())
        obs_paths.append(str(p))
    for f in nav:
        p = _TMP / f"{sid}_nav_{f.filename}"
        p.write_bytes(await f.read())
        nav_paths.append(str(p))

    _sessions[sid] = {"status": "running", "df": None, "daily": None}
    try:
        import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from tec_core import read_rinex_files, RINEX_EMPTY_HELP
        from zgiis.processing.goptec_plot import build_tec_plot_series

        cfg = _build_cfg(elevation_min, ipp_height, dcb_folder)
        df = read_rinex_files(obs_paths, cfg, nav_files=nav_paths or None)
        if df.empty:
            raise HTTPException(status_code=422, detail=RINEX_EMPTY_HELP)
        df = _filter_stations(df, stations)
        daily = _storm_daily(df, kp_csv)
        plot = build_tec_plot_series(df, value_col="vtec")
        plot_raw = build_tec_plot_series(df, value_col="vtec_raw")
        _sessions[sid].update({
            "status": "done",
            "df": df,
            "daily": daily,
            "rows": len(df),
            "plot": plot,
            "plot_raw": plot_raw,
            "kind": "rinex",
            "cfg": cfg,
        })
        return ProcessingSession(session_id=sid, status="done", rows=len(df))
    except HTTPException:
        _sessions[sid]["status"] = "error"
        raise
    except Exception as exc:
        _sessions[sid]["status"] = "error"
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/rinex-convert")
async def rinex_convert(
    files: list[UploadFile] = File(...),
    config: str = Form("{}"),
    _=Depends(require_api_key),
):
    """Convert MDB/raw/RINEX inputs to RINEX 3.x using GOP-style settings."""
    import json
    import tempfile

    from zgiis.processing.rinex_converter import RinexConvertConfig, build_zip, convert_inputs

    try:
        cfg_data = json.loads(config or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid config JSON: {exc}") from exc

    cfg = RinexConvertConfig.from_dict(cfg_data)
    if not files:
        raise HTTPException(status_code=422, detail="Select at least one MDB or RINEX file")

    sid = str(uuid.uuid4())[:8]
    work = Path(tempfile.gettempdir()) / "zgiis_rinex_conv" / sid
    in_dir = work / "in"
    out_dir = work / "out"
    in_dir.mkdir(parents=True, exist_ok=True)

    saved: list[Path] = []
    for f in files:
        dest = in_dir / (f.filename or "input.dat")
        dest.write_bytes(await f.read())
        saved.append(dest)

    results = convert_inputs(saved, out_dir, cfg)
    if not any(r.ok and r.output_name for r in results):
        detail = "; ".join(r.message for r in results) or "No files converted"
        raise HTTPException(status_code=422, detail=detail)

    payload = build_zip(out_dir, results)
    return StreamingResponse(
        iter([payload]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="rinex_converted_{sid}.zip"'},
    )


@router.get("/{session_id}/status", response_model=ProcessingSession)
async def session_status(session_id: str, _=Depends(require_api_key)):
    s = _get_session(session_id)
    df = s.get("df")
    return ProcessingSession(
        session_id=session_id,
        status=s["status"],
        rows=len(df) if df is not None else 0,
    )


@router.get("/{session_id}/summary", response_model=list[TecSummaryRow])
async def session_summary(
    session_id: str,
    mode: Literal["daily", "monthly", "yearly"] = "daily",
    _=Depends(require_api_key),
):
    s = _get_session(session_id)
    if s["status"] != "done":
        raise HTTPException(status_code=409, detail="Processing not complete")

    df = s.get("df")
    if df is None or df.empty:
        return []

    import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tec_core import summarize_daily, summarize_monthly, summarize_yearly

    daily = s.get("daily")
    if daily is None:
        daily = summarize_daily(df)

    if mode == "daily":
        out = daily
    elif mode == "monthly":
        out = summarize_monthly(daily)
    else:
        out = summarize_yearly(daily)

    import pandas as pd

    def _num(row, col):
        val = row[col] if col in row else None
        return float(val) if val is not None and pd.notna(val) else None

    date_col = {"daily": "date", "monthly": "month", "yearly": "year"}[mode]

    def _date_label(row) -> str:
        if date_col not in row or pd.isna(row[date_col]):
            return str(row.name)
        val = row[date_col]
        # iterrows() upcasts an int "year" column to float when mixed with
        # float columns in the same row — render whole numbers without ".0".
        if mode == "yearly":
            return str(int(val))
        return str(val)

    rows = []
    for _, row in out.iterrows():
        rows.append(TecSummaryRow(
            date=_date_label(row),
            mean_vtec=_num(row, "mean_vtec"),
            max_vtec=_num(row, "max_vtec"),
            min_vtec=_num(row, "min_vtec"),
            daytime_mean_vtec=_num(row, "daytime_mean_vtec"),
            samples=int(row["samples"]) if "samples" in row and pd.notna(row["samples"]) else None,
            storm_flag=bool(row["storm_flag"]) if "storm_flag" in row and pd.notna(row["storm_flag"]) else None,
            kp_index=_num(row, "kp_index"),
        ))
    return rows


@router.get("/{session_id}/hourly", response_model=list[TecHourlyRow])
async def session_hourly(session_id: str, _=Depends(require_api_key)):
    """UT-hour VTEC profile for the session — used to plot mean/max/min VTEC
    against hours of day when a single day's files were processed."""
    s = _get_session(session_id)
    if s["status"] != "done":
        raise HTTPException(status_code=409, detail="Processing not complete")

    df = s.get("df")
    if df is None or df.empty:
        return []

    import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tec_core import summarize_24h_profile

    prof = summarize_24h_profile(df)

    import pandas as pd

    def _num(row, col):
        val = row[col] if col in row else None
        return float(val) if val is not None and pd.notna(val) else None

    rows = []
    for _, row in prof.iterrows():
        rows.append(TecHourlyRow(
            ut_hour=float(row["ut_hour"]),
            mean_vtec=_num(row, "mean_vtec"),
            max_vtec=_num(row, "max_vtec"),
            min_vtec=_num(row, "min_vtec"),
            days_used=int(row["days_used"]) if "days_used" in row and pd.notna(row["days_used"]) else None,
        ))
    return rows


@router.get("/{session_id}/bias", response_model=list[BiasRow])
async def session_bias(session_id: str, _=Depends(require_api_key)):
    s = _get_session(session_id)
    if s["status"] != "done":
        raise HTTPException(status_code=409, detail="Processing not complete")

    df = s.get("df")
    if df is None or df.empty or "station" not in df.columns:
        return []

    cfg = s.get("cfg")
    dcb_label = str(cfg.dcb_folder) if cfg and cfg.dcb_folder else "not applied"

    rows = []
    for stn in sorted(df["station"].dropna().unique()):
        sub = df[df["station"] == stn]
        rows.append(BiasRow(
            station=str(stn),
            mean_stec=round(float(sub["stec"].mean()), 4) if "stec" in sub.columns else None,
            mean_vtec=round(float(sub["vtec"].mean()), 4) if "vtec" in sub.columns else None,
            dcb_folder=dcb_label,
        ))
    return rows


@router.get("/{session_id}/tec-plot", response_model=TecPlotSeries)
async def session_tec_plot(
    session_id: str,
    raw: bool = False,
    _=Depends(require_api_key),
):
    s = _get_session(session_id)
    if s["status"] != "done":
        raise HTTPException(status_code=409, detail="Processing not complete")
    key = "plot_raw" if raw else "plot"
    plot = s.get(key)
    if not plot:
        raise HTTPException(status_code=404, detail="No plot data for this session")
    return TecPlotSeries(**plot)


@router.get("/{session_id}/raw")
async def session_raw(session_id: str, _=Depends(require_api_key)):
    s = _get_session(session_id)
    if s["status"] != "done":
        raise HTTPException(status_code=409, detail="Processing not complete")
    df = s.get("df")
    if df is None:
        raise HTTPException(status_code=404, detail="No data")
    import io
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={session_id}.csv"},
    )
