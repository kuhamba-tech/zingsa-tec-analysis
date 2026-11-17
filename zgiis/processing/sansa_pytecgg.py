"""Actual PyTECGg 1.3.0 pipeline for SANSA; no surrogate calibration fallback.

Raw RTCM GPS observations use the same long-form schema as read_rinex_obs.
Satellite geometry, IPPs, arc extraction and calibration are all PyTECGg calls.
GOPI and Zimbabwe processing do not import this module.
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path
from threading import Lock

ENGINE = "pytecgg"
VERSION = "1.3.0"
SHELL_M = 350_000
ELEVATION_DEG = 20.0
DEGREE = 3
BATCH_SIZE = 30
MIN_ARC_LENGTH = 30


def gps_epoch(tow_ms: float | None, received: datetime) -> datetime | None:
    """Recover GPS calendar epoch without replacing source time by receipt time.

    RTCM supplies GPS milliseconds of week, not UTC. Keep GPS time for the
    package's RINEX-compatible input; receipt UTC is retained separately.
    """
    if tow_ms is None or not math.isfinite(float(tow_ms)) or not 0 <= tow_ms < 604800000:
        return None
    anchor = received.astimezone(timezone.utc).replace(tzinfo=None)
    sunday = (anchor - timedelta(days=(anchor.weekday() + 1) % 7)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    candidates = [sunday + timedelta(days=d, milliseconds=tow_ms) for d in (-7, 0, 7)]
    # PyTECGg's RINEX parser labels GPS calendar values with UTC tzinfo too;
    # follow its schema without shifting the GPS calendar by leap seconds.
    return min(candidates, key=lambda epoch: abs((epoch - anchor).total_seconds())).replace(tzinfo=timezone.utc)


def calibrate_observations(obs_data, nav_data, receiver_pos, station: str, *, rinex_version="3.04"):
    """Run the notebook's executable pipeline; return package rows unchanged."""
    if version("pytecgg") != VERSION:
        raise RuntimeError(f"SANSA requires pytecgg=={VERSION}")
    from pytecgg import GNSSContext
    from pytecgg.linear_combinations.lc_calculation import calculate_linear_combinations
    from pytecgg.satellites.ephemeris import prepare_ephemeris
    from pytecgg.satellites.positions import satellite_coordinates
    from pytecgg.satellites.ipp import calculate_ipp
    from pytecgg.tec_calibration.arcs import extract_arcs
    from pytecgg.tec_calibration.calibration import calculate_tec, calculate_vertical_equivalent

    ctx = GNSSContext(receiver_pos=tuple(receiver_pos), receiver_name=station,
                      rinex_version=rinex_version, h_ipp=SHELL_M, systems=["GPS"])
    ephemeris = prepare_ephemeris(nav_data, ctx)
    linear = calculate_linear_combinations(obs_data=obs_data, ctx=ctx,
        combinations=["gflc_phase", "gflc_code", "mw"], selection_mode="quality")
    if linear.is_empty():
        return linear
    coords = satellite_coordinates(sv_ids=linear["sv"], epochs=linear["epoch"], ephem_dict=ephemeris)
    linear = linear.join(coords, on=["sv", "epoch"], how="left")
    linear = calculate_ipp(df=linear, ctx=ctx, min_elevation=ELEVATION_DEG)
    if linear.is_empty():
        return linear
    arcs = extract_arcs(df=linear, ctx=ctx, threshold_abs=5.0, threshold_std=5.0,
                        min_arc_length=MIN_ARC_LENGTH, threshold_jump=10.0)
    calibrated = calculate_tec(df=arcs, ctx=ctx, max_polynomial_degree=DEGREE,
                               batch_size_epochs=BATCH_SIZE)
    # An all-invalid fit has no zenith solution; never substitute raw code TEC.
    if "vtec" not in calibrated.columns or calibrated["vtec"].drop_nulls().is_empty():
        return calibrated
    return calculate_vertical_equivalent(df_calibrated=calibrated, ctx=ctx,
        max_polynomial_degree=DEGREE, batch_size_epochs=BATCH_SIZE)


