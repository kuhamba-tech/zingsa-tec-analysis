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


def test_tsho_fresh_slice_low_bias_falls_back_to_full_window():
    """TSHO-like: newest minute is only G14~7 TECU; earlier PRNs sit near ~23."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(20):
        rows.append({"time": now - timedelta(seconds=120 - i), "station": "tsho", "prn": "G03", "vtec_tecu": 22.7})
        rows.append({"time": now - timedelta(seconds=120 - i), "station": "tsho", "prn": "G06", "vtec_tecu": 25.5})
        rows.append({"time": now - timedelta(seconds=120 - i), "station": "tsho", "prn": "G17", "vtec_tecu": 19.8})
    for i in range(80):
        rows.append({"time": now - timedelta(seconds=50 - i % 50), "station": "tsho", "prn": "G14", "vtec_tecu": 6.8})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 18.0 <= float(vtec) <= 26.0


def test_lupa_rejects_extreme_g17_spike():
    """LUPA-like: G17 ~123 TECU must not pull the marker off the network band."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(80):
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "lupa", "prn": "G14", "vtec_tecu": 2.2})
        rows.append({"time": now - timedelta(seconds=40 - i % 40), "station": "lupa", "prn": "G17", "vtec_tecu": 122.0})
    for i in range(30):
        rows.append({"time": now - timedelta(seconds=30 - i % 30), "station": "lupa", "prn": "G06", "vtec_tecu": 15.2})
    # GIM is a model label, not MSM — must be ignored.
    rows.append({"time": now, "station": "lupa", "prn": "GIM", "vtec_tecu": 28.0})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 12.0 <= float(vtec) <= 22.0


def test_kwek_single_physical_prn_accepted():
    """KWEK-like: only G06 ~11 TECU after near-zero G14/G19 are dropped."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(20):
        rows.append({"time": now - timedelta(seconds=30 - i), "station": "kwek", "prn": "G06", "vtec_tecu": 11.3})
        rows.append({"time": now - timedelta(seconds=30 - i), "station": "kwek", "prn": "G14", "vtec_tecu": 0.5})
        rows.append({"time": now - timedelta(seconds=30 - i), "station": "kwek", "prn": "G19", "vtec_tecu": 0.5})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 9.0 <= float(vtec) <= 13.0


def test_cent_future_skew_spike_does_not_collapse_to_low_bias():
    """CENT-like: far-future G06~105 must not anchor the fresh slice onto G19~4."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(40):
        rows.append(
            {
                "time": now - timedelta(seconds=90 - i),
                "station": "cent",
                "prn": "G06",
                "vtec_tecu": 24.0 + (i % 5) * 0.2,
            }
        )
        rows.append(
            {
                "time": now - timedelta(seconds=90 - i),
                "station": "cent",
                "prn": "G19",
                "vtec_tecu": 4.4,
            }
        )
    # Poisoned future epochs (receiver clock / binning) previously became "latest".
    for i in range(80):
        rows.append(
            {
                "time": now + timedelta(minutes=40, seconds=i),
                "station": "cent",
                "prn": "G06",
                "vtec_tecu": 105.0,
            }
        )
        rows.append(
            {
                "time": now + timedelta(minutes=40, seconds=i),
                "station": "cent",
                "prn": "G19",
                "vtec_tecu": 4.5,
            }
        )
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is not None
    assert 18.0 <= float(vtec) <= 30.0


def test_cent_spike_plus_low_bias_omits_unphysical_value():
    """When only G19~4 and G06~105 remain, omit rather than publish ~4 TECU."""
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(60):
        rows.append({"time": now - timedelta(seconds=50 - i % 50), "station": "cent", "prn": "G06", "vtec_tecu": 105.0})
        rows.append({"time": now - timedelta(seconds=50 - i % 50), "station": "cent", "prn": "G19", "vtec_tecu": 4.5})
    vtec = _fresh_station_vtec_from_group(pd.DataFrame(rows))
    assert vtec is None


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
