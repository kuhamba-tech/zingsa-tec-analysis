from unittest.mock import patch

import pandas as pd

from backend.schemas import SpaceWeatherReportResponse
from zgiis.space_weather.report_builder import build_space_weather_report, _trend


def report_for(rows):
    with patch("zgiis.db.space_weather_db.read_log_dataframe", return_value=pd.DataFrame(rows)) as read:
        report = build_space_weather_report("daily")
    assert read.call_args.kwargs["resample"] is None
    # Verify the API schema retains the assessment rather than dropping it.
    return SpaceWeatherReportResponse(**report).model_dump()


def prose(report):
    return " ".join(p for section in report["sections"] for p in section["paragraphs"])


def test_quiet_report_does_not_claim_local_service_or_grid_impacts():
    report = report_for([{"time": "2026-11-09T10:00:00Z", "kp": 2.2, "dst": -24, "mean_vtec": 32}])
    assert "quiet planetary" in report["executive_summary"]
    assert "below" in report["executive_summary"]
    assert "Power-grid effects are not assessed" in prose(report)
    assert "does not establish RTK accuracy" in prose(report)
    assert "S4 observations are unavailable" in prose(report)
    assert "scientist review is recorded" in prose(report)
    assert any(card["id"] == "noon" for card in report["diurnal_cards"])
    noon = next(card for card in report["diurnal_cards"] if card["id"] == "noon")
    assert noon["status"] == "within_expected"
    assert "quiet-day expectation band" in prose(report)


def test_diurnal_anomaly_is_explained_scientifically():
    # 12:00 UTC = 14:00 CAT → noon window; 80 TECU is above the quiet noon band.
    report = report_for([{"time": "2026-11-09T12:00:00Z", "kp": 2.0, "mean_vtec": 80.0}])
    noon = next(card for card in report["diurnal_cards"] if card["id"] == "noon")
    assert noon["status"] == "above_expected"
    assert "Scientific anomaly note" in prose(report)
    assert "not automatic causation" in prose(report)

def test_earlier_storm_peak_survives_quiet_latest_record():
    report = report_for([
        {"time": "2026-11-09T09:00:00Z", "kp": 6, "dst": -110, "s4": .6},
        {"time": "2026-11-09T10:00:00Z", "kp": 2, "dst": -20, "s4": .1},
    ])
    assert "Kp reaching 6.0" in report["executive_summary"]
    assert report["impact"]["risk"] == "High"
    assert report["parameters"][0]["current"] == 2
    assert "No arrival-time forecast" in prose(report)


def test_missing_and_empty_archives_are_not_low_risk():
    for rows in ([], [{"time": "2026-11-09T10:00:00Z"}]):
        report = report_for(rows)
        assert report["impact"]["risk"] == "Unknown"
        assert "cannot be classified" in report["executive_summary"]
        assert len(report["sections"]) == 6
        assert "Unavailable parameters" in prose(report)


def test_negative_dst_trend_uses_direction_not_sign_of_baseline():
    assert _trend(pd.Series([-100, -100, -80, -80])) == "rising"
    assert _trend(pd.Series([-80, -80, -100, -100])) == "falling"
    assert _trend(pd.Series([-100, -100, -100, -100])) == "stable"
