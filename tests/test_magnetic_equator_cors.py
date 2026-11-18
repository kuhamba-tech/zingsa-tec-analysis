from zgiis.cors import magnetic_equator, west_africa
from zgiis.space_weather.igrf14 import dip_latitude_deg


def test_selected_locations_are_near_magnetic_equator():
    assert {site["code"] for site in magnetic_equator.SITES} == {"SGOC", "POHN", "POVE", "ADIS", "NAUS"}
    assert len({site["network"] for site in magnetic_equator.SITES}) == 5
    for site in magnetic_equator.SITES:
        assert abs(dip_latitude_deg(site["lat"], site["lon"], 2026.88)) < 2


def test_igs_stations_do_not_use_earthscope_credentials(monkeypatch):
    monkeypatch.setattr(west_africa, "_networks", {})
    monkeypatch.delenv("IGS_NTRIP_USERNAME", raising=False)
    monkeypatch.delenv("IGS_NTRIP_PASSWORD", raising=False)
    monkeypatch.setenv("EARTHSCOPE_NTRIP_USERNAME", "other-provider-user")
    monkeypatch.setenv("EARTHSCOPE_NTRIP_PASSWORD", "other-provider-password")
    for site in magnetic_equator.SITES:
        assert west_africa.configuration(site) is None
    rows = magnetic_equator.status({})
    assert len(rows) == 5
    assert all(row["connection_status"] == "igs_credentials_required" for row in rows)
    assert all(not row["streaming"] and row["vtec"] is None and row["gg_vtec"] is None for row in rows)


def test_configured_igs_account_is_used_on_correct_caster(monkeypatch):
    monkeypatch.setenv("IGS_NTRIP_USERNAME", "igs-user")
    monkeypatch.setenv("IGS_NTRIP_PASSWORD", "igs-password")
    for site in magnetic_equator.SITES:
        config = west_africa.configuration(site)
        assert config == {"host": "igs-ip.net", "port": 2101, "username": "igs-user", "password": "igs-password"}
