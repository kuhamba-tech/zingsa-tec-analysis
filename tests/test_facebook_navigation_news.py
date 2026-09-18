"""Tests for Navigation News Facebook Page publishing."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from zgiis.navigation.facebook_publish import (
    STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID,
    STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL,
    build_facebook_post,
    publish_navigation_news_to_facebook,
    resolve_facebook_page_id,
)


def _brief(audience_id: str, headline: str, social: str = "") -> SimpleNamespace:
    return SimpleNamespace(
        id=audience_id,
        headline=headline,
        social_script=social or f"Social copy for {audience_id}",
    )


class FacebookNavigationNewsTests(unittest.TestCase):
    def test_default_page_id_is_stellar_aspirations_page(self) -> None:
        from zgiis.navigation.facebook_credentials_file import clear_facebook_page_id_cache

        clear_facebook_page_id_cache()
        with patch.dict("os.environ", {}, clear=True):
            with patch(
                "zgiis.navigation.facebook_credentials_file.load_facebook_credentials",
                return_value={},
            ):
                self.assertEqual(resolve_facebook_page_id(), STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID)
        self.assertIn("61562022072713", STELLAR_ASPIRATIONS_FACEBOOK_PAGE_URL)

    def test_build_facebook_post_uses_national_social_template(self) -> None:
        from zgiis.navigation.national_navigation_social import build_national_navigation_social

        social = build_national_navigation_social("excellent", None, computed_at="2024-06-01T12:00:00+00:00")
        briefs = [
            _brief("citizen", "Quiet day for GPS", social),
        ]
        text = build_facebook_post(briefs, computed_at="2024-06-01T12:00:00+00:00")
        self.assertIn("ACTIVE (MILD) CONDITIONS", text)
        self.assertIn("ZINGSA Navigation & Space Weather Update", text)
        self.assertIn("#ZINGSA", text)
        self.assertIn("Updated 2024-06-01 12:00:00", text)

    def test_managed_pages_resolve_stellar_page_token(self) -> None:
        from zgiis.navigation.facebook_credentials_file import (
            clear_facebook_page_id_cache,
            resolve_page_feed_access_token,
        )

        clear_facebook_page_id_cache()
        with patch("zgiis.navigation.facebook_credentials_file._fetch_managed_pages") as mock_pages:
            mock_pages.return_value = [
                {
                    "id": "308577745682463",
                    "name": "Stellar Aspirations",
                    "access_token": "page-feed-token",
                }
            ]
            page_id, page_token = resolve_page_feed_access_token(
                token="user-token",
                page_id="308577745682463",
            )
            self.assertEqual(page_id, "308577745682463")
            self.assertEqual(page_token, "page-feed-token")
        clear_facebook_page_id_cache()

    def test_token_lookup_resolves_graph_page_id(self) -> None:
        from zgiis.navigation.facebook_credentials_file import (
            clear_facebook_page_id_cache,
            lookup_graph_page_id_from_token,
            resolve_facebook_page_id_from_credentials,
        )

        clear_facebook_page_id_cache()
        with patch("requests.get") as mock_get:
            mock_get.return_value = MagicMock(
                status_code=200,
                json=lambda: {"id": "1234567890", "name": "Stellar Aspirations"},
            )
            self.assertEqual(lookup_graph_page_id_from_token("page-token"), "1234567890")
            with patch.dict("os.environ", {}, clear=True):
                with patch(
                    "zgiis.navigation.facebook_credentials_file.resolve_facebook_page_access_token",
                    return_value="page-token",
                ):
                    self.assertEqual(
                        resolve_facebook_page_id_from_credentials(token="page-token"),
                        "1234567890",
                    )
        clear_facebook_page_id_cache()

    @patch("zgiis.navigation.facebook_publish.resolve_facebook_page_id")
    @patch("zgiis.navigation.facebook_publish.FacebookPageChannel")
    @patch("backend.routers.navigation_news.get_navigation_news_bundle")
    def test_publish_dry_run_does_not_call_graph_api(
        self, mock_bundle, mock_channel_cls, mock_resolve_page_id
    ) -> None:
        mock_resolve_page_id.return_value = STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID
        mock_bundle.return_value = SimpleNamespace(
            computed_at="2024-06-01T12:00:00+00:00",
            briefs=[_brief("citizen", "Test headline", "Social line")],
            input_summary="live",
        )
        mock_channel = MagicMock()
        mock_channel.send.return_value = SimpleNamespace(
            ok=True, dry_run=True, detail="dry-run"
        )
        mock_channel_cls.return_value = mock_channel

        with patch.dict("os.environ", {"FACEBOOK_BROADCAST_ENABLED": "true"}, clear=False):
            result = publish_navigation_news_to_facebook(dry_run=True)

        self.assertTrue(result["ok"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["page_id"], STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID)
        mock_channel.send.assert_called_once()
        call_kw = mock_channel.send.call_args.kwargs
        self.assertTrue(call_kw["dry_run"])
        self.assertEqual(call_kw["options"]["page_id"], STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID)
        self.assertIn("Social line", call_kw["text"])

    @patch("zgiis.navigation.broadcast_agent.channels.requests.post")
    @patch("backend.routers.navigation_news.get_navigation_news_bundle")
    def test_live_post_hits_facebook_graph_api(self, mock_bundle, mock_post) -> None:
        from zgiis.navigation.broadcast_agent import channels

        mock_bundle.return_value = SimpleNamespace(
            computed_at="2024-06-01T12:00:00+00:00",
            briefs=[_brief("citizen", "Live test headline", "Live social")],
            input_summary="live",
        )
        mock_post.return_value = MagicMock(status_code=200, text='{"id":"post_123"}')

        channel = channels.FacebookPageChannel()
        result = channel.send(
            audience="citizen",
            script_kind="social",
            text="Live navigation news test",
            brief={"headline": "Live test headline"},
            dry_run=False,
            options={"page_id": STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID, "page_token": "test-token"},
        )

        self.assertTrue(result.ok)
        mock_post.assert_called_once()
        url = mock_post.call_args.args[0]
        self.assertIn(STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID, url)
        self.assertIn("graph.facebook.com", url)
        params = mock_post.call_args.kwargs.get("params") or mock_post.call_args[1].get("params")
        self.assertEqual(params["access_token"], "test-token")
        self.assertIn("Live navigation news", params["message"])

    def test_dry_run_succeeds_without_page_token(self) -> None:
        from zgiis.navigation.broadcast_agent import channels

        channel = channels.FacebookPageChannel()
        with patch.dict("os.environ", {}, clear=True):
            result = channel.send(
                audience="citizen",
                script_kind="social",
                text="Dry-run navigation news test",
                brief={"headline": "Test"},
                dry_run=True,
                options={"page_id": STELLAR_ASPIRATIONS_FACEBOOK_PAGE_ID},
            )

        self.assertTrue(result.ok)
        self.assertTrue(result.dry_run)
        self.assertEqual(result.detail, "dry-run")

    def test_token_loads_from_private_credentials_file(self) -> None:
        import json
        import tempfile
        from pathlib import Path

        from zgiis.navigation.facebook_credentials_file import resolve_facebook_page_access_token

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "facebook_credentials.private.json"
            path.write_text(
                json.dumps({"page_access_token": "file-secret-token"}),
                encoding="utf-8",
            )
            with patch.dict("os.environ", {"FACEBOOK_CREDENTIALS_FILE": str(path)}, clear=True):
                self.assertEqual(resolve_facebook_page_access_token(), "file-secret-token")

        with patch.dict("os.environ", {"FACEBOOK_PAGE_ACCESS_TOKEN": "env-token"}, clear=True):
            self.assertEqual(resolve_facebook_page_access_token(), "env-token")


if __name__ == "__main__":
    unittest.main()
