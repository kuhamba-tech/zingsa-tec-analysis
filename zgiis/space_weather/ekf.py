"""
Extended Kalman Filter (EKF) for 1-D space-weather time series.

State vector x = [value, trend]. The process model is a constant-velocity
model with a damped trend term. The measurement function is what makes
this an *extended* Kalman filter: each parameter has a physical range
(e.g. Kp in [0, 9], S4 in [0, 1]) and the raw state is clipped to that
range before being compared against the observation, since these indices
cannot physically exceed their defined bounds. That clip is nonlinear, so
its Jacobian is linearized at the current state estimate on every update,
as required by the EKF formulation.

This module only ever predicts from real observed values supplied by the
caller — there is no synthetic/placeholder series. If a parameter has no
observed history yet, `run_ekf_series` simply returns no predictions for
it (per the project's no-demo-data policy).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional


@dataclass
class EkfPoint:
    t: str
    observed: Optional[float]
    predicted: Optional[float]
    error: Optional[float]
    confidence: Optional[float]


@dataclass
class EkfConfig:
    bounds: tuple[Optional[float], Optional[float]] = (None, None)
    q_pos: float = 0.05
    q_vel: float = 0.01
    r: float = 1.0
    trend_damping: float = 0.85
    scale: float = 1.0  # typical magnitude for this parameter, used to normalise confidence%


# Tuned per parameter from the physical range and typical noise level of
# each dashboard metric.
PARAM_CONFIGS: dict[str, EkfConfig] = {
    "kp": EkfConfig(bounds=(0.0, 9.0), q_pos=0.05, q_vel=0.01, r=0.6, scale=9.0),
    "dst": EkfConfig(bounds=(-600.0, 50.0), q_pos=2.0, q_vel=0.5, r=40.0, scale=100.0),
    "f107": EkfConfig(bounds=(60.0, 400.0), q_pos=1.0, q_vel=0.2, r=20.0, scale=150.0),
    "solar_wind": EkfConfig(bounds=(200.0, 1500.0), q_pos=10.0, q_vel=2.0, r=900.0, scale=400.0),
    "s4": EkfConfig(bounds=(0.0, 1.0), q_pos=0.01, q_vel=0.005, r=0.01, scale=0.5),
    "gnss_risk": EkfConfig(bounds=(0.0, 3.0), q_pos=0.05, q_vel=0.01, r=0.3, scale=3.0),
    "stations_online": EkfConfig(bounds=(0.0, 30.0), q_pos=0.5, q_vel=0.1, r=2.0, scale=24.0),
    # Transformer-neutral GIC (A). Signed, physically unbounded in practice;
    # noise/typical-magnitude tuning follows the ~10 A "large event" scale.
    "gic": EkfConfig(bounds=(-500.0, 500.0), q_pos=0.3, q_vel=0.05, r=1.5, scale=10.0),
}


class ExtendedKalmanFilter1D:
    def __init__(self, x0: float, config: EkfConfig):
        self.cfg = config
        self.x = [x0, 0.0]
        self.P = [[max(config.r, 1.0), 0.0], [0.0, config.q_vel * 10]]

    def _h(self, x0: float) -> float:
        lo, hi = self.cfg.bounds
        v = x0
        if lo is not None:
            v = max(v, lo)
        if hi is not None:
            v = min(v, hi)
        return v

    def _h_jacobian(self, x0: float) -> float:
        lo, hi = self.cfg.bounds
        if lo is not None and x0 < lo:
            return 0.0
        if hi is not None and x0 > hi:
            return 0.0
        return 1.0

    def predict(self, dt: float = 1.0) -> float:
        x0, x1 = self.x
        damping = self.cfg.trend_damping
        nx0 = x0 + dt * x1
        nx1 = damping * x1
        self.x = [nx0, nx1]

        # P_new = F P F^T + Q, with F = [[1, dt], [0, damping]]
        P = self.P
        a = P[0][0] + dt * P[1][0]
        b = P[0][1] + dt * P[1][1]
        c = damping * P[1][0]
        d = damping * P[1][1]
        p00 = a + dt * b + self.cfg.q_pos
        p01 = damping * b
        p10 = c + dt * d
        p11 = damping * d + self.cfg.q_vel
        self.P = [[p00, p01], [p10, p11]]
        return self._h(self.x[0])

    def update(self, z: float) -> tuple[float, float]:
        """Assimilate observation z. Returns (filtered_value, innovation_std)."""
        x0, x1 = self.x
        h = self._h(x0)
        H0 = self._h_jacobian(x0)
        P = self.P

        PHt0 = H0 * P[0][0]
        PHt1 = H0 * P[0][1]
        S = H0 * PHt0 + self.cfg.r
        S = S if S > 1e-9 else 1e-9
        K0 = PHt0 / S
        K1 = PHt1 / S

        y = z - h
        self.x = [x0 + K0 * y, x1 + K1 * y]

        p00 = (1 - K0 * H0) * P[0][0]
        p01 = (1 - K0 * H0) * P[0][1]
        p10 = P[1][0] - K1 * H0 * P[0][0]
        p11 = P[1][1] - K1 * H0 * P[0][1]
        self.P = [[p00, p01], [p10, p11]]
        return self._h(self.x[0]), math.sqrt(S)


def run_ekf_series(points: Iterable[tuple[str, Optional[float]]], parameter: str) -> list[EkfPoint]:
    """One-step-ahead EKF predict/update walk over a chronological (t, value) series.

    `predicted` is the filter's forecast made BEFORE seeing that point's own
    observation, so it is directly comparable to `observed` at the same
    timestamp. Points with no observed value only advance the filter.
    """
    cfg = PARAM_CONFIGS.get(parameter, EkfConfig())
    out: list[EkfPoint] = []
    ekf: Optional[ExtendedKalmanFilter1D] = None

    for t, v in points:
        if ekf is None:
            if v is None:
                out.append(EkfPoint(t=t, observed=None, predicted=None, error=None, confidence=None))
                continue
            ekf = ExtendedKalmanFilter1D(v, cfg)
            out.append(EkfPoint(t=t, observed=round(v, 4), predicted=None, error=None, confidence=None))
            continue

        predicted = ekf.predict()
        if v is None:
            out.append(EkfPoint(t=t, observed=None, predicted=round(predicted, 4), error=None, confidence=None))
            continue

        error = abs(v - predicted)
        _, innov_std = ekf.update(v)
        confidence = max(0.0, min(100.0, 100.0 * math.exp(-innov_std / max(cfg.scale, 1e-6))))
        out.append(EkfPoint(
            t=t,
            observed=round(v, 4),
            predicted=round(predicted, 4),
            error=round(error, 4),
            confidence=round(confidence, 1),
        ))

    return out
