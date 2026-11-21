def test_live_vtec_sampler_attempts_every_configured_mountpoint_by_default(monkeypatch):
    import zgiis.live.heatmap_live_vtec as sampler
    import zgiis.live.mountpoints as mountpoints
    import zgiis.live.ntrip_config as ntrip_config

    configured = {f"site{i:02d}": f"MP{i:02d}" for i in range(24)}
    sampled = []
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("TEC_HEATMAP_LIVE_NTRIP", "1")
    monkeypatch.setenv("TEC_HEATMAP_LIVE_MAX_STATIONS", "8")
    monkeypatch.setenv("NTRIP_USERNAME", "test-user")
    monkeypatch.setenv("NTRIP_PASSWORD", "test-password")
    monkeypatch.setattr(mountpoints, "parse_mountpoints", lambda: configured)
    monkeypatch.setattr(ntrip_config, "ntrip_host_from_env", lambda: "caster.test")
    monkeypatch.setattr(sampler, "_warm_nav_cache", lambda: object())
    monkeypatch.setattr(sampler, "_CACHE", None)
    monkeypatch.setattr(sampler, "_CACHE_TS", 0.0)

    def sample_station(**kwargs):
        sampled.append(kwargs["code"])
        return {"station": kwargs["code"], "mean_vtec_tecu": 12.0}

    monkeypatch.setattr(sampler, "_sample_station", sample_station)
    payload = sampler.sample_live_ntrip_vtec(refresh=True)

    assert payload["summary"]["requested"] == len(configured)
    assert set(sampled) == set(configured)
