"""NOAA region numbers land on the visible solar disk."""

from datetime import datetime, timedelta, timezone

from zgiis.space_weather.solar_disk import _latest_image, newest_continuum_frame, parse_solar_region_summary

SRS = """
:Issued: 2026 Oct 31 0030 UTC
I.  Regions with Sunspots.  Locations Valid at 30/2400Z
Nmbr Location  Lo  Area  Z   LL   NN Mag Type
4563 S19W94   353  0010 Axx  01   01 Alpha
4564 N04E56   203  0030 Cro  05   04 Beta
4565 N12E75   184  0060 Hsx  02   01 Alpha
IA. H-alpha Plages without Spots.
4562  S17W01   263
II. Regions Due to Return
None
"""


def test_limb_region_is_omitted_and_eastern_regions_sit_on_the_left():
    parsed = parse_solar_region_summary(SRS)
    numbers = [row["number"] for row in parsed["regions"] if row["on_disk"]]
    assert numbers == [4564, 4565]
    assert parsed["active_region_count"] == 2
    # 10×groups + spots = 10×2 + (4+1)
    assert parsed["sunspot_number"] == 25
    by_number = {row["number"]: row for row in parsed["regions"]}
    assert by_number[4565]["x"] < 0.5
    assert by_number[4564]["x"] < 0.5
    assert by_number[4565]["y"] < by_number[4564]["y"]
    assert by_number[4563]["on_disk"] is False


def test_newest_browse_frame_is_the_latest_continuum():
    listing = """
    <a href="20261031_020000_1024_HMIIF.jpg">020000</a>
    <a href="20261031_031500_1024_HMIIF.jpg">031500</a>
    <a href="20261031_031500_1024_HMIIC.jpg">color</a>
    <a href="20261031_030000_4096_HMIIF.jpg">larger</a>
    """
    name, label = newest_continuum_frame(listing)
    assert name == "20261031_031500_1024_HMIIF.jpg"
    assert label == "2026-10-31 03:15 UTC"


def test_a_slow_newer_frame_is_kept_over_an_older_reply():
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now.replace(minute=(now.minute // 15) * 15)
    newest = (start - timedelta(minutes=30)).strftime("%Y%m%d_%H%M00")
    older = (start - timedelta(minutes=60)).strftime("%Y%m%d_%H%M00")
    seen = {"newest": 0}

    class Response:
        def __init__(self, code: int) -> None:
            self.status_code = code

    def head(url: str) -> Response:
        if newest in url:
            seen["newest"] += 1
            if seen["newest"] == 1:
                raise TimeoutError("slow")
            return Response(200)
        if older in url:
            return Response(200)
        return Response(404)

    url, label = _latest_image(head)
    assert newest in url
    clock = newest.split("_")[1]
    assert label.endswith(f"{clock[:2]}:{clock[2:4]} UTC")
