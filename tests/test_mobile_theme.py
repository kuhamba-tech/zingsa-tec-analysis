import unittest
from pathlib import Path


class MobileThemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = Path("zgiis/theme.py").read_text(encoding="utf-8")
        cls.dashboard = Path("pages/1_Dashboard.py").read_text(encoding="utf-8")

    def test_shared_theme_stacks_streamlit_columns_on_mobile(self):
        self.assertIn('@media (max-width: 700px)', self.css)
        self.assertIn(
            '[data-testid="stHorizontalBlock"] > [data-testid="stColumn"]',
            self.css,
        )
        self.assertIn("flex: 1 1 100% !important;", self.css)

    def test_shared_theme_keeps_tabs_scrollable(self):
        self.assertIn('[data-baseweb="tab-list"]', self.css)
        self.assertIn("overflow-x: auto !important;", self.css)
        self.assertIn("flex-wrap: nowrap !important;", self.css)

    def test_theme_uses_uniform_black_background(self):
        self.assertIn("#168bd2", self.css)
        self.assertIn("#000000", self.css)
        self.assertNotIn("#0d2240", self.css)
        self.assertNotIn("#00d4ff", self.css)

    def test_sidebar_matches_reference_navy_with_blue_edge(self):
        self.assertIn("background: #000000 !important;", self.css)
        self.assertIn("border-right: 10px solid #17367a;", self.css)
        self.assertIn('[aria-current="page"]', self.css)
        self.assertIn("background: #17367a !important;", self.css)

    def test_dashboard_collapses_sidebar_for_mobile_requests(self):
        self.assertIn("mobile_request = is_mobile_request(st)", self.dashboard)
        self.assertIn(
            'initial_sidebar_state="collapsed" if mobile_request else "expanded"',
            self.dashboard,
        )


if __name__ == "__main__":
    unittest.main()
