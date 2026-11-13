from datetime import date

import pytest

from zgiis.space_weather import comparison_drivers as client


def record(year=2024, doy=92, hour=0):
    words = ["0"] * 56
    words[:3] = list(map(str, [year, doy, hour]))
    for key, (index, _) in client.FIELDS.items():
        words[index] = str({"bt": 8, "by": 0, "bz": -7, "speed": 515,
                            "temperature": 120000, "density": 4,
                            "omni_p10": 0, "omni_p30": 0.2, "omni_p60": 0.1, "dst": -25}[key])
    return words


def test_fields_units_zero_and_utc_final_hour():
    text = "\n".join(" ".join(record(hour=hour)) for hour in [0, 23])
    rows = client.parse_omni(text, date(2024, 4, 1), date(2024, 4, 1))
    assert len(rows) == 2
    assert rows[-1]["time"] == "2024-04-01T23:00:00Z"
    assert rows[0]["bz"] == -7
    assert rows[0]["dst"] == -25
    assert rows[0]["speed"] == 515
    assert rows[0]["by"] == 0
    assert rows[0]["omni_p10"] == 0


def test_fill_values_are_null_and_other_dates_are_excluded():
    words = record()
    for _, (index, fill) in client.FIELDS.items():
        words[index] = str(fill)
    rows = client.parse_omni(" ".join(words), date(2024, 4, 1), date(2024, 4, 1))
    assert all(rows[0][key] is None for key in client.FIELDS)
    assert client.parse_omni(" ".join(words), date(2024, 4, 2), date(2024, 4, 2)) == []


def test_partial_source_failure_does_not_hide_stored_noaa(monkeypatch):
    def failure(year):
        raise TimeoutError()
    monkeypatch.setattr(client, "_year", failure)
    monkeypatch.setattr(client, "_noaa", lambda *args: ([{
        "time": "2024-04-01T01:00:00Z", "source": "Stored NOAA", "goes_p10": 0.5,
    }], []))
    result = client.build_comparison_drivers(date(2024, 4, 1), date(2024, 4, 1))
    assert result["rows"][0]["goes_p10"] == 0.5
    assert "2024" in result["notes"][0]


def test_stored_xray_bands_are_mapped_to_chart_fields():
    assert client.STORED["xray_flux"] == "goes_xray_long"
    assert client.STORED["xray_short_flux"] == "goes_xray_short"


def test_invalid_range_is_rejected():
    with pytest.raises(ValueError, match="Start date"):
        client.build_comparison_drivers(date(2024, 4, 2), date(2024, 4, 1))
