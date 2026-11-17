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


def test_south_africa_configuration_does_not_use_zimbabwe_credentials(monkeypatch):
    from zgiis.cors.trignet import _configured_caster

    monkeypatch.setenv("NTRIP_HOST", "zimbabwe.example")
    monkeypatch.setenv("NTRIP_USERNAME", "zim-user")
    monkeypatch.delenv("TRIGNET_NTRIP_HOST", raising=False)
    assert _configured_caster() is None
    monkeypatch.setenv("TRIGNET_NTRIP_HOST", "ntrip://south-africa.example:2102")
    monkeypatch.setenv("TRIGNET_NTRIP_USERNAME", "sa-user")
    monkeypatch.setenv("TRIGNET_NTRIP_PASSWORD", "sa-password")
    monkeypatch.delenv("TRIGNET_NTRIP_PORT", raising=False)
    assert _configured_caster() == {"host": "south-africa.example", "port": 2102, "username": "sa-user", "password": "sa-password"}


def test_catalog_merges_south_african_sites_and_filters_other_countries(monkeypatch):
    from zgiis.cors import trignet

    monkeypatch.setenv("TRIGNET_NTRIP_HOST", "south-africa.example")
    monkeypatch.delenv("TRIGNET_NTRIP_MOUNTPOINTS", raising=False)
    monkeypatch.setattr(trignet, "_CATALOG", {"at": 0.0, "stations": []})
    extra = "STR;NEW1-SB;New site;RTCM 3.4;1004;2;GPS+GLO;SANSA;ZAF;-24.2;29.3;0;0;\nSTR;UGAN;Other;RTCM 3;1004;2;GPS;SANSA;UGA;0.7;34.0;0;0;"
    monkeypatch.setattr(trignet, "_fetch_sourcetable_text", lambda **source: extra if source else SAMPLE)
    rows = trignet.catalog()
    assert {r["code"] for r in rows} == {"NEW1", "TDOU", "PRET", "LSMA"}
    assert all(r["country"] == "ZAF" for r in rows)


def test_authenticated_sourcetable_request_and_completion(monkeypatch):
    from unittest.mock import Mock
    from zgiis.cors import trignet

    sock = Mock()
    sock.recv.return_value = b"SOURCETABLE 200 OK\r\nENDSOURCETABLE\r\n"
    monkeypatch.setattr(trignet.socket, "create_connection", lambda *args, **kwargs: sock)
    assert "ENDSOURCETABLE" in trignet._fetch_sourcetable_text("south-africa.example", 2101, "test-user", "test-password")
    request = sock.sendall.call_args.args[0]
    assert b"Authorization: Basic " in request
    assert b"test-password" not in request
    assert sock.recv.call_count == 1
    sock.close.assert_called_once()


def test_station_response_does_not_wait_for_rinex_ftp(monkeypatch):
    from zgiis.cors import trignet

    monkeypatch.setattr(trignet, "start_trignet_tec", lambda: None)
    monkeypatch.setattr(trignet, "catalog", lambda: trignet.parse_sourcetable(SAMPLE))
    monkeypatch.setattr(trignet, "_DAY", {"at": 0.0, "day": None})
    monkeypatch.setattr(trignet, "latest_rinex_day", lambda: (_ for _ in ()).throw(AssertionError("FTP must stay in background")))
    payload = trignet.status()
    assert payload["station_count"] == 3
    assert payload["rinex_day"] is None
    assert "password" not in payload and "username" not in payload


def test_connected_stream_does_not_require_tec(monkeypatch):
    from unittest.mock import Mock
    from zgiis.cors import trignet

    monkeypatch.setattr(trignet, "start_trignet_tec", lambda: None)
    monkeypatch.setattr(trignet, "catalog", lambda: trignet.parse_sourcetable(SAMPLE))
    monkeypatch.setattr(trignet, "_TEC", {})
    monkeypatch.setattr(trignet, "_LIVE_MANAGER", Mock(status=lambda: {"tdou": {"connected": True, "msg_count": 20, "last_rtcm_at": datetime.now(timezone.utc)}}))
    monkeypatch.setattr(trignet, "_LIVE_PIPELINE", None)
    row = next(r for r in trignet.status()["stations"] if r["code"] == "TDOU")
    assert row["connected"] and row["stream_configured"]
    assert row["streaming"]
    assert row["message_count"] == 20
    assert row["vtec"] is None


