"""Unit tests for yearly C/M/X flare frequency parsers."""

from zgiis.space_weather.flare_frequencies import (
    count_donki_flares,
    count_ncei_xrs_text,
    parse_daily_solar_data,
    yearly_mean_ssn,
)


def test_count_ncei_xrs_text_counts_c_m_x_only():
    text = """
31777140101 0645 0652 0649 C 21 G15 5.8E-04
31777140101 1840 1903 1852 S14W47 M 99 G15 8.2E-02 11936 131229.2
31777140102 0224 0256 0233 S05E76 M 17 G15 2.7E-02 11944 140107.7
31777140104 1847 2023 1946 X 40 G15 1.4E-01
31777140105 0224 0230 0228 S15E45 B 45 G15 9.3E-04 11944 140108.5
"""
    counts = count_ncei_xrs_text(text)
    assert counts == {"c_count": 1, "m_count": 2, "x_count": 1}


def test_count_donki_flares_by_class_type():
    rows = [
        {"classType": "C2.3"},
        {"classType": "M1.0"},
        {"classType": "X1.5"},
        {"classType": "B6.1"},
        {"classType": ""},
        {"note": "no class"},
    ]
    assert count_donki_flares(rows) == {"c_count": 1, "m_count": 1, "x_count": 1}


def test_daily_solar_data_keeps_flare_counts_and_sunspot_number():
    text = """
#  Date     Radio SESC Area New Field Flux   C  M  X
2026 10 14  123    124      600      1    -999      *   8  0  0  7  0  0  0
2026 11 08  128     72      600      1    -999      *  28  3  0 13  4  0  0
2026 11 09  129    -999     620      1    -999      *   *  *  *  0  0  0  0
"""
    rows = parse_daily_solar_data(text)
    assert [row["label"] for row in rows] == ["14 Oct", "8 Nov", "9 Nov"]
    assert rows[0]["ssn"] == 124
    assert rows[0]["c_count"] == 8
    assert rows[0]["m_count"] == 0
    assert rows[0]["x_count"] == 0
    assert rows[1]["c_count"] == 28
    assert rows[1]["m_count"] == 3
    assert rows[2]["ssn"] is None
    assert rows[2]["c_count"] is None


def test_yearly_mean_ssn_averages_months():
    rows = [
        {"time-tag": "2024-01", "ssn": 100.0, "f10.7": 150.0},
        {"time-tag": "2024-02", "ssn": 140.0, "f10.7": 160.0},
        {"time-tag": "2023-12", "ssn": 80.0, "f10.7": 140.0},
        {"time-tag": "2024-03", "ssn": -1.0, "f10.7": 120.0},
    ]
    means = yearly_mean_ssn(rows, start_year=2023)
    assert means[2023] == 80.0
    assert means[2024] == 120.0
