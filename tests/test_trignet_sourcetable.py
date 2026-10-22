"""TrigNet sourcetable keeps real single-base stations and drops virtual networks."""

from datetime import datetime, timedelta, timezone

from zgiis.cors.trignet import median_gg_vtec, parse_sourcetable, sample_matches_live_time

SAMPLE = """
STR;RTKNetWCape;RTKNetWCape;RTCM 3.1;1004;2;GPS+GLONASS;TrigNet;ZAF;0;0;1;1;Trimble;None;B;N;0;;
STR;Pret-SB;Pret-SB;RTCM 3.4;1004;2;GPS+GLO+GAL+BDS;TrigNet;ZAF;-25.73;28.28;0;0;Trimble;None;B;N;0;;
STR;Pret-SB_GPSGLOonly;Pret-SB_GPSGLOonly;RTCM 3.1;1004;2;GPS+GLO;TrigNet;ZAF;-25.73;28.28;0;0;Trimble;None;B;N;0;;
STR;Tdou-SB;Tdou-SB;RTCM 3.4;1004;2;GPS+GLO;TrigNet;ZAF;-23.08;30.38;0;0;Trimble;None;B;N;0;;
STR;Ulda-SB;Ulda-SB;RTCM 3.1;1004;2;GPS+GLO;TrigNet;ZAF;0;0;0;0;Trimble;none;N;N;0;;
STR;Lsma-SB;Lsma-SB;RTCM 3.1;1004;2;GPS+GLO;TrigNet;ZAF;28.55;29.76;0;0;Trimble;none;B;N;0;;
"""


def test_parse_keeps_single_bases_and_orders_north_first():
    rows = parse_sourcetable(SAMPLE)
    assert [row["code"] for row in rows] == ["TDOU", "PRET", "LSMA"]
    assert rows[2]["lat"] == -28.55
    assert rows[2]["country"] == "ZAF"
    assert rows[1]["lat"] == -25.73
    assert rows[1]["lon"] == 28.28
    assert rows[1]["mountpoint"] == "Pret-SB"
    assert "GAL" in rows[1]["constellations"]


def test_earlier_rinex_hour_does_not_match_the_live_time():
    now = datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc)
    assert sample_matches_live_time("2026-10-21T23:59:00Z", now) is False
    assert sample_matches_live_time("2026-10-22T14:50:00Z", now) is True
    assert sample_matches_live_time(None, now) is False


def test_median_gg_uses_cesaroni_fit_on_the_same_samples():
    start = datetime(2026, 10, 21, 22, 0, tzinfo=timezone.utc)
    rows = []
    for minute in range(0, 12):
        rows.append({
            "time": start + timedelta(minutes=minute),
            "prn": "G12",
            "elevation_deg": 55.0,
            "vtec_tecu": 22.0 + 0.05 * minute,
            "lat": -25.73,
            "lon": 28.28,
        })
    gg, count = median_gg_vtec(rows)
    assert gg is not None
    assert count >= 8
    assert 5.0 < gg < 40.0
