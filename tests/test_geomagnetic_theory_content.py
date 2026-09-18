import unittest

from zgiis.space_weather.geomagnetic_theory_content import build_geomagnetic_theory_payload


class GeomagneticTheoryContentTests(unittest.TestCase):
    def test_payload_has_eight_steps_with_svg_illustrations(self):
        payload = build_geomagnetic_theory_payload()
        self.assertEqual(len(payload["steps"]), 8)
        for step in payload["steps"]:
            self.assertIn("<svg", step["illustration"]["svg"])
            self.assertTrue(step["body"])

    def test_payload_includes_reading_pipeline(self):
        payload = build_geomagnetic_theory_payload()
        pipe = payload["computation_pipeline"]
        self.assertGreaterEqual(len(pipe["inputs"]), 3)
        self.assertGreaterEqual(len(pipe["stages"]), 3)
        self.assertIn("ZGIIS", pipe["output"])

    def test_journey_matches_step_meta(self):
        payload = build_geomagnetic_theory_payload()
        self.assertEqual(len(payload["journey"]), 8)
        self.assertEqual(payload["journey"][0]["num"], "1")
        self.assertIn("Kp", payload["steps"][1]["title"])


if __name__ == "__main__":
    unittest.main()
