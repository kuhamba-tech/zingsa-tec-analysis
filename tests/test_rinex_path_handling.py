import tempfile
import unittest
from pathlib import Path
import shutil

from tec_core import TecConfig, RINEX_EMPTY_HELP, _find_nav_file, _rinex_base_stem, read_rinex_files


class RinexPathHandlingTests(unittest.TestCase):
    def test_rinex_base_stem_strips_upload_prefix(self) -> None:
        p = Path("static/data/upload_tmp/abc_obs_karo1820.24o")
        self.assertEqual(_rinex_base_stem(p), "karo1820")

    def test_find_nav_matches_upload_prefixed_pair(self) -> None:
        obs = Path("tmp/abc_obs_karo1820.24o")
        nav = Path("tmp/abc_nav_karo1820.24n")
        self.assertEqual(_find_nav_file(obs, provided=[nav]), nav)

    def test_read_rinex_accepts_string_paths(self) -> None:
        obs_src = Path(
            r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science"
            r"\TEC ANAlYSIS\karoi\june\june\karo1820.24o"
        )
        nav_src = Path(
            r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science"
            r"\TEC ANAlYSIS\karoi\june\june\karo1820.24n"
        )
        if not obs_src.exists():
            self.skipTest("sample RINEX not available")
        df = read_rinex_files([str(obs_src)], TecConfig(), nav_files=[str(nav_src)])
        self.assertGreater(len(df), 0)

    def test_obs_only_without_nav_returns_empty(self) -> None:
        obs_src = Path(
            r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science"
            r"\TEC ANAlYSIS\karoi\june\june\karo1820.24o"
        )
        if not obs_src.exists():
            self.skipTest("sample RINEX not available")
        with tempfile.TemporaryDirectory() as tmp:
            obs = Path(tmp) / "karo1820.24o"
            shutil.copy(obs_src, obs)
            df = read_rinex_files([obs], TecConfig(), nav_files=None)
            self.assertTrue(df.empty)
            self.assertIn("navigation file", RINEX_EMPTY_HELP.lower())


if __name__ == "__main__":
    unittest.main()
