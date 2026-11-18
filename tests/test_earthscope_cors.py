from zgiis.cors import earthscope, west_africa


def test_selected_sites_wait_for_their_own_credentials(monkeypatch):
    monkeypatch.setattr(west_africa, "_networks", {})
    monkeypatch.delenv("EARTHSCOPE_NTRIP_USERNAME", raising=False)
    monkeypatch.delenv("EARTHSCOPE_NTRIP_PASSWORD", raising=False)
    monkeypatch.setenv("IGS_NTRIP_USERNAME", "different-provider")
    monkeypatch.setenv("IGS_NTRIP_PASSWORD", "different-password")
    assert all(west_africa.configuration(site) is None for site in earthscope.SITES)
    rows = earthscope.status({})
    assert {row["code"] for row in rows} == {"BYAH", "RUBO", "ACSB", "AGMT", "PCCL", "FBAQ", "IQQE", "GTA1", "ISCO", "CN46", "CN64", "CN47", "PTPP", "CN60", "SRGD", "CBAA", "CONS", "AB07", "AB09", "AB11"}
    assert len({row["network"] for row in rows}) == 20
    assert all(not row["streaming"] and row["vtec"] is None and row["gg_vtec"] is None for row in rows)
    assert all(row["connection_status"] == "earthscope_credentials_required" for row in rows)


def test_earthscope_uses_tls_and_provider_issued_credentials(monkeypatch):
    monkeypatch.setenv("EARTHSCOPE_NTRIP_USERNAME", "test-earthscope-user")
    monkeypatch.setenv("EARTHSCOPE_NTRIP_PASSWORD", "test-earthscope-password")
    for site in earthscope.SITES:
        config = west_africa.configuration(site)
        assert config["host"] == "ntrip.earthscope.org" and config["port"] == 3101
        assert config["connection"] == "TLS" and config["ntrip_version"] == "2"
        assert config["username"] == "test-earthscope-user"
        assert config["password"] == "test-earthscope-password"


def test_earthscope_results_remain_per_receiver(monkeypatch):
    monkeypatch.setattr(west_africa, "_networks", {})
    rows = earthscope.status({"earthscope_byah": {"byah": {"gg_vtec": 22.0}}})
    by_code = {row["code"]: row for row in rows}
    assert by_code["BYAH"]["gg_vtec"] == 22.0
    assert all(by_code[code]["gg_vtec"] is None for code in ("RUBO", "ACSB", "AGMT"))


def test_northern_crest_sites_have_distinct_mounts_and_magnetic_latitudes():
    from zgiis.space_weather.igrf14 import dip_latitude_deg
    sites = [site for site in earthscope.SITES if site["region"] == "Northern EIA crest"]
    assert {site["code"] for site in sites} == {"ISCO", "CN46", "CN64", "CN47", "PTPP", "CN60"}
    for site in sites:
        assert 10 < dip_latitude_deg(site["lat"], site["lon"], 2026.88) < 20
        assert site["mountpoint"] == site["code"] + "_RTCM3P3"


def test_additional_receivers_match_requested_dip_latitude_bands():
    from zgiis.space_weather.igrf14 import dip_latitude_deg

    sites = {site["code"]: site for site in earthscope.SITES}
    bands = {"PTPP": (10, 20), "CN60": (10, 20),
             "SRGD": (-20, -10), "CBAA": (-20, -10),
             "CONS": (-60, -20), "AB07": (20, 60),
             "AB09": (60, 90), "AB11": (60, 90)}
    for code, (lower, upper) in bands.items():
        site = sites[code]
        dip = dip_latitude_deg(site["lat"], site["lon"], 2026.88)
        assert lower < dip < upper
        assert abs(dip - site["magnetic_latitude_approx"]) < .01
        assert "GPS" in site["constellations"]


def test_chunked_transport_removes_framing_across_rtcm_bytes(monkeypatch):
    import socket
    from pynmeagps import SocketWrapper
    from zgiis.live.ntrip_stream import StationStream

    client, server = socket.socketpair()
    client.settimeout(2)
    try:
        payload = b"\xd3\x00\x03\x40\x00\x00\x12\x34\x56"
        chunks = (payload[:2], payload[2:5], payload[5:])
        body = b"".join(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n" for chunk in chunks)
        server.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: gnss/data\r\nTransfer-Encoding: chunked\r\n\r\n" + body + b"0\r\n\r\n")
        server.shutdown(socket.SHUT_WR)
        monkeypatch.setattr("zgiis.live.ntrip_stream.socket.create_connection", lambda *a, **kw: client)
        stream = StationStream("byah", "BYAH_RTCM3P3", "example.test", 2101, "user", "pass", lambda _: None)
        assert stream._connect() is client
        assert stream._rtcm_encoding == 1
        decoded = SocketWrapper(client, encoding=stream._rtcm_encoding, bufsize=1)
        assert decoded.read(len(payload)) == payload
    finally:
        client.close()
        server.close()