def test_sansa_map_uses_zimbabwe_quality_rules_and_keeps_raw_estimate(monkeypatch):
    from unittest.mock import Mock
    from zgiis.cors import trignet

    monkeypatch.setattr(trignet, "start_trignet_tec", lambda: None)
    monkeypatch.setattr(trignet, "catalog", lambda: [next(r for r in trignet.parse_sourcetable(SAMPLE) if r["code"] == "TDOU")])
    monkeypatch.setattr(trignet, "_TEC", {})
    def values(*, max_age_s, regional=False):
        assert max_age_s == 600
        return {"tdou": 95.0} if regional else {}
    pipe = Mock()
    pipe.latest_by_station.side_effect = values
    pipe.diagnostics_by_station.return_value = {
        "tdou": {
            "last_vtec_at": "2026-11-16T12:00:00Z",
            "last_code_vtec_at": "2026-11-16T11:59:30Z",
        }
    }
    monkeypatch.setattr(trignet, "_LIVE_PIPELINE", pipe)
    row = trignet.status()["stations"][0]
    assert row["vtec"] is None
    assert row["raw_code_vtec"] == 95.0
    assert row["raw_code_vtec_time"] == "2026-11-16T11:59:30Z"
    assert row["tec_status"] == "withheld_by_shared_quality_rules"


def test_discovered_receiver_has_geometry():
    from zgiis.live.satellite_geometry import LiveNavCache, llh_to_ecef
    import numpy as np

    nav = LiveNavCache()
    nav.set_receiver_location("TDOU", -23.0, 30.0, 500.0)
    assert np.allclose(nav.receiver_ecef("tdou"), llh_to_ecef(-23.0, 30.0, 500.0))


def test_live_gg_is_available_when_uncalibrated_g_is_withheld(monkeypatch):
    from unittest.mock import Mock
    from zgiis.cors import trignet

    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(trignet, "start_trignet_tec", lambda: None)
    monkeypatch.setattr(trignet, "catalog", lambda: [trignet.parse_sourcetable(SAMPLE)[0]])
    monkeypatch.setattr(trignet, "_TEC", {})
    monkeypatch.setattr(trignet, "_DAY", {"day": None})
    monkeypatch.setattr(trignet, "_LIVE_MANAGER", None)
    pipeline = Mock()
    pipeline.latest_by_station.side_effect = lambda **kw: {"tdou": 65.0} if kw.get("regional") else {}
    pipeline.diagnostics_by_station.return_value = {"tdou": {"last_vtec_at": datetime.now(timezone.utc).isoformat()}}
    monkeypatch.setattr(trignet, "_LIVE_PIPELINE", pipeline)
    engine = Mock()
    engine.status.return_value = {"gg_vtec": 62.0, "gg_samples": 24, "gg_status": "ready",
                                  "gg_time": datetime.now(timezone.utc).isoformat()}
    monkeypatch.setattr(trignet, "_PYTECGG", engine)
    result = trignet.status()
    row = result["stations"][0]
    assert row["vtec"] is None
    assert row["gg_vtec"] == 62.0
    assert row["gg_samples"] == 24
    assert row["gg_status"] == "ready"
    assert row["gg_time"] is not None
    assert result["gg_ready"] == 1
    engine.status.assert_called_once_with("tdou")
    assert row["gg_engine"] == "pytecgg"


def test_serverless_reads_collector_without_starting_streams(monkeypatch):
    from zgiis.cors import trignet, trignet_store

    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(trignet, "start_trignet_tec", lambda: (_ for _ in ()).throw(AssertionError("No serverless streams")))
    monkeypatch.setattr(trignet_store, "load_snapshot", lambda: {"stations": [{"code": "TDOU"}]})
    assert trignet.status()["stations"][0]["code"] == "TDOU"


