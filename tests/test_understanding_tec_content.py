import unittest

from zgiis.processing.understanding_tec_content import build_understanding_tec_payload


class UnderstandingTecContentTests(unittest.TestCase):
    def test_payload_has_ten_steps_with_svg_illustrations(self):
        payload = build_understanding_tec_payload()
        self.assertEqual(len(payload["steps"]), 10)
        for step in payload["steps"]:
            self.assertIn("<svg", step["illustration"]["svg"])
            self.assertTrue(step["body"])

    def test_harare_cors_in_first_step(self):
        payload = build_understanding_tec_payload()
        self.assertIn("Harare", payload["steps"][0]["body"])

    def test_journey_has_ten_pills(self):
        payload = build_understanding_tec_payload()
        self.assertEqual(len(payload["journey"]), 10)


if __name__ == "__main__":
    unittest.main()
