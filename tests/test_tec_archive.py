import unittest

from zgiis.data.tec_archive import load_historical_tec


class TecArchiveTests(unittest.TestCase):
    def test_packaged_archive_has_expected_real_coverage(self):
        frame, metadata = load_historical_tec()

        self.assertTrue(metadata["available"])
        self.assertFalse(frame.empty)
        self.assertEqual(
            set(frame["station"].unique()),
            {"chim", "gsu", "karo", "zinh"},
        )
        self.assertEqual(frame["date"].min().strftime("%Y-%m-%d"), "2024-04-01")
        self.assertEqual(frame["date"].max().strftime("%Y-%m-%d"), "2024-06-30")
        self.assertGreater(metadata["observations"], 7_000_000)
        self.assertEqual(metadata["source_files"], 364)
        self.assertFalse(frame.duplicated(["station", "timestamp"]).any())


if __name__ == "__main__":
    unittest.main()
