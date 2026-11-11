"""The scheduled Slack jobs may call production POST routes with CRON_SECRET."""

from starlette.requests import Request

from backend.deps import cron_request_authorized


def _request(secret: str) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"x-cron-secret", secret.encode())],
            "client": ("127.0.0.1", 0),
            "server": ("test", 443),
        }
    )


def test_matching_cron_secret_is_accepted(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "scheduled-job-secret")
    assert cron_request_authorized(_request("scheduled-job-secret")) is True


def test_wrong_or_missing_cron_secret_is_rejected(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "scheduled-job-secret")
    assert cron_request_authorized(_request("other-secret")) is False
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert cron_request_authorized(_request("scheduled-job-secret")) is False
