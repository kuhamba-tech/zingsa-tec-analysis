from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from zgiis.db import timescale as timescale_mod
from zgiis.db.timescale import TecDB
from zgiis.maps.heatmap_data import _fresh_station_vtec_from_group


def test_recent_station_vtec_sqlite_like_code_live(tmp_path, monkeypatch):
    db_path = tmp_path / "vtec_live.db"
    monkeypatch.setattr(timescale_mod, "_SQLITE_PATH", db_path)
    monkeypatch.setattr(timescale_mod, "_SHARED_SQLITE_CONN", None)
    monkeypatch.setattr(timescale_mod, "_PG_SCHEMA_READY", False)

    db = TecDB(dsn="")
    now = datetime.now(timezone.utc)
    db.insert_vtec(
        [
            {
                "epoch": now,
                "station": "hara",
                "constellation": "GPS",
                "prn": "G01",
                "tecg_tecu": None,
                "tecp_tecu": None,
                "stec_tecu": 20.0,
                "vtec_tecu": 18.4,
                "elevation_deg": 40.0,
                "cnr_dbhz": 45.0,
                "tec_method": "gopi_eq_4_11_code_live",
                "bias_method": "none",
            },
            {
                "epoch": now,
                "station": "masv",
                "constellation": "GPS",
                "prn": "G02",
                "tecg_tecu": None,
                "tecp_tecu": None,
                "stec_tecu": 40.0,
                "vtec_tecu": 55.0,
                "elevation_deg": 40.0,
                "cnr_dbhz": 45.0,
                "tec_method": "dlr_ionex",
                "bias_method": "none",
            },
        ]
    )

    df = db.recent_station_vtec(minutes=10, code_live_only=True)
    assert not df.empty
    by = {str(row["station"]): float(row["mean_vtec"]) for _, row in df.iterrows()}
    assert by["hara"] == 18.4
    assert "masv" not in by


def test_fresh_station_vtec_prefers_newest_slice():
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(20):
        rows.append(
            {
                "time": now - timedelta(seconds=90 - i),
                "station": "zinh",
                "prn": "G01",
                "vtec_tecu": 10.0,
            }
        )
    for i in range(10):
        rows.append(
            {
                "time": now - timedelta(seconds=20 - i),
                "station": "zinh",
                "prn": "G01",
                "vtec_tecu": 22.0 + i * 0.1,
            }
        )
    group = pd.DataFrame(rows)
    vtec = _fresh_station_vtec_from_group(group)
    assert vtec is not None
    # Must track the newest ~45s slice (~22 TECU), not the older 10 TECU block.
    assert 21.0 <= float(vtec) <= 24.0


def test_beit_low_bias_prn_rejected():
    """BEIT-like: G01 ~2 TECU dominates sample count; G30 ~21 matches the ionosphere."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(80):
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "beit", "prn": "G01", "vtec_tecu": 1.7})
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "beit", "prn": "G14", "vtec_tecu": 7.2})
    for i in range(30):
        rows.append({"time": now - timedelta(seconds=30 - i % 30), "station": "beit", "prn": "G30", "vtec_tecu": 20.9})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 18.0 <= float(vtec) <= 23.0


def test_lupa_mid_bias_prn_rejected():
    """LUPA-like: G01/G14 sit mid-low (~3/9) while G30 ~19 matches peers."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(100):
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "lupa", "prn": "G01", "vtec_tecu": 3.3})
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "lupa", "prn": "G14", "vtec_tecu": 9.6})
    for i in range(40):
        rows.append({"time": now - timedelta(seconds=30 - i % 30), "station": "lupa", "prn": "G30", "vtec_tecu": 19.3})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 17.0 <= float(vtec) <= 22.0


def test_recent_station_vtec_tracks_fresh_slice(tmp_path, monkeypatch):
    db_path = tmp_path / "vtec_fresh.db"
    monkeypatch.setattr(timescale_mod, "_SQLITE_PATH", db_path)
    monkeypatch.setattr(timescale_mod, "_SHARED_SQLITE_CONN", None)
    monkeypatch.setattr(timescale_mod, "_PG_SCHEMA_READY", False)

    db = TecDB(dsn="")
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(15):
        rows.append(
            {
                "epoch": now - timedelta(seconds=80 - i),
                "station": "zinh",
                "constellation": "GPS",
                "prn": "G01",
                "tecg_tecu": None,
                "tecp_tecu": None,
                "stec_tecu": 10.0,
                "vtec_tecu": 10.0,
                "elevation_deg": 40.0,
                "cnr_dbhz": 45.0,
                "tec_method": "gopi_eq_4_11_code_live",
                "bias_method": "none",
            }
        )
    for i in range(12):
        rows.append(
            {
                "epoch": now - timedelta(seconds=25 - i),
                "station": "zinh",
                "constellation": "GPS",
                "prn": f"G{i+1:02d}",
                "tecg_tecu": None,
                "tecp_tecu": None,
                "stec_tecu": 23.0,
                "vtec_tecu": 23.0,
                "elevation_deg": 40.0,
                "cnr_dbhz": 45.0,
                "tec_method": "gopi_eq_4_11_code_live",
                "bias_method": "none",
            }
        )
    db.insert_vtec(rows)
    df = db.recent_station_vtec(minutes=0.75, code_live_only=True)
    by = {str(row["station"]): float(row["mean_vtec"]) for _, row in df.iterrows()}
    assert abs(by["zinh"] - 23.0) < 0.5
