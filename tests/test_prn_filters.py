from types import SimpleNamespace

import pandas as pd

from zgiis.db.timescale import TecDB
from zgiis.gnss_prn import prn_data


def test_live_query_applies_explicit_utc_bounds_before_limit():
    captured = {}
    def read(sql, params):
        captured.update(sql=sql, params=params)
        return pd.DataFrame()
    db = SimpleNamespace(_is_pg=False, _read_sql=read)
    TecDB.query_prn_observations(db, start="2024-04-01T12:00:00Z", end="2024-04-01T13:00:00Z", station="karo", prns=["G03"])
    assert "time <= ?" in captured["sql"]
    assert captured["params"][:2] == ["2024-04-01T12:00:00+00:00", "2024-04-01T13:00:00+00:00"]
    assert "karo" in captured["params"]
    assert "G03" in captured["params"]


def test_date_only_end_includes_last_day_but_not_next_midnight():
    captured = {}
    def read(sql, params):
        captured.update(sql=sql, params=params)
        return pd.DataFrame()
    TecDB.query_prn_observations(SimpleNamespace(_is_pg=False, _read_sql=read), start="2024-04-01", end="2024-04-01")
    assert "time < ?" in captured["sql"]
    assert captured["params"][:2] == ["2024-04-01T00:00:00+00:00", "2024-04-02T00:00:00+00:00"]


def test_source_loader_forwards_dates_to_live_query(monkeypatch):
    captured = {}
    def load(**kwargs):
        captured.update(kwargs)
        return pd.DataFrame({"timestamp": [pd.Timestamp("2024-04-01", tz="UTC")], "prn": ["G01"]})
    monkeypatch.setattr(prn_data, "load_live_prn_observations", load)
    prn_data.load_prn_observations(start="2024-04-01", end="2024-04-01")
    assert captured["start"] == "2024-04-01"
    assert captured["end"] == "2024-04-01"


def test_roti_uses_slant_tec_not_vertical_mapping_changes():
    frame = pd.DataFrame({"timestamp": pd.date_range("2024-04-01", periods=4, freq="30s", tz="UTC"),
                          "station": ["karo"] * 4, "prn": ["G03"] * 4,
                          "stec": [20.0] * 4, "vtec": [10.0, 12.0, 15.0, 18.0]})
    result = prn_data.add_ionosphere_indicators(frame)
    assert result["rot_tecu_per_min"].dropna().eq(0).all()
    assert result["roti_tecu_per_min"].dropna().eq(0).all()