def test_stopped_collector_expires_online_status_and_tec():
    from zgiis.cors.trignet_store import expire_snapshot

    original = {"stations": [{"code": "TDOU", "connected": True, "streaming": True, "vtec": 20.0, "raw_code_vtec": 80.0, "raw_code_vtec_time": "2026-11-16T11:59:30Z"}]}
    assert expire_snapshot(original, 100, now=150)["stations"][0]["streaming"]
    assert not expire_snapshot(original, 100, now=200)["stations"][0]["streaming"]
    assert expire_snapshot(original, 100, now=300)["stations"][0]["vtec"] is None
    assert expire_snapshot(original, 100, now=300)["stations"][0]["raw_code_vtec"] is None
    assert expire_snapshot(original, 100, now=300)["stations"][0]["raw_code_vtec_time"] is None
    assert original["stations"][0]["streaming"]


def test_vercel_warmup_does_not_start_collector(monkeypatch):
    from zgiis.cors import trignet

    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(trignet, "_STARTED", False)
    monkeypatch.setattr(trignet.threading, "Thread", lambda **kw: (_ for _ in ()).throw(AssertionError("No serverless collector")))
    trignet.start_trignet_tec()
    assert not trignet._STARTED


def test_vercel_snapshot_uses_https_without_borrowing_sql_slot(monkeypatch):
    import time
    import requests
    from unittest.mock import Mock
    from zgiis.cors import trignet_store

    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-private-key")
    response = Mock()
    response.json.return_value = [{"saved_at": time.time(), "payload": {"stations": [{"code": "TDOU", "streaming": True}]}}]
    fetch = Mock(return_value=response)
    monkeypatch.setattr(requests, "get", fetch)
    monkeypatch.setattr(trignet_store, "checkout", lambda *a: (_ for _ in ()).throw(AssertionError("No SQL slot required")))
    result = trignet_store.load_snapshot()
    assert result["stations"][0]["streaming"]
    assert fetch.call_args.kwargs["timeout"] == 5
    assert fetch.call_args.kwargs["headers"]["apikey"] == "test-private-key"


def test_mountpoint_selection_and_failure_keep_known_locations(monkeypatch):
    from zgiis.cors import trignet

    monkeypatch.setenv("TRIGNET_NTRIP_HOST", "south-africa.example")
    monkeypatch.setenv("TRIGNET_NTRIP_MOUNTPOINTS", "Pret-SB")
    monkeypatch.setattr(trignet, "_CATALOG", {"at": 0.0, "stations": []})
    monkeypatch.setattr(trignet, "_fetch_sourcetable_text", lambda **source: SAMPLE if source else "SOURCETABLE 200 OK")
    assert [r["code"] for r in trignet.catalog()] == ["PRET"]
    trignet._CATALOG["at"] = 0.0
    def unavailable(**source):
        raise OSError("unavailable")
    monkeypatch.setattr(trignet, "_fetch_sourcetable_text", unavailable)
    assert [r["code"] for r in trignet.catalog()] == ["PRET"]


def test_earlier_rinex_hour_does_not_match_the_live_time():
    now = datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc)
    assert sample_matches_live_time("2026-10-21T23:59:00Z", now) is False
    assert sample_matches_live_time("2026-10-22T14:50:00Z", now) is True
    assert sample_matches_live_time(None, now) is False


