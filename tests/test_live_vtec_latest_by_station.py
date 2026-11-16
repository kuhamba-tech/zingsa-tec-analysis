from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

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


def test_shared_quality_screen_retains_real_tec_for_full_rotation_window():
    pipe = LiveVtecPipeline(db=None)
    now = datetime.now(timezone.utc)
    for code, age in [("ptbg", 300), ("nyls", 601)]:
        for prn, value in [("G01", 26.0), ("G03", 28.0), ("G06", 30.0)]:
            pipe._recent[code].append(
                {
                    "epoch": now - timedelta(seconds=age),
                    "station": code,
                    "prn": prn,
                    "vtec_tecu": value,
                    "tec_method": "gopi_eq_4_11_code_live",
                }
            )
    result = pipe.latest_by_station(max_age_s=600)
    assert "ptbg" in result
    assert 26.0 <= result["ptbg"] <= 30.0
    assert "nyls" not in result


def test_pipeline_tracks_code_tec_time_separately_from_phase_only_updates():
    pipe = LiveVtecPipeline(db=None)
    code_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    phase_time = datetime.now(timezone.utc)

    def emit(obs):
        return (
            {
                "epoch": obs["epoch"],
                "station": obs["station"],
                "prn": "G01",
                "vtec_tecu": 24.0,
                "tec_method": obs["tec_method"],
            },
            "ok",
        )

    with patch.object(pipe._acc, "ingest_with_reason", side_effect=emit):
        pipe.ingest({"station": "ptbg", "epoch": code_time, "tec_method": "gopi_eq_4_11_code_live"})
        pipe.ingest({"station": "ptbg", "epoch": phase_time, "tec_method": "gopi_eq_4_12_phase_only_live_unleveled"})

    diagnostic = pipe.diagnostics_by_station()["ptbg"]
    assert diagnostic["last_vtec_at"] == phase_time.isoformat()
    assert diagnostic["last_code_vtec_at"] == code_time.isoformat()


def test_regional_reading_never_uses_unleveled_phase_tec():
    pipe = LiveVtecPipeline(db=None)
    pipe._recent["ptbg"].append({"epoch": datetime.now(timezone.utc), "station": "ptbg", "prn": "G01", "vtec_tecu": 75.0,
                                 "tec_method": "gopi_eq_4_12_phase_only_live_unleveled"})
    assert pipe.latest_by_station(regional=True) == {}