def calibrate_rinex(obs_path: Path, nav_path: Path, station: str):
    from pytecgg.parsing import read_rinex_obs, read_rinex_nav
    obs, position, rinex_version = read_rinex_obs(obs_path)
    return calibrate_observations(obs, read_rinex_nav(nav_path), position, station,
                                  rinex_version=rinex_version)


def summarize(frame) -> dict:
    """Latest-epoch median of package VTEC; expose zenith VEq separately."""
    import polars as pl
    empty = {"gg_vtec": None, "gg_veq": None, "gg_samples": 0,
             "gg_engine": ENGINE, "gg_version": VERSION, "gg_status": "awaiting_valid_calibration_arcs"}
    if frame.is_empty() or "vtec" not in frame.columns:
        return empty
    valid = frame.filter(pl.col("vtec").is_finite() & (pl.col("vtec") > 0))
    if valid.is_empty():
        return empty
    latest = valid.filter(pl.col("epoch") == valid["epoch"].max())
    veq = latest["veq"].drop_nulls() if "veq" in latest.columns else None
    return {**empty, "gg_vtec": float(latest["vtec"].median()),
            "gg_veq": float(veq.median()) if veq is not None and len(veq) else None,
            "gg_samples": len(latest), "gg_epoch_gps": valid["epoch"].max().isoformat(),
            "gg_status": "ready"}


class LivePytecgg:
    """Bounded raw buffers; calibration runs in a worker, never the NTRIP thread."""
    def __init__(self):
        self._lock = Lock()
        self._rows = defaultdict(lambda: deque(maxlen=60000))
        self._results = {}

    def ingest(self, obs: dict) -> None:
        if obs.get("constellation") != "GPS":
            return
        epoch = obs.get("gps_epoch")
        signal = obs.get("signal_code")
        if epoch is None or not signal or len(signal) != 2:
            return
        pseudo, phase = obs.get("pseudorange_m"), obs.get("carrier_phase_cycles")
        if pseudo is None or phase is None or not all(map(math.isfinite, (pseudo, phase))):
            return
        code = str(obs["station"]).lower().rstrip("_")
        with self._lock:
            rows = self._rows[code]
            rows.append((epoch, obs["prn"], signal, pseudo, phase, obs["epoch"]))
            cutoff = epoch - timedelta(hours=2)
            while rows and rows[0][0] < cutoff:
                rows.popleft()

    def calibrate(self, code: str, receiver_pos, nav_path: Path) -> None:
        import polars as pl
        from pytecgg.parsing import read_rinex_nav
        with self._lock:
            rows = list(self._rows.get(code, ()))
        if not rows:
            return
        if len({row[0] for row in rows}) < MIN_ARC_LENGTH:
            self.failed(code, "awaiting_valid_calibration_arcs")
            return
        observations = []
        receipts = {}
        for epoch, sv, signal, pseudo, phase, received in rows:
            receipts[epoch] = received
            observations.extend([{"epoch": epoch, "sv": sv, "observable": f"C{signal}", "value": pseudo},
                                 {"epoch": epoch, "sv": sv, "observable": f"L{signal}", "value": phase}])
        obs = pl.DataFrame(observations).unique(subset=["epoch", "sv", "observable"], keep="last").sort(["epoch", "sv"])
        # A single common time system and receiver position applies to the batch.
        result = summarize(calibrate_observations(obs, read_rinex_nav(nav_path), receiver_pos, code))
        if result["gg_vtec"] is not None:
            epoch = datetime.fromisoformat(result["gg_epoch_gps"])
            result["gg_time"] = receipts[epoch].isoformat()
        with self._lock:
            self._results[code] = result

    def status(self, code: str) -> dict:
        with self._lock:
            result = dict(self._results.get(code, {}))
            rows = self._rows.get(code, ())
            result["gg_input_epochs"] = len({row[0] for row in rows})
            result["gg_input_signals"] = sorted({row[2] for row in rows})
        if result.get("gg_time"):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(result["gg_time"])).total_seconds()
            if age > 600 or age < -120:
                return {"gg_status": "awaiting_fresh_pytecgg_result",
                        "gg_input_epochs": result["gg_input_epochs"],
                        "gg_input_signals": result["gg_input_signals"]}
        return result

    def failed(self, code: str, reason: str) -> None:
        with self._lock:
            self._results[code] = {"gg_status": reason}
