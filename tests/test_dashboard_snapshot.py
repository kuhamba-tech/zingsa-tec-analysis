"""Each advisory screenshot belongs to one deployment and one send."""

from datetime import datetime, timezone
from unittest.mock import Mock

from zgiis.space_weather import dashboard_snapshot
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


def test_metrics_attachment_uploads_rendered_png_without_screenshot(monkeypatch):
    png = b"\x89PNG\r\n\x1a\nrendered"
    get = Mock(return_value=Mock(content=png))
    store = Mock(return_value="https://example.com/metrics.png")
    monkeypatch.setattr(dashboard_snapshot.requests, "get", get)
    monkeypatch.setattr(dashboard_snapshot, "_capture_png", Mock(side_effect=AssertionError))
    monkeypatch.setattr(dashboard_snapshot, "_store_png", store)

    key, page, label = dashboard_snapshot._MESSAGE_VIEWS[0]
    assert dashboard_snapshot._publish_view(key, page, label, None, "test") == (
        "Live metrics",
        "https://example.com/metrics.png",
    )
    get.assert_called_once_with(page, timeout=45)
    assert store.call_args.args[0] == png
    assert store.call_args.args[1].endswith("-test-metrics.png")


def test_metrics_attachment_skips_non_image_response(monkeypatch):
    monkeypatch.setattr(dashboard_snapshot.requests, "get", Mock(return_value=Mock(content=b"<html>Loading</html>")))
    store = Mock()
    monkeypatch.setattr(dashboard_snapshot, "_store_png", store)

    key, page, label = dashboard_snapshot._MESSAGE_VIEWS[0]
    assert dashboard_snapshot._publish_view(key, page, label, None, "test") is None
    store.assert_not_called()
