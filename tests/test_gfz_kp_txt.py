"""GFZ Kp_ap_Ap_SN_F107 TXT parser tests."""

from zgiis.space_weather.gfz_kp_client import (
    build_analysis,
    count_storm_years,
    parse_gfz_kp_txt,
    storm_day_band,
)


SAMPLE = """
# header
#YYY MM DD  days  days_m  Bsr dB    Kp1    Kp2    Kp3    Kp4    Kp5    Kp6    Kp7    Kp8  ap1  ap2  ap3  ap4  ap5  ap6  ap7  ap8    Ap  SN F10.7obs F10.7adj D
2024 05 10 33768 33768.5 2606  1  5.000  4.667  3.333  2.000  1.667  1.000  0.667  0.333   48   39   18    7    6    4    3    2    16 120    180.0    179.0 2
2024 05 11 33769 33769.5 2606  2  1.000  1.333  1.667  2.000  2.333  2.667  3.000  3.333    4    5    6    7    9   12   15   18    10  80    150.0    149.0 2
2024 05 12 33770 33770.5 2606  3 -1.000 -1.000 -1.000 -1.000 -1.000 -1.000 -1.000 -1.000   -1   -1   -1   -1   -1   -1   -1   -1    -1  -1     -1.0     -1.0 0
"""


def test_parse_gfz_kp_txt_daily_rows():
    rows = parse_gfz_kp_txt(SAMPLE)
    assert "2024-05-10" in rows
    storm = rows["2024-05-10"]
    assert storm["kp"] == 5.0
    assert storm["storm_flag"] is True
    assert storm["ap_daily"] == 16.0
    assert storm["sn"] == 120
    assert storm["f107"] == 180.0
    quiet = rows["2024-05-11"]
    assert quiet["storm_flag"] is False
    assert quiet["kp_mean"] is not None
    missing = rows["2024-05-12"]
    assert missing["kp"] is None
    assert missing["sn"] is None
    assert missing["f107"] is None


def test_storm_day_band_uses_the_kp_third_that_starts_each_g_scale():
    assert storm_day_band(4.333) is None
    assert storm_day_band(4.667) == "g1"
    assert storm_day_band(5.333) == "g1"
    assert storm_day_band(5.667) == "g2"
    assert storm_day_band(6.667) == "g3"
    assert storm_day_band(7.667) == "g4"
    assert storm_day_band(8.667) == "g5"
    assert storm_day_band(None) is None


def test_count_storm_years_keeps_one_band_per_day_and_a_quiet_year():
    years = count_storm_years(
        [
            {"date": "1950-01-01", "kp": 4.667},
            {"date": "1950-01-02", "kp": 8.667},
            {"date": "1950-01-03", "kp": 2.0},
            {"date": "1951-06-01", "kp": 1.0},
            {"date": "1952-01-01", "kp": None},
        ]
    )
    assert [row["year"] for row in years] == [1950, 1951]
    assert years[0] == {"year": 1950, "g1": 1, "g2": 0, "g3": 0, "g4": 0, "g5": 1}
    assert years[1]["g1"] == 0


def test_build_analysis_includes_txt_source_and_solar():
    rows = list(parse_gfz_kp_txt(SAMPLE).values())
    payload = build_analysis(rows)
    assert "since_1932" in payload["source"] or "nowcast" in payload["source"]
    assert payload["max_sn"] == 120
    assert payload["max_f107"] == 180.0
    assert payload["files"]
    assert payload["series"][0]["sn"] == 120
