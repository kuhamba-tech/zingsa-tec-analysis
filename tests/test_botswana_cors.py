from datetime import datetime, timezone
from unittest.mock import Mock

from zgiis.cors import botswana
from zgiis.live.ntrip_stream import StationStream


def test_botswana_locations_and_pending_email(monkeypatch):
    monkeypatch.setattr(botswana, "_manager", None)
    monkeypatch.setattr(botswana, "_pipeline", None)
    monkeypatch.delenv("RTK2GO_NTRIP_EMAIL", raising=False)
    botswana.start()
    rows = botswana.status({})
    assert rows[0]["lat"] == -21.74 and rows[0]["lon"] == 21.7
    assert rows[1]["lat"] is None and rows[1]["lon"] is None
    assert not any(row["stream_configured"] for row in rows)
    assert rows[1]["gg_status"] == "receiver_coordinates_required"


def test_botswana_stream_and_calibration_are_isolated(monkeypatch):
    from zgiis.live import ntrip_stream, satellite_geometry, stec_vtec, broadcast_ephemeris, pytecgg_service
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setenv("RTK2GO_NTRIP_EMAIL", "receiver@example.org")
    monkeypatch.setattr(botswana, "_manager", None)
    monkeypatch.setattr(botswana, "_pipeline", None)
    manager, pipeline, nav = Mock(), Mock(), Mock()
    constructor = Mock(return_value=manager)
    register = Mock()
    monkeypatch.setattr(ntrip_stream, "LiveNtripManager", constructor)
    monkeypatch.setattr(satellite_geometry, "LiveNavCache", Mock(return_value=nav))
    monkeypatch.setattr(stec_vtec, "LiveVtecPipeline", Mock(return_value=pipeline))
    monkeypatch.setattr(pytecgg_service, "register_network", register)
    monkeypatch.setattr(broadcast_ephemeris, "start_refresh_thread", Mock())
    monkeypatch.setattr(botswana.threading, "Thread", Mock())
    botswana.start()
    botswana.start()
    constructor.assert_called_once()
    config = constructor.call_args.args[0]
    assert config["username"] == "receiver@example.org"
    assert config["password"] == "none" and config["ntrip_version"] == "1"
    assert config["host"] == "rtk2go.com" and config["port"] == 2101
    assert register.call_args.args[0] == "botswana"
    assert [s["code"] for s in register.call_args.args[1]] == ["GHANZIBW1"]
    nav.set_receiver_location.assert_called_once_with("GHANZIBW1", -21.74, 21.7)
    assert len(manager.start.call_args.args[0]) == 2


def test_unlocated_stream_never_exposes_tec(monkeypatch):
    monkeypatch.setattr(botswana, "_manager", Mock(status=lambda: {
        "surveyworldbotswana": {"connected": True, "last_rtcm_at": datetime.now(timezone.utc), "rtcm_count": 12}}))
    pipeline = Mock()
    pipeline.latest_by_station.return_value = {"surveyworldbotswana": 30}
    pipeline.diagnostics_by_station.return_value = {}
    monkeypatch.setattr(botswana, "_pipeline", pipeline)
    row = botswana.status({"botswana": {"surveyworldbotswana": {"gg_vtec": 25}}})[1]
    assert row["streaming"] and row["message_count"] == 12
    assert row["vtec"] is None and row["gg_vtec"] is None


def test_v1_icy_handshake_preserves_first_rtcm_byte(monkeypatch):
    pending = bytearray(b"ICY 200 OK\r\n\xd3\x00\x10")
    sock = Mock()
    def recv(size):
        value = bytes(pending[:size])
        del pending[:size]
        return value
    sock.recv.side_effect = recv
    monkeypatch.setattr("zgiis.live.ntrip_stream.socket.create_connection", lambda *a, **kw: sock)
    stream = StationStream("ghanzi", "GHANZIBW1", "rtk2go.com", 2101,
                           "receiver@example.org", "none", Mock(), ntrip_version="1")
    assert stream._connect() is sock
    request = sock.sendall.call_args.args[0]
    assert b"GET /GHANZIBW1 HTTP/1.0\r\n" in request
    assert b"Ntrip-Version" not in request
    assert pending == b"\xd3\x00\x10"
