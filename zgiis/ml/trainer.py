"""
Daily CNN-GRU training pipeline.

Called once per day (e.g. via cron or Streamlit's st.cache_data with TTL)
once the TimescaleDB accumulates ≥30 days of live VTEC observations.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from .cnn_gru import (
    CNNGRUForecast,
    SEQ_LEN,
    HORIZON,
    _TORCH_OK,
    build_model,
    load_model,
    save_model,
)

log = logging.getLogger(__name__)

_MIN_TRAINING_DAYS = 30
_RESAMPLE_FREQ     = "15min"


# ── Dataset preparation ───────────────────────────────────────────────────────

def _sliding_windows(
    series: np.ndarray,
    seq_len: int,
    horizon: int,
) -> Tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for i in range(len(series) - seq_len - horizon + 1):
        X.append(series[i : i + seq_len])
        y.append(series[i + seq_len : i + seq_len + horizon])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def prepare_dataset(db) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], dict]:
    """
    Pull the last 60 days from TimescaleDB, resample to 15-min, normalise,
    split into sliding windows for training.

    Returns (X, y, meta) where meta contains normalisation stats.
    """
    df = db.query_recent(hours=60 * 24)
    meta: dict = {"ok": False, "n_rows": len(df)}

    if df.empty or len(df) < SEQ_LEN + HORIZON:
        log.warning("Insufficient data (%d rows) — need at least %d", len(df), SEQ_LEN + HORIZON)
        return None, None, meta

    df["time"] = pd.to_datetime(df["time"], utc=True)
    ts = (
        df.groupby("time")["vtec_tecu"]
        .mean()
        .resample(_RESAMPLE_FREQ)
        .mean()
        .interpolate(limit=4)
        .dropna()
    )

    if len(ts) < SEQ_LEN + HORIZON:
        log.warning("Only %d 15-min epochs after resampling — need %d", len(ts), SEQ_LEN + HORIZON)
        return None, None, meta

    series = ts.values.astype(np.float32)
    mean, std = float(series.mean()), float(series.std()) + 1e-8
    norm = (series - mean) / std

    X, y = _sliding_windows(norm, SEQ_LEN, HORIZON)
    meta.update({"ok": True, "mean": mean, "std": std, "n_epochs": len(ts), "n_windows": len(X)})
    return X, y, meta


# ── Training loop ─────────────────────────────────────────────────────────────

def train(
    db,
    epochs:     int   = 30,
    batch_size: int   = 32,
    lr:         float = 1e-3,
    device:     str   = "cpu",
    epoch_callback=None,
) -> dict:
    """
    Full training cycle. Loads existing weights for fine-tuning if available.
    Returns a metrics dict.
    """
    if not _TORCH_OK:
        return {"error": "PyTorch not installed — pip install torch"}

    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset

    X, y, meta = prepare_dataset(db)
    if X is None:
        return {"error": "Insufficient training data", **meta}

    X_t = torch.from_numpy(X).unsqueeze(-1)   # (N, T, 1)
    y_t = torch.from_numpy(y)

    loader = DataLoader(TensorDataset(X_t, y_t), batch_size=batch_size, shuffle=True)

    # Fine-tune existing model if available, else train from scratch
    model = load_model() or build_model()
    model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)
    criterion = nn.MSELoss()

    losses: list[float] = []
    for epoch in range(epochs):
        model.train()
        epoch_loss = 0.0
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * len(xb)
        avg = epoch_loss / len(X)
        losses.append(avg)
        scheduler.step(avg)
        log.info("Epoch %02d/%02d  loss=%.5f", epoch + 1, epochs, avg)
        if epoch_callback is not None:
            try:
                epoch_callback(epoch + 1, epochs, avg)
            except Exception:
                pass

    save_model(model)

    return {
        "trained_at":  datetime.now(tz=timezone.utc).isoformat(),
        "epochs":      epochs,
        "final_loss":  round(losses[-1], 6),
        "best_loss":   round(min(losses), 6),
        **meta,
    }


# ── Inference ─────────────────────────────────────────────────────────────────

def forecast(
    db,
    station: Optional[str] = None,
) -> Optional[pd.Series]:
    """
    Produce a 6-hour VTEC forecast using the last 24 h from the database.
    Returns a pd.Series with DatetimeIndex (UTC), or None if unavailable.
    """
    if not _TORCH_OK:
        return None

    import torch

    model = load_model()
    if model is None:
        log.warning("No trained model found — run train() first")
        return None

    ts = db.mean_vtec_timeseries(hours=24.0, station=station)
    if len(ts) < SEQ_LEN:
        df = db.query_recent(hours=24 * 365, station=station)
        if not df.empty:
            df["time"] = pd.to_datetime(df["time"], utc=True)
            ts = (
                df.set_index("time")["vtec_tecu"]
                .resample(_RESAMPLE_FREQ)
                .mean()
                .interpolate(limit=4)
                .dropna()
            )
    if len(ts) < SEQ_LEN:
        log.warning("Not enough history (%d epochs) for forecast", len(ts))
        return None

    series = ts.values[-SEQ_LEN:].astype(np.float32)
    mean, std = float(series.mean()), float(series.std()) + 1e-8
    norm  = (series - mean) / std

    x = torch.from_numpy(norm).unsqueeze(0).unsqueeze(-1)  # (1, T, 1)
    with torch.no_grad():
        pred_norm = model(x).numpy()[0]                    # (horizon,)
    pred = pred_norm * std + mean

    last_t = ts.index[-1]
    idx = pd.date_range(
        start  = last_t + pd.Timedelta(_RESAMPLE_FREQ),
        periods = HORIZON,
        freq   = _RESAMPLE_FREQ,
        tz     = "UTC",
    )
    return pd.Series(pred.tolist(), index=idx, name="vtec_forecast_tecu")
