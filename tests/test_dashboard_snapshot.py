"""Each advisory screenshot belongs to one deployment and one send."""

from datetime import datetime, timezone

from zgiis.space_weather.dashboard_snapshot import deployment_label, snapshot_object_path


def test_every_send_gets_a_new_path_under_its_deployment(monkeypatch):
    monkeypatch.setenv("VERCEL_DEPLOYMENT_ID", "dpl_7C7gZdrBNYEXJ2XKjGkv6v2PjDzA")
    monkeypatch.delenv("VERCEL_GIT_COMMIT_SHA", raising=False)
    issued = datetime(2026, 11, 11, 14, 45, tzinfo=timezone.utc)
    first = snapshot_object_path(issued, "aaaa1111")
    second = snapshot_object_path(issued, "bbbb2222")
    assert deployment_label() == "dpl_7C7gZdrBNYEXJ2XKjGkv6v2PjDzA"
    assert first != second
    assert first.startswith("space-weather/dpl_7C7gZdrBNYEXJ2XKjGkv6v2PjDzA/20261111T144500Z-")
    assert first.endswith("aaaa1111.png")
    assert second.endswith("bbbb2222.png")
