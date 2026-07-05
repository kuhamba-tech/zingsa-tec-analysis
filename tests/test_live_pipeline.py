"""Tests for live pipeline helpers."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock

import numpy as np

from zgiis.live.mountpoints import default_station_mountpoints, parse_mountpoints
from zgiis.live.satellite_geometry import LiveNavCache, llh_to_ecef
from zgiis.live.stec_vtec import LiveVtecAccumulator, LiveVtecPipeline


def test_default_station_mountpoints_has_24_sites():
    mapping = default_station_mountpoints()
    assert len(mapping) == 24
    assert "hara" in mapping
    assert mapping["hara"] == "HARA"


def test_parse_mountpoints_expands_zingsa_hq(monkeypatch):
    monkeypatch.setenv("NTRIP_HOST", "caster.example")
    monkeypatch.setenv("NTRIP_USERNAME", "user")
    monkeypatch.setenv("NTRIP_PASSWORD", "pass")
    monkeypatch.setenv("NTRIP_MOUNTPOINT", "ZINGSA_HQ")
    monkeypatch.delenv("NTRIP_MOUNTPOINTS", raising=False)
    mapping = parse_mountpoints()
    assert len(mapping) == 24


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


def test_pipeline_flush_db_on_pending():
    class FakeDB:
        def __init__(self):
            self.rows = []

        def insert_vtec(self, rows):
            self.rows.extend(rows)

    db = FakeDB()
    pipeline = LiveVtecPipeline(db=db, db_flush_n=100)
    pipeline._pending = [{"epoch": datetime.now(tz=timezone.utc), "station": "hara", "vtec_tecu": 12.0}]
    pipeline.flush_db()
    assert len(db.rows) == 1
    assert pipeline._pending == []


def test_llh_to_ecef_reasonable_magnitude():
    ecef = llh_to_ecef(-17.78, 31.05, 1525.0)
    assert np.linalg.norm(ecef) > 6.3e6
