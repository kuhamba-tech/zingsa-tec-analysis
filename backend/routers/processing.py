from __future__ import annotations

import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.deps import require_api_key
from backend.schemas import ProcessingSession, TecSummaryRow

router = APIRouter(prefix="/processing", tags=["processing"])

# In-memory session store (replace with Redis/DB for multi-worker deployments)
_sessions: dict[str, dict] = {}
_TMP = Path("static/data/upload_tmp")
_TMP.mkdir(parents=True, exist_ok=True)


def _get_session(session_id: str) -> dict:
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


@router.post("/cmn", response_model=ProcessingSession)
async def upload_cmn(file: UploadFile = File(...), _=Depends(require_api_key)):
    sid = str(uuid.uuid4())
    tmp_path = _TMP / f"{sid}_{file.filename}"
    content = await file.read()
    tmp_path.write_bytes(content)

    _sessions[sid] = {"status": "running", "path": str(tmp_path), "df": None, "daily": None}
    try:
        import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from tec_core import read_cmn_file, summarize_daily
        df = read_cmn_file(str(tmp_path))
        daily = summarize_daily(df)
        _sessions[sid].update({"status": "done", "df": df, "daily": daily, "rows": len(df)})
        return ProcessingSession(session_id=sid, status="done", rows=len(df))
    except Exception as exc:
        _sessions[sid]["status"] = "error"
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/rinex", response_model=ProcessingSession)
async def upload_rinex(
    obs: list[UploadFile] = File(...),
    nav: list[UploadFile] = File(default=[]),
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
        from tec_core import TecConfig, read_rinex_files, summarize_daily
        cfg = TecConfig()
        df = read_rinex_files(obs_paths, nav_paths, cfg)
        daily = summarize_daily(df)
        _sessions[sid].update({"status": "done", "df": df, "daily": daily, "rows": len(df)})
        return ProcessingSession(session_id=sid, status="done", rows=len(df))
    except Exception as exc:
        _sessions[sid]["status"] = "error"
        raise HTTPException(status_code=422, detail=str(exc))


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

    if mode == "daily":
        out = s.get("daily") or summarize_daily(df)
    elif mode == "monthly":
        daily = s.get("daily") or summarize_daily(df)
        out = summarize_monthly(daily)
    else:
        daily = s.get("daily") or summarize_daily(df)
        out = summarize_yearly(daily)

    rows = []
    for _, row in out.iterrows():
        rows.append(TecSummaryRow(
            date=str(row.get("date", row.name)),
            mean_vtec=float(row["mean_vtec"]) if "mean_vtec" in row else None,
            max_vtec=float(row["max_vtec"]) if "max_vtec" in row else None,
            min_vtec=float(row["min_vtec"]) if "min_vtec" in row else None,
            samples=int(row["samples"]) if "samples" in row else None,
        ))
    return rows


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
