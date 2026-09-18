from unittest.mock import patch

import pandas as pd

from zgiis.space_weather.report_builder import build_space_weather_report


def test_report_handles_archive_without_optional_tec_column():
    archive = pd.DataFrame(
        [
            {
                "time": pd.Timestamp("2026-08-25T06:00:00Z"),
                "kp": 2.0,
                "dst": -12.0,
                "f107": 138.0,
                "plasma_speed": 352.0,
                "s4": 0.05,
                "gnss_risk": "Low",
                "gnss_risk_score": 0.0,
            }
        ]
    )

    with patch(
        "zgiis.db.space_weather_db.SpaceWeatherDB.query_dataframe",
        return_value=archive,
    ):
        report = build_space_weather_report("daily")

    assert report["sample_count"] == 1
    tec = next(parameter for parameter in report["parameters"] if parameter["name"] == "TEC (Network Mean)")
    assert tec["current"] is None
    assert tec["trend"] == "stable"
    assert report["charts"]["tec"] == [None]
    assert report["generated_utc"].endswith("Z")
    assert "+00:00Z" not in report["generated_utc"]
