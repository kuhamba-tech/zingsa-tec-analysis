import unittest

from zgiis.processing.vtec_theory_content import build_vtec_theory_payload


class VtecTheoryContentTests(unittest.TestCase):
    def test_payload_has_eleven_steps_with_svg_illustrations(self):
        payload = build_vtec_theory_payload()
        self.assertEqual(len(payload["steps"]), 11)
        for step in payload["steps"]:
            self.assertIn("<svg", step["illustration"]["svg"])
            self.assertTrue(step["equations"])

    def test_payload_includes_computation_pipeline(self):
        payload = build_vtec_theory_payload()
        pipe = payload["computation_pipeline"]
        self.assertEqual(len(pipe["inputs"]), 3)
        self.assertEqual(len(pipe["stages"]), 8)
        self.assertIn("ZGIIS", pipe["output"])

    def test_journey_matches_processing_pipeline(self):
        payload = build_vtec_theory_payload()
        self.assertEqual(len(payload["journey"]), 7)
        self.assertEqual(payload["journey"][0]["num"], "1")
        self.assertEqual(payload["journey"][0]["short"], "RINEX/CMN loading")
        self.assertEqual(payload["journey"][-1]["short"], "Map/table generation")


if __name__ == "__main__":
    unittest.main()
