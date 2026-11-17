"""The SANSA adapter must use package calculations, not the legacy live fit."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np
import pytest

from zgiis.processing.sansa_pytecgg import LivePytecgg, gps_epoch


def test_rtcm_source_epoch_and_signals_are_preserved_for_pytecgg():
    from zgiis.live.ntrip_stream import _extract_gps_1004
    received = datetime(2026, 11, 17, 6, 0, 0, 123456, tzinfo=timezone.utc)
    msg = SimpleNamespace(DF006=1, DF004=194400000, DF009_01=12,
        DF011_01=100000.0, DF014_01=70, DF017_01=8.0,
        DF012_01=.25, DF018_01=.5, DF010_01=0, DF016_01=3)
    records = _extract_gps_1004(msg, "tdou", received)
    assert [r["signal_code"] for r in records] == ["1C", "2W"]
    assert all(r["epoch"] == received for r in records)  # GOPI receipt time unchanged
    assert records[0]["gps_epoch"] == datetime(2026, 11, 17, 6, tzinfo=timezone.utc)
    assert gps_epoch(None, received) is None
    assert gps_epoch(604800000, received) is None
    sunday = datetime(2026, 11, 15, tzinfo=timezone.utc)
    assert gps_epoch(604799000, sunday) == sunday - timedelta(seconds=1)


def test_incomplete_metadata_is_not_relabelled_as_pytecgg():
    live = LivePytecgg()
    live.ingest({"station": "tdou", "constellation": "GPS", "vtec_tecu": 22.0})
    assert not live._rows
    assert live.status("tdou")["gg_input_epochs"] == 0


@pytest.mark.parametrize("indicator,signal", [(0, "2X"), (1, "2P"), (2, "2D"), (3, "2W")])
def test_all_legacy_l2_code_indicators_reach_the_package_input(indicator, signal):
    from zgiis.live.ntrip_stream import _extract_gps_1004
    received = datetime.now(timezone.utc)
    msg = SimpleNamespace(DF006=1, DF004=194400000, DF009_01=12,
        DF011_01=100000.0, DF014_01=70, DF017_01=8.0,
        DF012_01=.25, DF018_01=.5, DF010_01=0, DF016_01=indicator)
    records = _extract_gps_1004(msg, "tdou", received)
    assert records[1]["signal_code"] == signal
    live = LivePytecgg()
    for record in records:
        live.ingest(record)
    assert live.status("tdou")["gg_input_signals"] == ["1C", signal]


def test_raw_receiver_buffers_are_independent_and_results_expire():
    live = LivePytecgg()
    received = datetime.now(timezone.utc)
    sample = {"station": "tdou", "constellation": "GPS", "gps_epoch": received,
              "epoch": received, "prn": "G12", "signal_code": "1C",
              "pseudorange_m": 21_000_000.0, "carrier_phase_cycles": 100_000.0}
    live.ingest(sample)
    live.ingest({**sample, "station": "pret"})
    assert len(live._rows["tdou"]) == len(live._rows["pret"]) == 1
    live._results["tdou"] = {"gg_vtec": 25.0, "gg_time": (received - timedelta(minutes=11)).isoformat()}
    assert "gg_vtec" not in live.status("tdou")


def test_summary_uses_latest_package_epoch_and_keeps_veq_separate():
    pl = pytest.importorskip("polars")
    from zgiis.processing.sansa_pytecgg import summarize
    t = datetime(2026, 11, 17, tzinfo=timezone.utc)
    frame = pl.DataFrame({"epoch": [t, t + timedelta(seconds=30), t + timedelta(seconds=30)],
                          "vtec": [60.0, 24.0, 26.0], "veq": [40.0, 23.0, 23.0]})
    result = summarize(frame)
    assert result["gg_vtec"] == 25.0
    assert result["gg_veq"] == 23.0
    assert result["gg_samples"] == 2
    assert result["gg_engine"] == "pytecgg"


def test_adapter_agrees_with_direct_notebook_pipeline(monkeypatch):
    """Synthetic code+phase, actual package calibration; same geometry for both.

    Geometry is controlled to isolate adapter/calibration agreement. This is
    not an external validation of today's live receivers or navigation.
    """
    pl = pytest.importorskip("polars")
    pytest.importorskip("pytecgg")
    from pymap3d import aer2ecef, geodetic2ecef
    from pytecgg import GNSSContext
    from pytecgg.linear_combinations.lc_calculation import calculate_linear_combinations
    from pytecgg.satellites import ephemeris, positions
    from pytecgg.satellites.ipp import calculate_ipp
    from pytecgg.tec_calibration.arcs import extract_arcs
    from pytecgg.tec_calibration.calibration import calculate_tec, calculate_vertical_equivalent
    from pytecgg.tec_calibration.calibration_preprocessing import _mapping_function
    from polars.testing import assert_frame_equal
    from zgiis.processing.sansa_pytecgg import calibrate_observations

    lat, lon = -23.08, 30.38
    receiver = tuple(geodetic2ecef(lat, lon, 0.0))
    start = datetime(2026, 11, 17, tzinfo=timezone.utc)
    raw, geometry = [], []
    f1, f2, c = 1575.42e6, 1227.60e6, 299792458.0
    k = f1**2 * f2**2 / (40.308 * (f1**2 - f2**2)) / 1e16
    for epoch_index in range(90):
        epoch = start + timedelta(seconds=30 * epoch_index)
        for sat in range(1, 9):
            sv = f"G{sat:02d}"
            elevation = 35 + sat * 3 + 5 * np.sin(epoch_index / 40 + sat)
            azimuth = sat * 43 + epoch_index / 5
            xyz = aer2ecef(azimuth, elevation, 21e6, lat, lon, 0.0)
            geometry.append(dict(epoch=epoch, sv=sv, sat_x=xyz[0], sat_y=xyz[1], sat_z=xyz[2]))
            mapping = float(_mapping_function(np.array([elevation]), 350000)[0])
            stec = 25.0 / mapping
            p1, p2 = 21e6, 21e6 + (stec + sat * .5) / k
            l1, l2 = 21e6 * f1 / c, (21e6 - stec / k - sat * 10) * f2 / c
            for observable, value in [("C1C", p1), ("C2W", p2), ("L1C", l1), ("L2W", l2)]:
                raw.append(dict(epoch=epoch, sv=sv, observable=observable, value=value))
    obs, coords = pl.DataFrame(raw), pl.DataFrame(geometry)
    monkeypatch.setattr(ephemeris, "prepare_ephemeris", lambda *args: {})
    monkeypatch.setattr(positions, "satellite_coordinates", lambda **kwargs: coords)

    # Independent reference: literal notebook calls, no SANSA summary or helpers.
    ctx = GNSSContext(receiver_pos=receiver, receiver_name="tdou", rinex_version="3.04",
                      h_ipp=350000, systems=["GPS"])
    linear = calculate_linear_combinations(obs_data=obs, ctx=ctx,
        combinations=["gflc_phase", "gflc_code", "mw"], selection_mode="quality")
    linear = calculate_ipp(df=linear.join(coords, on=["sv", "epoch"]), ctx=ctx, min_elevation=20.0)
    arcs = extract_arcs(df=linear, ctx=ctx, threshold_abs=5.0, threshold_std=5.0,
                        min_arc_length=30, threshold_jump=10.0)
    expected = calculate_tec(df=arcs, ctx=ctx, max_polynomial_degree=3, batch_size_epochs=30)
    expected = calculate_vertical_equivalent(df_calibrated=expected, ctx=ctx,
        max_polynomial_degree=3, batch_size_epochs=30)
    actual = calibrate_observations(obs, {}, receiver, "tdou")
    zimbabwe = calibrate_observations(obs, {}, receiver, "beit")
    assert actual["vtec"].drop_nulls().len() > 0
    columns = ["epoch", "sv", "bias", "stec", "vtec", "veq"]
    assert_frame_equal(actual.select(columns).sort(["epoch", "sv"]),
                       expected.select(columns).sort(["epoch", "sv"]))
    assert_frame_equal(zimbabwe.select(columns).sort(["epoch", "sv"]),
                       actual.select(columns).sort(["epoch", "sv"]))
