"""GFZ Kp_ap_Ap_SN_F107 TXT parser tests."""

from zgiis.space_weather.gfz_kp_client import parse_gfz_kp_txt, build_analysis


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


def test_build_analysis_includes_txt_source_and_solar():
    rows = list(parse_gfz_kp_txt(SAMPLE).values())
    payload = build_analysis(rows)
    assert "since_1932" in payload["source"] or "nowcast" in payload["source"]
    assert payload["max_sn"] == 120
    assert payload["max_f107"] == 180.0
    assert payload["files"]
    assert payload["series"][0]["sn"] == 120
