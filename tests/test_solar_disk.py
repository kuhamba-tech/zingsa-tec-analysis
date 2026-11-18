"""NOAA region numbers land on the visible solar disk."""

import json
import threading
from datetime import datetime, timedelta, timezone

from zgiis.space_weather.solar_disk import _latest_image, newest_continuum_frame, parse_solar_region_summary
from zgiis.space_weather import solar_disk


def test_recent_goes_supplies_end_time_if_edited_report_is_unavailable(monkeypatch):
    day = datetime.now(timezone.utc).date()
    event = {
        "begin_time": f"{day}T21:34:00Z",
        "max_time": f"{day}T21:39:00Z",
        "end_time": f"{day}T21:42:00Z",
        "max_class": "M1.7",
    }
    monkeypatch.setattr(
        solar_disk, "_archive_text",
        lambda url: json.dumps([event, {**event, "max_time": "2000-01-01T21:39:00Z"}])
        if url == solar_disk._NOAA_GOES_FLARES else "",
    )
    payload = solar_disk.solar_archive_day(day)
    assert payload["edited_report_available"] is False
    rows = payload["flare_regions"]
    assert len(rows) == 1
    assert rows[0]["end"] == event["end_time"]
    assert rows[0]["region"] is None

    solar_disk._add_live_edited_regions(rows, json.dumps([
        {"type": "XRA", "max_datetime": f"{day}T21:39:00", "particulars1": "M1.7", "region": 4578},
        {"type": "XRA", "max_datetime": f"{day}T21:39:00", "particulars1": "M1.8", "region": 9999},
    ]))
    assert rows[0]["region"] == 4578

    monkeypatch.setattr(
        solar_disk, "_archive_text",
        lambda url: "1234 2134 2139 2142 G16 5 XRA 1-8A M1.7 1.0E-02 4578"
        if "solar_event_reports" in url else "",
    )
    recovered = solar_disk.solar_archive_day(day)
    assert recovered["edited_report_available"] is True
    assert recovered["flare_regions"][0]["region"] == 4578
    solar_disk._load_solar_archive.cache_clear()


def test_recent_archive_starts_live_flare_feeds_while_sdo_listing_loads(monkeypatch):
    day = datetime.now(timezone.utc).date()
    listing_started = threading.Event()
    fallback_started = threading.Event()
    listing_timed_out = threading.Event()

    def archive_text(url: str) -> str:
        if url.endswith("/"):
            listing_started.set()
            if not fallback_started.wait(timeout=2):
                listing_timed_out.set()
            return ""
        if url in (solar_disk._NOAA_GOES_FLARES, solar_disk._NOAA_EDITED_EVENTS):
            fallback_started.set()
            return "[]" if url == solar_disk._NOAA_GOES_FLARES else ""
        return ""

    solar_disk._load_solar_archive.cache_clear()
    monkeypatch.setattr(solar_disk, "_archive_text", archive_text)
    payload = solar_disk.solar_archive_day(day)

    assert listing_started.is_set()
    assert not listing_timed_out.is_set()
    assert payload["edited_report_available"] is False
    solar_disk._load_solar_archive.cache_clear()


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
    assert parsed["visible_spot_count"] == 5
    by_number = {row["number"]: row for row in parsed["regions"]}
    assert by_number[4565]["x"] < 0.5
    assert by_number[4564]["x"] < 0.5
    assert by_number[4565]["y"] < by_number[4564]["y"]
    assert by_number[4563]["on_disk"] is False
    assert by_number[4563]["draw_x"] > 0.85
    assert parsed["plages"][0]["number"] == 4562
    assert parsed["plages"][0]["spot_count"] is None
    assert parsed["plages"][0]["on_disk"] is True


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