def test_rinex_vtec_uses_the_shared_live_code_formula_and_elevation_mask(monkeypatch):
    from types import SimpleNamespace

    import georinex
    import numpy as np

    from zgiis.cors import trignet
    from zgiis.live import satellite_geometry
    from zgiis.live.stec_vtec import tecg_from_pseudorange, vtec_from_stec
    from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG

    class Observations:
        data_vars = {"C1C": None, "C2W": None}
        position_geodetic = np.array([-25.73, 28.28, 0.0])
        time = SimpleNamespace(
            values=np.array(
                [
                    "2026-10-21T22:00:00",
                    "2026-10-21T22:00:30",
                    "2026-10-21T22:01:00",
                    "2026-10-21T22:01:30",
                ],
                dtype="datetime64[ns]",
            )
        )
        sv = SimpleNamespace(values=np.array(["G12"]))
        C1C = np.full((4, 1), 20_200_000.0)
        C2W = C1C + 0.5

        def __contains__(self, name):
            return name in self.data_vars

        def __getitem__(self, name):
            return SimpleNamespace(values=getattr(self, name))

    observations = Observations()
    monkeypatch.setattr(georinex, "load", lambda *args, **kwargs: observations)
    monkeypatch.setattr(
        trignet,
        "_download",
        lambda _source, destination: destination.write_bytes(b"compressed"),
    )
    monkeypatch.setattr(
        trignet,
        "_decompress_obs",
        lambda _source, destination: destination.write_bytes(b"rinex"),
    )
    monkeypatch.setattr(
        trignet,
        "catalog",
        lambda: [{"code": "PRET", "lat": -25.73, "lon": 28.28}],
    )
    monkeypatch.setattr(satellite_geometry, "look_angles_ecef", lambda *_: (ELEVATION_MIN_DEG, 0.0))
    monkeypatch.setattr(trignet, "median_gg_vtec", lambda _rows: (None, 0))

    day = datetime(2026, 10, 21).date()
    result = trignet.compute_station_vtec("PRET", day, {12: {}})
    expected_stec = tecg_from_pseudorange(20_200_000.0, 20_200_000.5)

    assert result is not None
    assert result["samples"] == 2
    assert result["vtec"] == round(vtec_from_stec(expected_stec, ELEVATION_MIN_DEG), 2)

    monkeypatch.setattr(
        satellite_geometry,
        "look_angles_ecef",
        lambda *_: (ELEVATION_MIN_DEG - 0.01, 0.0),
    )
    assert trignet.compute_station_vtec("PRET", day, {12: {}}) is None


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


def test_sansa_live_calibration_matches_zimbabwe_engine_and_isolates_receivers(monkeypatch):
    from collections import defaultdict, deque
    import numpy as np
    from zgiis.cors import trignet
    from zgiis.processing.gg_calibration import calibrate_gg_from_observations

    monkeypatch.setattr(trignet, "_LIVE_CALIBRATION_ROWS", defaultdict(lambda: deque(maxlen=20000)))
    start = datetime.now(timezone.utc) - timedelta(minutes=12)
    samples = []
    for minute in range(12):
        sample = {"epoch": start + timedelta(minutes=minute), "station": "pret",
                  "prn": "G12", "elevation_deg": 55.0, "vtec_tecu": 22 + minute * .05,
                  "tec_method": "gopi_eq_4_11_code_live"}
        trignet._record_live_calibration(sample)
        trignet._record_live_calibration({**sample, "station": "tdou", "vtec_tecu": 70.0})
        samples.append({**sample, "time": sample["epoch"], "lat": -25.73, "lon": 28.28})
    # Zimbabwe's comparison endpoint invokes this engine per receiver.
    expected = calibrate_gg_from_observations(samples)
    value, count = trignet._live_gg_vtec("pret", -25.73, 28.28)
    assert count == len(expected) and count >= 8
    assert value == round(float(np.median([row["vtec_tecu"] for row in expected])), 2)
    assert trignet._live_gg_vtec("missing", -25.73, 28.28) == (None, 0)


def test_sansa_live_calibration_excludes_stale_and_phase_only_samples(monkeypatch):
    from collections import defaultdict, deque
    from zgiis.cors import trignet

    monkeypatch.setattr(trignet, "_LIVE_CALIBRATION_ROWS", defaultdict(lambda: deque(maxlen=20000)))
    sample = {"epoch": datetime.now(timezone.utc), "station": "pret", "prn": "G12",
              "elevation_deg": 55.0, "vtec_tecu": 22.0,
              "tec_method": "gopi_eq_4_12_phase_only_live_unleveled"}
    trignet._record_live_calibration(sample)
    assert not trignet._LIVE_CALIBRATION_ROWS
    trignet._record_live_calibration({**sample, "tec_method": "gopi_eq_4_11_code_live",
                                     "epoch": sample["epoch"] - timedelta(hours=1)})
    assert trignet._live_gg_vtec("pret", -25.73, 28.28) == (None, 0)
