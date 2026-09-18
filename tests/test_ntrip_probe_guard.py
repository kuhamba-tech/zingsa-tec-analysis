from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe, ntrip_probe_enabled


def test_probe_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_NTRIP_PROBE", raising=False)

    assert ntrip_probe_enabled() is False
    payload = get_cached_ntrip_probe(listen_sec=4.0)
    assert payload["stations"] == []
    assert payload["summary"]["total"] == 0
    assert "additional caster sessions" in payload["error"]


def test_probe_can_be_explicitly_enabled(monkeypatch):
    monkeypatch.setenv("ENABLE_NTRIP_PROBE", "true")
    assert ntrip_probe_enabled() is True
