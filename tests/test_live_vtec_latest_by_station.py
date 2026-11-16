from __future__ import annotations

from datetime import datetime, timedelta, timezone

from zgiis.live.stec_vtec import LiveVtecPipeline


def test_latest_by_station_rejects_tsho_low_bias_prn():
    """TSHO often ends on G14 ~7 TECU while peer PRNs sit near ~22."""
    pipe = LiveVtecPipeline(db=None)
    now = datetime.now(timezone.utc)
    for i in range(20):
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=90 - i),
                "station": "tsho",
                "prn": "G03",
                "vtec_tecu": 22.4,
            }
        )
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=90 - i),
                "station": "tsho",
                "prn": "G06",
                "vtec_tecu": 24.1,
            }
        )
    for i in range(80):
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=40 - i % 40),
                "station": "tsho",
                "prn": "G14",
                "vtec_tecu": 6.7,
            }
        )
    # Last sample is the biased PRN — old behaviour would report ~6.7.
    pipe._latest["tsho"] = {
        "epoch": now,
        "station": "tsho",
        "prn": "G14",
        "vtec_tecu": 6.5,
    }
    by = pipe.latest_by_station(max_age_s=120.0)
    assert "tsho" in by
    assert 18.0 <= float(by["tsho"]) <= 26.0


def test_regional_tec_keeps_measurements_above_zimbabwe_display_ceiling():
    pipe = LiveVtecPipeline(db=None)
    now = datetime.now(timezone.utc)
    for prn, value in [("G01", 70.0), ("G03", 72.0), ("G06", 74.0), ("G12", 190.0)]:
        for _ in range(20 if prn == "G12" else 1):
            pipe._recent["ptbg"].append({"epoch": now, "station": "ptbg", "prn": prn, "vtec_tecu": value, "tec_method": "gopi_eq_4_11_code_live"})
    result = pipe.latest_by_station(regional=True, max_age_s=600)
    assert result["ptbg"] == 72.0
    assert "ptbg" not in pipe.latest_by_station()


def test_regional_tec_retains_rotation_samples_and_expires_old_readings():
    pipe = LiveVtecPipeline(db=None)
    now = datetime.now(timezone.utc)
    for code, age in [("ptbg", 300), ("nyls", 601), ("nspt", -601)]:
        pipe._recent[code].append({"epoch": now - timedelta(seconds=age), "station": code, "prn": "G01", "vtec_tecu": 75.0, "tec_method": "gopi_eq_4_11_code_live"})
    result = pipe.latest_by_station(regional=True, max_age_s=600)
    assert result == {"ptbg": 75.0}


def test_regional_reading_never_uses_unleveled_phase_tec():
    pipe = LiveVtecPipeline(db=None)
    pipe._recent["ptbg"].append({"epoch": datetime.now(timezone.utc), "station": "ptbg", "prn": "G01", "vtec_tecu": 75.0,
                                 "tec_method": "gopi_eq_4_12_phase_only_live_unleveled"})
    assert pipe.latest_by_station(regional=True) == {}
