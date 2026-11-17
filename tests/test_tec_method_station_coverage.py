from datetime import datetime, timezone
from unittest.mock import Mock, patch

import pandas as pd

from backend.routers.live import _build_tec_method_comparison
from backend.schemas import LiveObservation
from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS


def test_each_station_gets_own_budget_and_actual_collector_calibration():
    now = datetime.now(timezone.utc).isoformat()
    codes = [site.code.lower().rstrip("_") for site in ZIMBABWE_CORS_STATIONS]
    samples = [LiveObservation(time=now, station=code, vtec_tecu=20,
                               stec_tecu=30, elevation_deg=50, prn="G01") for code in codes]
    results = {code: {"gg_vtec": 30 + i, "gg_time": now, "gg_engine": "pytecgg",
                      "gg_version": "1.3.0", "gg_status": "ready"} for i, code in enumerate(codes)}
    db = Mock()
    db.query_recent_per_station.return_value = pd.DataFrame()
    with patch("backend.routers.live._db", return_value=db), \
         patch("backend.routers.live._build_live_vtec", return_value=samples), \
         patch("zgiis.live.pytecgg_service.snapshot", return_value={"zimbabwe": results}), \
         patch("zgiis.processing.gg_calibration.calibrate_gg_from_observations") as approximation:
        result = _build_tec_method_comparison(hours=2, station=None, limit=300)
    db.query_recent_per_station.assert_called_once_with(hours=2, stations=codes, per_station_limit=600)
    assert {row.station.lower() for row in result.stations} == set(codes)
    assert [row.gg_latest for row in result.stations] == [results[row.station.lower()]["gg_vtec"] for row in result.stations]
    assert all(row.gg_engine == "pytecgg" for row in result.stations)
    approximation.assert_not_called()
