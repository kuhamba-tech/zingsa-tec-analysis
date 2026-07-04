"""Tests for WDC Kyoto Dst HTML parsing."""

from zgiis.space_weather.wdc_kyoto_client import _parse_dst_pre_block, build_analysis


SAMPLE_DST_HTML = """
<pre class="data">
                                      WDC for Geomagnetism, Kyoto
                                Hourly Equatorial Dst Values (PROVISIONAL)
                                              APRIL   2024
      unit=nT                                                                                      UT
      1   2   3   4   5   6   7   8    9  10  11  12  13  14  15  16   17  18  19  20  21  22  23  24
DAY
 1   -4  -5  -9 -10 -17 -19 -22 -33  -30 -26 -23 -20 -17 -18 -16 -11   -9 -10 -14 -12 -12  -9  -7  -7
 2   -9 -13 -16 -21 -18 -18 -17 -13  -10  -7 -10 -14  -9  -3  -4  -7   -8  -9 -11 -12  -9  -4  -2   0
</pre>
"""


def test_parse_dst_pre_block_daily_minimum():
    out = _parse_dst_pre_block(SAMPLE_DST_HTML, 2024, 4)
    assert out["2024-04-01"] == -33.0
    assert out["2024-04-02"] == -21.0


def test_build_analysis_empty():
    payload = build_analysis([])
    assert payload["days"] == 0
    assert payload["storms"] == []
