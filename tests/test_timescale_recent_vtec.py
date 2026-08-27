from __future__ import annotations

from datetime import datetime, timezone

from zgiis.db import timescale as timescale_mod
from zgiis.db.timescale import TecDB


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
