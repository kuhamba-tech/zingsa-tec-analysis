from __future__ import annotations

from zgiis.space_weather import solar_activity as sa


def test_noaa_flares_to_donki_maps_goes_rows():
    rows = [
        {
            "begin_time": "2026-08-21T17:45:00Z",
            "max_time": "2026-08-21T17:53:00Z",
            "max_class": "C3.4",
        }
    ]
    out = sa._noaa_flares_to_donki(rows)
    assert len(out) == 1
    assert out[0]["classType"] == "C3.4"
    assert out[0]["beginTime"] == "2026-08-21T17:45:00Z"


def test_noaa_alerts_to_cme_filters_cme_messages():
    alerts = [
        {
            "product_id": "A30F",
            "issue_datetime": "2026-08-26 16:36:10.973",
            "message": "WATCH: Geomagnetic Storm Category G2 Predicted",
        },
        {
            "product_id": "CME1",
            "issue_datetime": "2026-08-26 10:00:00.000",
            "message": "CME observed with partial halo Earth-directed signature",
        },
    ]
    out = sa._noaa_alerts_to_cme(alerts)
    assert len(out) == 1
    assert out[0]["linkedEvents"] is True


def test_noaa_kp_to_storms_counts_g1_plus():
    rows = [
        {"time_tag": "2026-08-21T00:00:00", "kp": 3.0, "observed": "observed"},
        {"time_tag": "2026-08-21T03:00:00", "kp": 5.5, "observed": "observed"},
        {"time_tag": "2026-08-21T06:00:00", "kp": 6.2, "observed": "observed"},
    ]
    out = sa._noaa_kp_to_storms(rows)
    assert len(out) == 2
    assert out[0]["allKpIndex"][0]["kpIndex"] == 6


def test_noaa_goes_active_regions_list_individual_flares():
    flares = [
        {"flrID": "NOAA-GOES-1", "classType": "M1.0", "beginTime": "2026-08-25T03:55:00Z", "sourceLocation": "GOES"},
        {"flrID": "NOAA-GOES-2", "classType": "C2.0", "beginTime": "2026-08-21T18:25:00Z", "sourceLocation": "GOES"},
    ]
    rows = sa.build_donki_active_regions(flares)
    assert len(rows) == 2
    assert rows[0]["latest"] == "M1.0"
    assert "M1.0" in rows[0]["id"]


def test_event_feed_source_noaa():
    assert sa._event_feed_source(["noaa_flares", "noaa_cme_alerts"], "live") == "noaa_swpc"
    assert sa._event_feed_source(["nasa_flares"], "live") == "nasa_donki"
    alerts = [
        {
            "product_id": "CME1",
            "issue_datetime": "2026-08-26 10:00:00.000",
            "message": "CME eruption detected",
        }
    ]
    flares, cmes, storms, sources, status, note = sa._resolve_event_feeds(
        using_demo=True,
        results={
            "flares": None,
            "cmes": None,
            "storms": None,
            "noaa_flares": [
                {"begin_time": "2026-08-21T17:45:00Z", "max_class": "C1.1", "max_time": "2026-08-21T17:50:00Z"}
            ],
            "noaa_kp": [{"time_tag": "2026-08-21T03:00:00", "kp": 5.0, "observed": "observed"}],
        },
        alerts=alerts,
    )
    assert status == "live"
    assert len(flares) == 1
    assert len(cmes) == 1
    assert len(storms) == 1
    assert "NOAA SWPC" in note
    assert any(s.startswith("noaa_") for s in sources)
