from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import CnnGruTrainStatus, ForecastPoint, ForecastStatus

router = APIRouter(prefix="/forecast", tags=["forecast"])

_train_lock = threading.Lock()
_train_state: dict = {
    "running": False,
    "started_at": None,
    "epoch": 0,
    "total_epochs": 30,
    "last_loss": None,
    "error": None,
    "result": None,
}


def _train_status_payload() -> CnnGruTrainStatus:
    with _train_lock:
        return CnnGruTrainStatus(**_train_state)


def _run_train(epochs: int = 30) -> None:
    def on_epoch(epoch: int, total: int, loss: float) -> None:
        with _train_lock:
            _train_state["epoch"] = epoch
            _train_state["total_epochs"] = total
            _train_state["last_loss"] = round(loss, 6)

    try:
        from zgiis.db.timescale import TecDB
        from zgiis.ml.trainer import train as ml_train

        db = TecDB()
        result = ml_train(db, epochs=epochs, epoch_callback=on_epoch)
        with _train_lock:
            if result.get("error"):
                _train_state["error"] = str(result["error"])
                _train_state["result"] = None
            else:
                _train_state["error"] = None
                _train_state["result"] = result
    except Exception as exc:
        with _train_lock:
            _train_state["error"] = str(exc)
            _train_state["result"] = None
    finally:
        with _train_lock:
            _train_state["running"] = False


@router.get("/status", response_model=ForecastStatus)
async def forecast_status(_=Depends(require_api_key)):
    try:
        from zgiis.ml.cnn_gru import model_info
        info = model_info()
    except Exception:
        info = {}
    return ForecastStatus(
        torch_ok=info.get("torch_ok", False),
        model_exists=info.get("exists", False),
        forecast_h=info.get("forecast_h", 6),
        seq_len=info.get("seq_len", 96),
        path=info.get("path"),
    )


@router.get("/train/status", response_model=CnnGruTrainStatus)
async def train_status(_=Depends(require_api_key)):
    return _train_status_payload()


@router.get("/cnn-gru", response_model=list[ForecastPoint])
async def cnn_gru_forecast(_=Depends(require_api_key)):
    try:
        from zgiis.db.timescale import TecDB
        from zgiis.ml.trainer import forecast as ml_forecast
        db = TecDB()
        fc = ml_forecast(db)
        if fc is None:
            raise HTTPException(status_code=503, detail="Insufficient history for forecast")
        return [
            ForecastPoint(t=str(t), predicted_vtec=float(v))
            for t, v in fc.items()
        ]
    except ImportError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/train", status_code=202)
async def train(_=Depends(require_api_key)):
    with _train_lock:
        if _train_state["running"]:
            raise HTTPException(status_code=409, detail="CNN-GRU training already in progress")
        _train_state.update(
            {
                "running": True,
                "started_at": datetime.now(tz=timezone.utc).isoformat(),
                "epoch": 0,
                "total_epochs": 30,
                "last_loss": None,
                "error": None,
                "result": None,
            }
        )
    threading.Thread(
        target=_run_train,
        kwargs={"epochs": 30},
        daemon=True,
        name="cnn-gru-train",
    ).start()
    return {"status": "started"}


@router.get("/statistical", response_model=list[ForecastPoint])
async def statistical_forecast(
    horizon_days: int = 30,
    _=Depends(require_api_key),
):
    from scipy.optimize import curve_fit
    try:
        from zgiis.data.tec_archive import load_historical_tec
        df, _ = load_historical_tec()
    except Exception:
        raise HTTPException(status_code=503, detail="No historical data available")

    df["date"] = pd.to_datetime(df.get("date", df.get("timestamp")))
    daily = df.groupby("date")["vtec"].mean().reset_index().sort_values("date").dropna()
    if len(daily) < 30:
        raise HTTPException(status_code=422, detail="Insufficient history (need ≥30 days)")

    t0 = daily["date"].min()
    t_num = (daily["date"] - t0).dt.days.values.astype(float)
    y = daily["vtec"].values

    def _model(t, a, b, c1, d1, c2, d2):
        return (a + b * t
                + c1 * np.sin(2 * np.pi * t / 365.25)
                + d1 * np.cos(2 * np.pi * t / 365.25)
                + c2 * np.sin(4 * np.pi * t / 365.25)
                + d2 * np.cos(4 * np.pi * t / 365.25))

    try:
        popt, _ = curve_fit(_model, t_num, y, maxfev=10000)
    except Exception:
        popt = list(np.polyfit(t_num, y, 1)[::-1]) + [0, 0, 0, 0]

    y_fit = _model(t_num, *popt)
    sigma = float((y - y_fit).std())
    t_future = np.arange(t_num[-1] + 1, t_num[-1] + horizon_days + 1)
    y_pred = _model(t_future, *popt)
    base_date = daily["date"].max()

    return [
        ForecastPoint(
            t=str((base_date + timedelta(days=int(i + 1))).date()),
            predicted_vtec=float(y_pred[i]),
            upper=float(y_pred[i] + sigma),
            lower=float(y_pred[i] - sigma),
        )
        for i in range(len(y_pred))
    ]
