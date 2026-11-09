"""Site-specific monitoring policy, gap-aware coverage and scientific validation."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field, model_validator

from zgiis.gic.quality import valid_frame
from zgiis.space_weather.ekf import run_ekf_series, PARAM_CONFIGS


class StationConfiguration(BaseModel):
    thresholds_a: list[float] = Field(default_factory=lambda: [5, 10, 25, 35], min_length=4, max_length=4)
    expected_cadence_seconds: float | None = Field(None, ge=1, le=86400)
    logger_timezone: str | None = None
    calibration_id: str | None = None
    polarity_convention: str | None = None
    transformer_id: str | None = None
    transformer_metadata: dict = Field(default_factory=dict)
    commissioned: bool = False
    commissioning_reference: str | None = None
    engineer_approved_by: str | None = None
    engineer_approval_reference: str | None = None
    engineer_approved_at: str | None = None

    @model_validator(mode="after")
    def approved_policy(self):
        if not all(math.isfinite(v) and v > 0 for v in self.thresholds_a) or self.thresholds_a != sorted(set(self.thresholds_a)):
            raise ValueError("Four strictly increasing positive thresholds are required")
        if self.logger_timezone:
            from zoneinfo import ZoneInfo
            try:
                ZoneInfo(self.logger_timezone)
            except (KeyError, ValueError) as exc:
                raise ValueError("Unknown IANA logger timezone") from exc
        custom = self.thresholds_a != [5, 10, 25, 35]
        if custom and not all((self.engineer_approved_by, self.engineer_approval_reference, self.engineer_approved_at, self.transformer_id)):
            raise ValueError("Custom thresholds require transformer identity and recorded ZETDC engineering approval")
        if self.engineer_approved_at:
            approval = pd.Timestamp(self.engineer_approved_at)
            if approval.tzinfo is None or approval > pd.Timestamp.now(tz="UTC"):
                raise ValueError("Engineering approval needs a non-future timestamp with timezone")
        if self.commissioned and not all((self.commissioning_reference, self.calibration_id, self.polarity_convention, self.transformer_id, self.logger_timezone, self.expected_cadence_seconds)):
            raise ValueError("Commissioning requires documented sensor calibration, polarity, transformer, timezone and cadence")
        return self


def coverage(df: pd.DataFrame, start, end, cadence: float | None) -> dict:
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    data = valid_frame(df)
    if not data.empty:
        data = data[(pd.to_datetime(data.time, utc=True) >= start) & (pd.to_datetime(data.time, utc=True) < end)]
    expected = math.ceil((end - start).total_seconds() / cadence) if cadence else None
    occupied = len(set(((pd.to_datetime(data.time, utc=True) - start).dt.total_seconds() // cadence).astype(int))) if cadence and not data.empty else 0
    pct = round(100 * occupied / expected, 2) if expected else None
    return {"records": len(df), "valid_records": len(data), "expected_slots": expected,
            "occupied_slots": occupied if cadence else None, "completeness_pct": pct,
            "missing_pct": round(100 - pct, 2) if pct is not None else None,
            "cadence_seconds": cadence, "method": "Unique valid occupied cadence slots / expected slots; no interpolation"}


def held_durations(df: pd.DataFrame, cadence: float | None) -> list[float]:
    """Count only observed adjoining intervals; never bridge long gaps."""
    if df.empty:
        return []
    times = pd.to_datetime(df.time, utc=True)
    spacing = times.diff().dt.total_seconds().dropna()
    limit = cadence * 1.5 if cadence else None
    result = []
    for i in range(len(df)):
        dt = (times.iloc[i + 1] - times.iloc[i]).total_seconds() if i + 1 < len(df) else 0
        result.append(dt if limit and 0 < dt <= limit else 0)
    return result


def observation_summary(df: pd.DataFrame, configuration: dict, start, end) -> dict:
    data = valid_frame(df)
    cadence = configuration.get("expected_cadence_seconds")
    info = coverage(df, start, end, cadence)
    peak = float(data.gic_a.abs().max()) if not data.empty else None
    thresholds = configuration.get("thresholds_a", [5, 10, 25, 35])
    durations = held_durations(data, cadence)
    seconds = sum(dt for dt, current in zip(durations, data.gic_a if not data.empty else []) if abs(current) >= thresholds[1])
    return {"coverage": info, "peak_abs_a": peak,
            "peak_signed_a": float(data.loc[data.gic_a.abs().idxmax(), "gic_a"]) if not data.empty else None,
            "positive_samples": int((data.gic_a > 0).sum()) if not data.empty else 0,
            "negative_samples": int((data.gic_a < 0).sum()) if not data.empty else 0,
            "above_event_threshold_seconds": seconds if cadence else None,
            "event_threshold_a": thresholds[1], "duration_note": "Observed adjacent intervals only; gaps and final sample carry no duration"}


def validate_ekf(df: pd.DataFrame, cadence: float | None) -> dict:
    cfg = PARAM_CONFIGS["gic"]
    base = {"operationally_validated": False, "operational_warnings_enabled": False,
            "state": ["signed current (A)", "damped trend (A/sample)"],
            "inputs": "Past valid current observations only; solar wind is context, not an EKF input",
            "observation_model": "z = clip(current, -500 A, 500 A) + noise; clipping is a numerical assumption, not a sensor limit",
            "assumptions": {"q_current": cfg.q_pos, "q_trend": cfg.q_vel, "r": cfg.r, "trend_damping": cfg.trend_damping},
            "uncertainty": "Fixed heuristic covariance; displayed confidence is not a calibrated probability",
            "training_period": None, "test_period": None, "metrics": None,
            "reason": "Insufficient valid, regular field observations; engineering review remains required"}
    data = valid_frame(df)
    if len(data) < 30 or not cadence:
        return base
    # The current shared filter advances per sample. Do not validate it across gaps or variable cadence.
    deltas = pd.to_datetime(data.time, utc=True).diff().dt.total_seconds().dropna()
    if not deltas.between(.9 * cadence, 1.1 * cadence).all():
        base["reason"] = "Irregular cadence or data gaps; sample-step EKF evaluation withheld"
        return base
    split = max(20, int(len(data) * .7))
    if split >= len(data):
        return base
    points = run_ekf_series([(pd.Timestamp(r.time).isoformat(), float(r.gic_a)) for r in data.itertuples()], "gic")
    actual = [float(v) for v in data.gic_a.iloc[split:]]
    predicted = [p.predicted for p in points[split:]]
    persistence = [float(v) for v in data.gic_a.iloc[split-1:-1]]
    mean = float(data.gic_a.iloc[:split].mean())
    def metrics(pred):
        errors = [p - y for p, y in zip(pred, actual)]
        return {"mae_a": sum(abs(e) for e in errors)/len(errors),
                "rmse_a": math.sqrt(sum(e*e for e in errors)/len(errors)), "bias_a": sum(errors)/len(errors), "samples": len(errors)}
    base.update({"training_period": {"start": str(data.time.iloc[0]), "end": str(data.time.iloc[split-1]), "purpose": "Warm-up only; no parameter fitting"},
                 "test_period": {"start": str(data.time.iloc[split]), "end": str(data.time.iloc[-1]), "method": "Chronological held-out one-step-ahead evaluation; past test values assimilated after each prediction"},
                 "metrics": {"ekf": metrics(predicted), "persistence": metrics(persistence), "training_mean": metrics([mean]*len(actual))},
                 "reason": "Research evaluation only. Independent event periods, uncertainty calibration and ZETDC approval are still required"})
    return base
