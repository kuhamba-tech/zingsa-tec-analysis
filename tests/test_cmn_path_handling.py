import tempfile
import unittest
from pathlib import Path

from tec_core import TecConfig, read_cmn_file


CMN_SAMPLE = """# Synthetic CMN test sample
# mjdate time prn az elevation lat lon stec vtec s4
# Parser skips these three header rows
60481 6.0 1 45 35 -17.8 31.0 24.0 14.0 0.10
60481 7.0 2 60 42 -17.7 31.1 27.0 16.0 0.12
"""


class CmnPathHandlingTests(unittest.TestCase):
    def test_read_cmn_file_accepts_path_and_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "verification-2026-06-20.Cmn"
            sample.write_text(CMN_SAMPLE, encoding="utf-8")

            from_path = read_cmn_file(sample, TecConfig())
            from_string = read_cmn_file(str(sample), TecConfig())

        self.assertEqual(len(from_path), 2)
        self.assertEqual(len(from_string), 2)
        self.assertEqual(from_path["vtec"].tolist(), [14.0, 16.0])
        self.assertEqual(from_string["vtec"].tolist(), [14.0, 16.0])


if __name__ == "__main__":
    unittest.main()
