"""Tests for Navigation News Facebook Page publishing."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from zgiis.navigation.facebook_publish import (
    ZINGSA_FACEBOOK_PAGE_ID,
    ZINGSA_FACEBOOK_PAGE_URL,
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
    def test_default_page_id_is_zingsa_page(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(resolve_facebook_page_id(), ZINGSA_FACEBOOK_PAGE_ID)
        self.assertIn("61562022072713", ZINGSA_FACEBOOK_PAGE_URL)

    def test_build_facebook_post_includes_all_roles(self) -> None:
        briefs = [
            _brief("citizen", "Quiet day for GPS", "Citizen social #SpaceWeather"),
            _brief("farmer", "RTK stable"),
            _brief("surveyor", "Fix quality good"),
            _brief("driver", "Maps reliable"),
            _brief("aviation", "RAIM green"),
            _brief("scientist", "Quiet ionosphere for CORS QC"),
        ]
        text = build_facebook_post(briefs, computed_at="2024-06-01T12:00:00+00:00")
        self.assertIn("Space enthusiast", text)
        self.assertIn("Farmer", text)
        self.assertIn("Surveyor", text)
        self.assertIn("Scientist", text)
        self.assertIn("Quiet day for GPS", text)
        self.assertIn("Citizen social", text)
        self.assertIn("#ZINGSA", text)

    @patch("zgiis.navigation.facebook_publish.FacebookPageChannel")
    @patch("backend.routers.navigation_news.get_navigation_news_bundle")
    def test_publish_dry_run_does_not_call_graph_api(
        self, mock_bundle, mock_channel_cls
    ) -> None:
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
        self.assertEqual(result["page_id"], ZINGSA_FACEBOOK_PAGE_ID)
        mock_channel.send.assert_called_once()
        call_kw = mock_channel.send.call_args.kwargs
        self.assertTrue(call_kw["dry_run"])
        self.assertEqual(call_kw["options"]["page_id"], ZINGSA_FACEBOOK_PAGE_ID)
        self.assertIn("Test headline", call_kw["text"])

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
            options={"page_id": ZINGSA_FACEBOOK_PAGE_ID, "page_token": "test-token"},
        )

        self.assertTrue(result.ok)
        mock_post.assert_called_once()
        url = mock_post.call_args.args[0]
        self.assertIn(ZINGSA_FACEBOOK_PAGE_ID, url)
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
                options={"page_id": ZINGSA_FACEBOOK_PAGE_ID},
            )

        self.assertTrue(result.ok)
        self.assertTrue(result.dry_run)
        self.assertEqual(result.detail, "dry-run")


if __name__ == "__main__":
    unittest.main()
