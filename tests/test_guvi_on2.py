from zgiis.space_weather.guvi_on2 import build_guvi_on2_payload


def test_guvi_on2_reference_overpasses_for_africa():
    payload = build_guvi_on2_payload("2021-11-01", "2021-11-06")

    assert payload["source"] == "TIMED/GUVI Level-3 O/N2 gallery"
    assert payload["status"] == "metadata_only"
    assert payload["altitude_range_km"] == [60, 180]
    assert [row["date"] for row in payload["series"]] == [
        "2021-11-03",
        "2021-11-04",
        "2021-11-05",
    ]
    assert [row["overpass_ut"] for row in payload["series"]] == ["07:56", "07:46", "07:36"]
    assert all(row["ratio"] is None for row in payload["series"])


def test_guvi_on2_date_filter_excludes_reference_days():
    payload = build_guvi_on2_payload("2024-04-01", "2024-06-30")

    assert payload["series"] == []
