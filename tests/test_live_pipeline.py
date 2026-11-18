"""Tests for live pipeline helpers."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock

import numpy as np
import pandas as pd

from zgiis.live.mountpoints import default_station_mountpoints, order_mountpoints, parse_mountpoints
from zgiis.live.satellite_geometry import LiveNavCache, llh_to_ecef
from zgiis.live.stec_vtec import (
    LiveVtecAccumulator,
    LiveVtecPipeline,
    mapping_function,
    stec_from_phase,
    tecg_from_pseudorange,
)
from tec_core import _C_LIGHT, _F1, _F2, _K, _mapping_function


def test_default_station_mountpoints_has_25_sites():
    mapping = default_station_mountpoints()
    assert len(mapping) == 25
    assert "hara" in mapping
    assert mapping["hara"] == "HARA"
    assert mapping["nkay"] == "NKAY"


def test_parse_mountpoints_expands_zingsa_hq(monkeypatch):
    monkeypatch.setenv("NTRIP_HOST", "caster.example")
    monkeypatch.setenv("NTRIP_USERNAME", "user")
    monkeypatch.setenv("NTRIP_PASSWORD", "pass")
    monkeypatch.setenv("NTRIP_MOUNTPOINT", "ZINGSA_HQ")
    monkeypatch.delenv("NTRIP_MOUNTPOINTS", raising=False)
    mapping = parse_mountpoints()
    assert len(mapping) == 25


def test_order_mountpoints_prioritizes_online_codes():
    mapping = {"hara": "HARA", "masv": "MASV", "zinh": "ZINH"}
    ordered = order_mountpoints(mapping, ["masv", "missing"])
    assert list(ordered) == ["masv", "hara", "zinh"]


def test_live_nav_cache_elevation_for_gps_with_ephemeris():
    cache = LiveNavCache()
    msg = MagicMock()
    msg.DF009 = 5
    msg.DF092 = 5153.5
    msg.DF090 = 0.01
    msg.DF088 = 0.5
    msg.DF087 = 0.0
    msg.DF099 = 0.2
    msg.DF095 = 0.3
    msg.DF100 = 0.0
    msg.DF097 = 0.9
    msg.DF079 = 0.0
    msg.DF089 = 0.0
    msg.DF091 = 0.0
    msg.DF098 = 0.0
    msg.DF086 = 0.0
    msg.DF094 = 0.0
    msg.DF096 = 0.0
    msg.DF093 = 0.0
    cache.update_gps_ephemeris(msg)
    elev = cache.elevation_deg("hara", "G05", datetime.now(tz=timezone.utc))
    # Mock ephemeris may place the satellite below the horizon; we only require
    # that geometry runs end-to-end and returns a finite angle.
    assert elev is not None
    assert np.isfinite(elev)
    assert -90.0 <= elev <= 90.0


def test_rtcm_1019_semicircles_match_rinex_radians():
    from types import SimpleNamespace
    from zgiis.live.satellite_geometry import _nav_row_from_rtcm_1019

    msg = SimpleNamespace(DF009=5, DF092=5153.5, DF090=0.01,
                          DF088=0.5, DF087=1e-9, DF099=0.2, DF095=-0.3,
                          DF100=-2e-9, DF097=0.31, DF079=1e-10,
                          DF089=1e-6, DF091=2e-6, DF098=50.0, DF086=20.0,
                          DF094=3e-6, DF096=4e-6, DF093=86400.0)
    sv, nav = _nav_row_from_rtcm_1019(msg)
    assert sv == 5
    for name, raw in [("M0", .5), ("DeltaN", 1e-9), ("omega", .2), ("Omega0", -.3),
                      ("OmegaDot", -2e-9), ("Io", .31), ("IDOT", 1e-10)]:
        assert np.isclose(nav[name], raw * np.pi, rtol=1e-12, atol=0)
    assert nav["Cuc"] == 1e-6
    assert nav["Cis"] == 4e-6


def test_accumulator_requires_elevation():
    epoch = datetime.now(tz=timezone.utc)
    f1, f2 = 1575.42e6, 1227.60e6
    cp1 = 1_000_000.0
    # Small L1–L2 phase difference (~7 mm) → VTEC within sanity bounds (0–200 TECU).
    diff_m = 0.007
    cp2 = (cp1 / f1 - diff_m / 2.99792458e8) * f2
    obs1 = {
        "station": "hara",
        "prn": "G05",
        "constellation": "GPS",
        "sig_idx": 1,
        "carrier_phase_cycles": cp1,
        "freq1_hz": f1,
        "freq2_hz": f2,
        "epoch": epoch,
    }
    obs2 = {**obs1, "sig_idx": 2, "carrier_phase_cycles": cp2}
    acc_no_elev = LiveVtecAccumulator(elevation_mask_deg=10.0)
    assert acc_no_elev.ingest(obs1) is None
    assert acc_no_elev.ingest(obs2) is None

    obs1e = {**obs1, "elevation_deg": 45.0}
    obs2e = {**obs2, "elevation_deg": 45.0}
    acc_with_elev = LiveVtecAccumulator(elevation_mask_deg=10.0)
    assert acc_with_elev.ingest(obs1e) is None
    result = acc_with_elev.ingest(obs2e)
    assert result is not None
    assert result["vtec_tecu"] > 0
    assert result["tecp_tecu"] == result["stec_tecu"]
    assert result["tec_method"] == "gopi_eq_4_12_phase_only_live_unleveled"
    assert result["bias_method"] == "none_live_no_dcb"


def test_live_tec_formula_matches_gopi_core_constants():
    diff_m = 0.012
    l1_cycles = 1_000_000.0
    l2_cycles = (l1_cycles * _C_LIGHT / _F1 - diff_m) * _F2 / _C_LIGHT

    live_stec = stec_from_phase(l1_cycles, l2_cycles, _F1, _F2)
    core_stec = _K * diff_m / 1e16

    assert abs(live_stec - core_stec) < 1e-9
    assert abs(mapping_function(45.0, 350.0) - float(_mapping_function(pd.Series([45.0]), 350.0)[0])) < 1e-12


def test_live_tecg_from_pseudorange_matches_gopi_eq_4_11():
    p1 = 20_200_000.0
    p2 = p1 + 0.5
    assert abs(tecg_from_pseudorange(p1, p2, _F1, _F2) - (_K * 0.5 / 1e16)) < 1e-9


def test_sansa_1004_and_zimbabwe_msm_use_identical_code_tec_math():
    from types import SimpleNamespace
    from zgiis.live.ntrip_stream import _extract_gps_1004, _extract_msm

    epoch = datetime.now(timezone.utc)
    p1, delta = 21_000_000.0, 8.0
    total_ms = p1 / _C_LIGHT * 1000
    integer_ms = int(total_ms)
    legacy = SimpleNamespace(DF006=1, DF009_01=12,
        DF011_01=p1 - integer_ms * _C_LIGHT * .001, DF014_01=integer_ms,
        DF017_01=delta, DF012_01=.25, DF018_01=.5)
    msm = SimpleNamespace(NSat=1, NCell=2, PRN_01="12", DF397_01=integer_ms,
        DF398_01=total_ms-integer_ms, CELLPRN_01="12", CELLPRN_02="12",
        CELLSIG_01="1C", CELLSIG_02="2W", DF400_01=0.0,
        DF400_02=delta/_C_LIGHT*1000, DF401_01=.25/_C_LIGHT*1000,
        DF401_02=.5/_C_LIGHT*1000)
    results = []
    for records in [_extract_gps_1004(legacy, "ptbg", epoch), _extract_msm(msm, 1074, "GPS", "beit", epoch)]:
        assert len(records) == 2
        accumulator = LiveVtecAccumulator()
        for record in records:
            result = accumulator.ingest({**record, "elevation_deg": 60.0})
        assert result is not None
        expected_stec = _K * delta / 1e16
        expected_vtec = expected_stec / float(_mapping_function(pd.Series([60.0]), 350.0)[0])
        assert abs(result["tecg_tecu"] - expected_stec) < .0001
        assert abs(result["vtec_tecu"] - expected_vtec) < .0001
        results.append(result["vtec_tecu"])
    assert results[0] == results[1]


def test_zimbabwe_and_sansa_pipeline_and_station_screening_are_identical():
    """Network/station identity must not change TEC or accept a rejected high estimate."""
    now = datetime.now(timezone.utc)
    for base_vtec, expected_display in [(27.0, 28.0), (83.0, None)]:
        displayed = []
        for station, lookback in [("beit", 90.0), ("ptbg", 600.0)]:
            pipeline = LiveVtecPipeline()
            for i, prn in enumerate(["G03", "G06", "G12"]):
                p1 = 21_000_000.0
                stec = (base_vtec + i) * mapping_function(60.0)
                p2 = p1 + stec * 1e16 / _K
                for band, pseudo, frequency in [(1, p1, _F1), (2, p2, _F2)]:
                    pipeline.ingest({"station": station, "prn": prn, "epoch": now,
                        "constellation": "GPS", "sig_idx": band, "pseudorange_m": pseudo,
                        "carrier_phase_cycles": (p1 + band * .25) * frequency / _C_LIGHT,
                        "freq1_hz": _F1, "freq2_hz": _F2, "elevation_deg": 60.0})
            assert pipeline._latest[station]["bias_method"] == "none_live_no_dcb"
            assert abs(pipeline._latest[station]["vtec_tecu"] - (base_vtec + 2)) < .0001
            value = pipeline.latest_by_station(max_age_s=lookback).get(station)
            displayed.append(value)
            if expected_display is None:
                assert value is None
            else:
                assert abs(value - expected_display) < .0001
        assert displayed[0] == displayed[1]


def test_pipeline_flush_db_on_pending():
    class FakeDB:
        def __init__(self):
            self.rows = []

        def insert_vtec(self, rows):
            self.rows.extend(rows)
            return len(rows)

    db = FakeDB()
    pipeline = LiveVtecPipeline(db=db, db_flush_n=100)
    pipeline._pending = [{"epoch": datetime.now(tz=timezone.utc), "station": "hara", "vtec_tecu": 12.0}]
    pipeline.flush_db()
    assert len(db.rows) == 1
    assert pipeline._pending == []


def test_archive_write_releases_pending_lock_until_batch_finishes():
    import threading

    writing = threading.Event()
    finish = threading.Event()

    class SlowDB:
        def insert_vtec(self, rows):
            writing.set()
            return len(rows) if finish.wait(3) else 0

    pipeline = LiveVtecPipeline(db=SlowDB(), db_flush_n=None)
    pipeline._pending.append({"station": "rubo"})
    worker = threading.Thread(target=pipeline.flush_db)
    worker.start()
    try:
        assert writing.wait(2)
        assert pipeline._pending_lock.acquire(timeout=1)
        try:
            pipeline._pending.append({"station": "cn64"})
        finally:
            pipeline._pending_lock.release()
    finally:
        finish.set()
        worker.join(timeout=3)
    assert pipeline._pending == [{"station": "cn64"}]


def test_llh_to_ecef_reasonable_magnitude():
    ecef = llh_to_ecef(-17.78, 31.05, 1525.0)
    assert np.linalg.norm(ecef) > 6.3e6
