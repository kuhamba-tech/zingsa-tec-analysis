import unittest

from zgiis.space_weather.fetch_indices import _resolve_kp_level


class KpScaleTests(unittest.TestCase):
    def test_resolve_kp_level_uses_reference_scale_boundaries(self):
        cases = [
            (0.0, "Quiet"),
            (1.0, "Quiet"),
            (2.0, "Quiet"),
            (2.99, "Quiet"),
            (3.0, "Unsettled"),
            (3.99, "Unsettled"),
            (4.0, "Active"),
            (5.0, "Minor Storm G1"),
            (6.0, "Moderate Storm G2"),
            (7.0, "Strong Storm G3"),
            (8.0, "Severe Storm G4"),
            (9.0, "Extreme Storm G5"),
        ]

        for kp, expected in cases:
            with self.subTest(kp=kp):
                condition, _ = _resolve_kp_level(kp)
                self.assertEqual(condition, expected)


if __name__ == "__main__":
    unittest.main()
