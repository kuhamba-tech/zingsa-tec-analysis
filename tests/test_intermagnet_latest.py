"""South African INTERMAGNET minutes: only finite samples, with an honest age."""

import math
from datetime import datetime, timezone

from zgiis.space_weather.intermagnet_client import (
    _latest_cache,
    fetch_south_africa_latest,
    newest_recorded_day,
    parse_directory_date,
    summarise_iaga2002,
    summarise_minute_day,
)


def test_directory_date_is_day_month_year():
    assert parse_directory_date("18-10-2026") == datetime(2026, 10, 18).date()


def test_newest_day_skips_empty_files():
    days = [
        {"date": "17-10-2026", "samples_recorded": 1440},
        {"date": "18-10-2026", "samples_recorded": 1440},
        {"date": "19-10-2026", "samples_recorded": 0, "samples_missing": 1440},
        {"date": "22-10-2026", "samples_recorded": 0, "samples_missing": 1440},
    ]
    assert newest_recorded_day(days).isoformat() == "2026-10-18"


def test_summary_uses_last_finite_minute_and_marks_delay():
    payload = {
        "datetime": [
            "2026-10-18T23:57:00.000Z",
            "2026-10-18T23:58:00.000Z",
            "2026-10-18T23:59:00.000Z",
        ],
        "X": [10000.0, 10010.0, None],
        "Y": [-5000.0, -5000.0, None],
        "Z": [-22000.0, -22000.0, None],
        "F": [25000.0, 25004.0, 99999.0],
    }
    now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
    summary = summarise_minute_day(payload, now=now)
    assert summary is not None
    assert summary["time"] == "2026-10-18T23:58:00Z"
    assert summary["status"] == "delayed"
    assert summary["h_nt"] == round(math.hypot(10010.0, -5000.0), 2)
    assert summary["dhdt_nt_per_min"] == round(
        math.hypot(10010.0, -5000.0) - math.hypot(10000.0, -5000.0),
        3,
    )
    assert summary["samples"] == 2
    assert summary["f_nt"] == 25004.0


def test_recent_sample_is_near_real_time():
    payload = {
        "datetime": ["2026-10-22T11:58:00.000Z", "2026-10-22T11:59:00.000Z"],
        "X": [10000.0, 10001.0],
        "Y": [0.0, 0.0],
        "Z": [0.0, 0.0],
        "F": [10000.0, 10001.0],
    }
    now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
    summary = summarise_minute_day(payload, now=now)
    assert summary["status"] == "near-real-time"
    assert summary["age_minutes"] == 1.0
    assert summary["dhdt_nt_per_min"] == 1.0


def test_iaga_skips_missing_sentinel():
    text = (
        "2026-10-18 23:58:00.000 291     10907.70  -1663.89 -22562.20  25061.10\n"
        "2026-10-18 23:59:00.000 291     99999.00   99999.00  99999.00  99999.00\n"
    )
    now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
    summary = summarise_iaga2002(text, now=now)
    assert summary is not None
    assert summary["time"] == "2026-10-18T23:58:00Z"
    assert summary["x_nt"] == 10907.70
    assert summary["h_nt"] == round(math.hypot(10907.70, -1663.89), 2)
    assert summary["samples"] == 1


def test_fetch_skips_empty_days(monkeypatch):
    _latest_cache["at"] = 0.0
    _latest_cache["payload"] = None

    def fake_gin(params, timeout=45):
        assert params["Request"] == "GetDataDirectory"
        return {
            "data": [
                {
                    "iaga_code": "HER",
                    "days": [
                        {"date": "18-10-2026", "samples_recorded": 2},
                        {"date": "22-10-2026", "samples_recorded": 0},
                    ],
                },
                {
                    "iaga_code": "HBK",
                    "days": [{"date": "22-10-2026", "samples_recorded": 0}],
                },
            ]
        }

    def fake_day(code, day):
        assert code == "HER"
        assert day.isoformat() == "2026-10-18"
        return (
            "2026-10-18 12:00:00.000 291     3.00     4.00     0.00     5.00\n"
            "2026-10-18 12:01:00.000 291     0.00     5.00     0.00     5.00\n"
        )

    monkeypatch.setattr("zgiis.space_weather.intermagnet_client._gin_get", fake_gin)
    monkeypatch.setattr("zgiis.space_weather.intermagnet_client._fetch_day_text", fake_day)
    now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
    payload = fetch_south_africa_latest(now=now)
    by = {row["code"]: row for row in payload["observatories"]}
    assert by["HER"]["status"] == "delayed"
    assert by["HER"]["h_nt"] == 5.0
    assert by["HBK"]["status"] == "unavailable"
    assert by["HBK"]["h_nt"] is None
    assert "2026-10-18" in payload["note"]
    _latest_cache["at"] = 0.0
    _latest_cache["payload"] = None
