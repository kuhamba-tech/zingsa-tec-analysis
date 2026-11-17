from datetime import datetime, timezone
from unittest.mock import Mock

from zgiis.cors import west_africa


def test_separate_accounts_and_verified_locations(monkeypatch):
    senegal, ghana = west_africa.SITES
    monkeypatch.setenv("RTK2GO_NTRIP_EMAIL", "receiver@example.org")
    monkeypatch.delenv("IGS_NTRIP_USERNAME", raising=False)
    monkeypatch.delenv("IGS_NTRIP_PASSWORD", raising=False)
    assert west_africa.configuration(senegal)["username"] == "centipede"
    assert west_africa.configuration(ghana) is None
    assert (senegal["lat"], senegal["lon"]) == (14.479, -16.404)
    assert (ghana["lat"], ghana["lon"]) == (5.641472, -0.207111)
    monkeypatch.setenv("IGS_NTRIP_USERNAME", "receiver@example.org")
    assert west_africa.configuration(ghana) is None  # Email alone cannot grant access.
    monkeypatch.setenv("IGS_NTRIP_PASSWORD", "igs-account-password")
    assert west_africa.configuration(ghana) == {"host": "igs-ip.net", "port": 2101,
        "username": "receiver@example.org", "password": "igs-account-password"}


def test_each_stream_keeps_its_own_engine_and_pipeline(monkeypatch):
    from zgiis.live import ntrip_stream, satellite_geometry, stec_vtec, broadcast_ephemeris, pytecgg_service
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setenv("IGS_NTRIP_USERNAME", "receiver@example.org")
    monkeypatch.setenv("IGS_NTRIP_PASSWORD", "igs-account-password")
    monkeypatch.setattr(west_africa, "_networks", {})
    managers, engines, pipelines = [Mock(), Mock()], [Mock(), Mock()], [Mock(), Mock()]
    constructor = Mock(side_effect=managers)
    monkeypatch.setattr(ntrip_stream, "LiveNtripManager", constructor)
    monkeypatch.setattr(satellite_geometry, "LiveNavCache", Mock())
    monkeypatch.setattr(stec_vtec, "LiveVtecPipeline", Mock(side_effect=pipelines))
    monkeypatch.setattr(pytecgg_service, "register_network", Mock(side_effect=engines))
    monkeypatch.setattr(broadcast_ephemeris, "start_refresh_thread", Mock())
    monkeypatch.setattr(west_africa.threading, "Thread", Mock())
    west_africa.start()
    west_africa.start()
    assert constructor.call_count == 2
    for index in range(2):
        callback = constructor.call_args_list[index].kwargs["on_observation"]
        observation = {"station": west_africa.SITES[index]["code"]}
        callback(observation)
        engines[index].ingest.assert_called_once_with(observation)
        pipelines[index].ingest.assert_called_once_with(observation)


def test_pending_ghana_and_real_senegal_readings(monkeypatch):
    now = datetime.now(timezone.utc)
    manager, pipeline = Mock(), Mock()
    manager.status.return_value = {"nkhr": {"connected": True, "last_rtcm_at": now, "rtcm_count": 42}}
    pipeline.latest_by_station.return_value = {"nkhr": 24.0}
    pipeline.diagnostics_by_station.return_value = {"nkhr": {"last_code_vtec_at": now.isoformat(), "vtec_emitted": 8}}
    monkeypatch.setattr(west_africa, "_networks", {"senegal": (manager, pipeline)})
    senegal, ghana = west_africa.status({"senegal": {"nkhr": {"gg_vtec": 22.0}}})
    assert senegal["streaming"] and senegal["vtec"] == 24.0 and senegal["gg_vtec"] == 22.0
    assert ghana["connection_status"] == "igs_credentials_required"
    assert not ghana["connected"] and ghana["vtec"] is None
    assert all("username" not in row and "password" not in row for row in (senegal, ghana))
