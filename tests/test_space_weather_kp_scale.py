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
            (5.0, "G1 Storm"),
            (6.0, "G2 Storm"),
            (7.0, "G3+ Storm"),
        ]

        for kp, expected in cases:
            with self.subTest(kp=kp):
                condition, _ = _resolve_kp_level(kp)
                self.assertEqual(condition, expected)


if __name__ == "__main__":
    unittest.main()
