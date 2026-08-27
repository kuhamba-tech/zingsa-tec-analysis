from __future__ import annotations

from datetime import datetime, timedelta, timezone

from zgiis.live.stec_vtec import LiveVtecPipeline


def test_latest_by_station_rejects_tsho_low_bias_prn():
    """TSHO often ends on G14 ~7 TECU while peer PRNs sit near ~22."""
    pipe = LiveVtecPipeline(db=None)
    now = datetime.now(timezone.utc)
    for i in range(20):
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=90 - i),
                "station": "tsho",
                "prn": "G03",
                "vtec_tecu": 22.4,
            }
        )
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=90 - i),
                "station": "tsho",
                "prn": "G06",
                "vtec_tecu": 24.1,
            }
        )
    for i in range(80):
        pipe._recent["tsho"].append(
            {
                "epoch": now - timedelta(seconds=40 - i % 40),
                "station": "tsho",
                "prn": "G14",
                "vtec_tecu": 6.7,
            }
        )
    # Last sample is the biased PRN — old behaviour would report ~6.7.
    pipe._latest["tsho"] = {
        "epoch": now,
        "station": "tsho",
        "prn": "G14",
        "vtec_tecu": 6.5,
    }
    by = pipe.latest_by_station(max_age_s=120.0)
    assert "tsho" in by
    assert 18.0 <= float(by["tsho"]) <= 26.0
