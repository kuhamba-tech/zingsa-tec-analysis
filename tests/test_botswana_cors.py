from unittest.mock import Mock

import pytest

from zgiis.live.ntrip_stream import StationStream


def test_v1_icy_handshake_preserves_first_rtcm_byte(monkeypatch):
    pending = bytearray(b"ICY 200 OK\r\n\xd3\x00\x10")
    sock = Mock()
    def recv(size):
        value = bytes(pending[:size])
        del pending[:size]
        return value
    sock.recv.side_effect = recv
    monkeypatch.setattr("zgiis.live.ntrip_stream.socket.create_connection", lambda *a, **kw: sock)
    stream = StationStream("test", "TEST-MOUNT", "rtk2go.com", 2101,
                           "receiver@example.org", "none", Mock(), ntrip_version="1")
    assert stream._connect() is sock
    request = sock.sendall.call_args.args[0]
    assert b"GET /TEST-MOUNT HTTP/1.0\r\n" in request
    assert b"Ntrip-Version" not in request
    assert pending == b"\xd3\x00\x10"


@pytest.mark.parametrize("mountpoint", ["GHANZIBW1", "GHANZIBW", "SurveyWorldBotswana"])
def test_retired_mount_does_not_open_a_socket(monkeypatch, mountpoint):
    connect = Mock()
    monkeypatch.setattr("zgiis.live.ntrip_stream.socket.create_connection", connect)
    stream = StationStream("retired", mountpoint, "rtk2go.com", 2101,
                           "receiver@example.org", "none", Mock(), ntrip_version="1")
    stream.run()
    with pytest.raises(ConnectionError, match="Retired RTK2go mountpoint"):
        stream._connect()
    connect.assert_not_called()
