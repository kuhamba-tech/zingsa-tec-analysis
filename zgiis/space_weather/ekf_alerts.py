"""
EKF deviation alerting.

Flags when an observed space-weather value diverges from its Extended
Kalman Filter prediction by more than a dynamic threshold computed from
recent historical prediction errors:

    error = abs(observed_value - ekf_predicted_value)
    threshold = mean_error + 3 * standard_deviation

A divergence this large may indicate a geomagnetic storm or ionospheric
disturbance rather than ordinary filter noise. Severity is cross-checked
against the other dashboard indicators: if several are abnormal at the
same time, severity is escalated.
"""
from __future__ import annotations

import math
import statistics
import uuid
from datetime import datetime, timezone

from .ekf import EkfPoint

PARAM_LABELS: dict[str, str] = {
    "kp": "Kp Index",
    "dst": "Dst Index",
    "f107": "Solar Flux F10.7",
    "solar_wind": "Solar Wind Speed",
    "s4": "Scintillation S4",
    "gnss_risk": "GNSS Risk Score",
    "stations_online": "CORS Stations Online",
    "mean_vtec": "Network Mean TEC",
    "gic": "GIC (Transformer Neutral Current)",
}

# Minimum number of prior errors needed before a threshold is meaningful.
MIN_HISTORY = 6


def _recent_errors(points: list[EkfPoint]) -> list[float]:
    """All-but-the-latest valid prediction errors, oldest first."""
    errs = [_finite_float(p.error) for p in points if p.error is not None]
    errs = [err for err in errs if err is not None]
    return errs[:-1] if errs else errs


def _finite_float(value: object) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _severity(ratio: float) -> str:
    if ratio < 1.0:
        return "Low"
    if ratio < 1.5:
        return "Moderate"
    return "High"


def evaluate(series_by_param: dict[str, list[EkfPoint]]) -> dict:
    """Return per-parameter EKF-deviation status plus any newly triggered alerts."""
    status: dict[str, dict] = {}

    for param, points in series_by_param.items():
        latest = next((p for p in reversed(points) if p.error is not None), None)
        history = _recent_errors(points)
        latest_error = _finite_float(latest.error) if latest else None

        if latest is None or latest_error is None or len(history) < MIN_HISTORY:
            status[param] = {
                "available": False,
                "observed": latest.observed if latest else None,
                "predicted": latest.predicted if latest else None,
                "error": latest.error if latest else None,
                "threshold": None,
                "ratio": None,
                "severity": "Low",
                "timestamp": latest.t if latest else None,
            }
            continue

        mean_err = statistics.fmean(history)
        std_err = statistics.pstdev(history) if len(history) > 1 else 0.0
        threshold = mean_err + 3 * std_err
        if threshold > 1e-9:
            ratio = latest_error / threshold
        else:
            ratio = 0.0 if latest_error <= 1e-9 else 999.0

        status[param] = {
            "available": True,
            "observed": latest.observed,
            "predicted": latest.predicted,
            "error": latest_error,
            "threshold": round(threshold, 4),
            "ratio": round(ratio, 3),
            "severity": _severity(ratio),
            "timestamp": latest.t,
        }

    abnormal = [
        p for p, s in status.items()
        if s["available"] and s["ratio"] is not None and s["ratio"] >= 1.0
    ]

    alerts: list[dict] = []
    for param, s in status.items():
        if not s["available"] or s["ratio"] is None or s["ratio"] < 1.0:
            continue

        related = [p for p in abnormal if p != param]
        severity = s["severity"]
        if severity == "High" and len(related) >= 2:
            severity = "Severe"

        label = PARAM_LABELS.get(param, param)
        message = (
            "Possible geomagnetic storm or ionospheric disturbance detected. "
            f"The observed {label} value has deviated significantly from the "
            "Extended Kalman Filter prediction."
        )
        alerts.append({
            "alert_id": str(uuid.uuid4()),
            "timestamp": s["timestamp"] or datetime.now(tz=timezone.utc).isoformat(),
            "parameter": param,
            "parameter_label": label,
            "observed_value": s["observed"],
            "ekf_predicted_value": s["predicted"],
            "prediction_error": s["error"],
            "threshold": s["threshold"],
            "severity": severity,
            "related_indicators": [PARAM_LABELS.get(p, p) for p in related],
            "alert_message": message,
            "acknowledged_status": False,
        })

    # Worst-first, so the dashboard banner surfaces the most severe alert.
    severity_rank = {"Low": 0, "Moderate": 1, "High": 2, "Severe": 3}
    alerts.sort(key=lambda a: severity_rank.get(a["severity"], 0), reverse=True)

    return {"status": status, "alerts": alerts}
