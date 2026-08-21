import unittest

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

if __name__ == "__main__":
    unittest.main()
