"""NOAA flare chances in the form SolarHam posts, plus the picture names."""

from datetime import datetime, timezone

from zgiis.space_weather.solar_brief import (
    assign_region_flares,
    choose_solarham_images,
    count_flare_days,
    monitor_region_rows,
    parse_daypre,
    parse_forecast_outlook,
    solarham_images,
)
from zgiis.space_weather.solar_disk import newest_product_frame, parse_solar_region_summary

DAYPRE = """
:Issued: 2026 Oct 30 2200 UTC
:Whole_Disk_Flare_Prob:
Class_M                   1             1             1
Class_X                   1             1             1
Proton                    1             1             1
:Reg_Prob: 2026 Oct 30
  4563          5         1             1             1
  4564         10         1             1             1
  4565          5         1             1             1
"""

FORECAST = """
The greatest expected 3 hr Kp for Oct 31-Nov 02 2026 is 4.67 (NOAA Scale
G1).
"""

DISCUSSION = """
No Earth-directed CMEs were observed at the available coronagraph imagery.
.Forecast...
Enhanced solar wind conditions are likely on 31 Oct-02 Nov due to
positive polarity CH HSS influences.
The geomagnetic field is likely to reach G1 (Minor) geomagnetic storm
levels on 31 Oct-01 Nov due to influence from a positive polarity CH HSS.
"""


def test_region_chances_sum_to_the_posted_c_flaring_figure():
    parsed = parse_daypre(DAYPRE)
    assert parsed["issued"] == "2026 Oct 30 2200 UTC"
    assert parsed["region_count"] == 3
    assert [row["number"] for row in parsed["regions"]] == [4563, 4564, 4565]
    assert parsed["c_percent"] == 20
    assert parsed["m_percent"] == 1
    assert parsed["x_percent"] == 1


def test_forecast_facts_are_structured_rather_than_copied_sentences():
    outlook = parse_forecast_outlook(FORECAST, DISCUSSION)
    assert outlook["earth_directed_cme"] is False
    assert outlook["coronal_hole_stream"] is True
    assert outlook["stream_polarity"] == "positive"
    assert outlook["expected_kp"] == 4.67
    assert outlook["expected_kp_scale"] == "G1"
    assert "Oct 31-Nov 02 2026" in outlook["expected_kp_window"]
    assert outlook["storm_window"] == "31 Oct-01 Nov"


def test_only_c_m_and_x_flares_are_counted_for_each_utc_day():
    now = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)
    counted = count_flare_days(
        [
            {"max_time": "2026-10-31T09:14:00Z", "max_class": "B6.3"},
            {"max_time": "2026-10-31T11:02:00Z", "max_class": "C1.4"},
            {"max_time": "2026-10-30T18:00:00Z", "max_class": "M1.1"},
            {"max_time": "2026-10-29T18:00:00Z", "max_class": "X1.0"},
        ],
        now,
    )
    assert counted["today"]["label"] == "1 C"
    assert counted["yesterday"]["label"] == "1 M"


def test_a_quiet_utc_day_is_not_reported_as_a_c_flare():
    now = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)
    counted = count_flare_days([{"max_time": "2026-10-31T06:13:00Z", "max_class": "B3.4"}], now)
    assert counted["today"]["label"] == "No C-flares or higher"
    assert counted["yesterday"]["label"] == "No C-flares or higher"


def test_solarham_picture_names_follow_the_site_dates():
    images = solarham_images(datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
    assert images[0]["url"] == "https://solarham.com/pictures/2026/oct31_2026_disk.jpg"
    assert images[2]["url"].endswith("oct31_2026_ch.jpg")
    july = solarham_images(datetime(2026, 7, 7, 12, tzinfo=timezone.utc))
    assert "jul7_2026_disk.jpg" in july[0]["url"]


def test_limb_region_stays_in_the_table_and_the_strongest_flare_is_kept():
    parsed = parse_solar_region_summary(
        """
I. Regions with Sunspots
4564 N04E56 203 0030 Cro 05 04 Beta
IA. H-alpha Plages without Spots.
4562 S17W01 263
"""
    )
    now = datetime(2026, 10, 31, 15, tzinfo=timezone.utc)
    rows = monitor_region_rows(
        parsed,
        [
            {"type": "XRA", "region": 4564, "particulars1": "B7.3", "max_datetime": "2026-10-30T12:22:00"},
            {"type": "XRA", "region": 4564, "particulars1": "C2.0", "max_datetime": "2026-10-30T18:00:00"},
            {"type": "XRA", "region": None, "particulars1": "M1.0", "max_datetime": "2026-10-30T19:00:00"},
            {"type": "FLA", "region": 4564, "particulars1": "X9.0", "max_datetime": "2026-10-30T20:00:00"},
        ],
        now,
    )
    by_number = {row["number"]: row for row in rows}
    assert by_number[4564]["flare_yesterday"] == "C2.0 (18:00 UTC)"
    assert by_number[4564]["flare_today"] is None
    assert by_number[4564]["magnetic_class"] == "beta"
    assert by_number[4562]["kind"] == "plage"
    assert by_number[4562]["spot_count"] is None
    peaks = assign_region_flares(
        [{"type": "XRA", "region": "4565", "particulars1": "B1.2", "max_datetime": "2026-10-31T04:00:00"}],
        now,
    )
    assert peaks[4565]["today"] == "B1.2 (04:00 UTC)"


def test_newest_aia_frame_is_not_tied_to_the_quarter_hour():
    listing = """
    <a href="20261031_151500_1024_HMIB.jpg">hmib</a>
    <a href="20261031_151753_1024_0193.jpg">early</a>
    <a href="20261031_152817_1024_0193.jpg">later</a>
    <a href="20261031_152817_1024_HMIBC.jpg">color magnetogram</a>
    """
    name, label = newest_product_frame(listing, "0193")
    assert name == "20261031_152817_1024_0193.jpg"
    assert label == "2026-10-31 15:28 UTC"
    magnetogram, _ = newest_product_frame(listing, "HMIB")
    assert magnetogram == "20261031_151500_1024_HMIB.jpg"


def test_a_slow_picture_check_keeps_today():
    def head(_url: str):
        raise TimeoutError("slow")

    images = choose_solarham_images(head, datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
    assert images[0]["url"].endswith("oct31_2026_disk.jpg")


def test_missing_today_picture_steps_back_one_day():
    class Response:
        def __init__(self, code: int) -> None:
            self.status_code = code

    def head(url: str) -> Response:
        return Response(200 if "oct30_2026_disk" in url else 404)

    images = choose_solarham_images(head, datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
    assert images[0]["url"].endswith("oct30_2026_disk.jpg")
    assert images[1]["fallback_url"].endswith("latest_1024_HMIB.jpg")
