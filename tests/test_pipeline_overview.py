import unittest
from pathlib import Path

from zgiis.processing.pipeline_explanations import PROCESSING_STAGE_OVERVIEW


class PipelineOverviewTests(unittest.TestCase):
    def test_overview_has_the_seven_processing_stages(self):
        self.assertEqual(
            [stage for stage, _ in PROCESSING_STAGE_OVERVIEW],
            [
                "RINEX/CMN loading",
                "Cycle slip detection",
                "Satellite bias correction",
                "Receiver bias correction",
                "Slant TEC calculation",
                "Vertical TEC calculation",
                "Map/table generation",
            ],
        )

    def test_theory_page_uses_cards_instead_of_pipeline_svg(self):
        source = Path("pages/10_VTEC_Theory.py").read_text(encoding="utf-8")

        self.assertIn("render_pipeline_overview_cards()", source)
        self.assertNotIn('render_vtec_illustration("pipeline")', source)

    def test_overview_has_tablet_and_mobile_layouts(self):
        css = Path("zgiis/theme.py").read_text(encoding="utf-8")

        self.assertIn("@media (max-width: 1100px)", css)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", css)
        self.assertIn("@media (max-width: 560px)", css)
        self.assertIn("grid-template-columns: 1fr;", css)
        self.assertIn("white-space: normal;", css)


if __name__ == "__main__":
    unittest.main()
