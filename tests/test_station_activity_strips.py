"""Spider-style station activity strips stay tied to archived snapshots."""

from datetime import datetime, timezone

import pandas as pd

from zgiis.db.station_status_db import apply_live_status_tip, build_activity_strips


def test_receive_and_connecting_bars_follow_archived_status():
    now = datetime(2026, 11, 2, 12, 10, tzinfo=timezone.utc)
    frame = pd.DataFrame(
        [
            {"time": "2026-11-02T12:00:00Z", "station_code": "beit", "status": "online"},
            {"time": "2026-11-02T12:07:00Z", "station_code": "beit", "status": "offline"},
            {"time": "2026-11-02T12:10:00Z", "station_code": "beit", "status": "online"},
            {"time": "2026-11-02T12:00:00Z", "station_code": "bing", "status": "offline"},
            {"time": "2026-11-02T11:55:00Z", "station_code": "hara", "status": "offline"},
        ]
    )

    board = build_activity_strips(
        frame,
        hours=0.5,
        bucket_minutes=5,
        now=now,
    )

    rows = {row["station_code"]: row for row in board["stations"]}
    beit = rows["beit"]["cells"]
    assert "o" in beit and beit.endswith("o")
    assert "f" in beit
    assert rows["beit"]["activity"] == "receive data"
    assert rows["beit"]["online_pct"] < 100

    bing = rows["bing"]["cells"].lstrip(".")
    assert bing and set(bing) == {"f"}
    assert rows["bing"]["activity"] == "connecting"
    assert rows["bing"]["online_pct"] == 0.0

    assert rows["hara"]["surveyor"] is True
    assert rows["beit"]["surveyor"] is False
    assert rows["lupa"]["activity"] == "no samples"
    assert set(rows["lupa"]["cells"]) == {"."}


def test_status_holds_across_empty_buckets_and_does_not_paint_the_lead_in():
    now = datetime(2026, 11, 2, 12, 20, tzinfo=timezone.utc)
    frame = pd.DataFrame(
        [
            {"time": "2026-11-02T12:10:00Z", "station_code": "gutu", "status": "online"},
        ]
    )
    board = build_activity_strips(frame, hours=0.5, bucket_minutes=5, now=now)
    gutu = next(row for row in board["stations"] if row["station_code"] == "gutu")
    assert gutu["cells"].startswith(".")
    tail = gutu["cells"].lstrip(".")
    assert tail and set(tail) == {"o"}
    assert "f" not in gutu["cells"]


def test_live_spider_tip_overrides_stale_connecting_label():
    now = datetime(2026, 11, 2, 12, 20, tzinfo=timezone.utc)
    frame = pd.DataFrame(
        [
            {"time": "2026-11-02T12:00:00Z", "station_code": "chiv", "status": "online"},
            {"time": "2026-11-02T12:18:00Z", "station_code": "chiv", "status": "offline"},
            {"time": "2026-11-02T12:00:00Z", "station_code": "bing", "status": "offline"},
        ]
    )
    board = build_activity_strips(frame, hours=0.5, bucket_minutes=5, now=now)
    before = {row["station_code"]: row for row in board["stations"]}
    assert before["chiv"]["activity"] == "connecting"
    assert before["chiv"]["cells"].endswith("f")

    apply_live_status_tip(
        board,
        {"chiv": "online", "bing": "offline"},
    )
    after = {row["station_code"]: row for row in board["stations"]}
    assert after["chiv"]["activity"] == "receive data"
    assert after["chiv"]["cells"].endswith("o")
    assert after["bing"]["activity"] == "connecting"
    assert after["chiv"]["station_code"] == board["stations"][0]["station_code"]
