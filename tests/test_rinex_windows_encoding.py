import io
import logging
from pathlib import Path
import unittest
from unittest.mock import patch

from tec_core import TecConfig, _ascii_diagnostic, read_rinex_files


class RinexWindowsEncodingTests(unittest.TestCase):
    def test_parser_diagnostics_are_safe_for_legacy_windows_streams(self):
        raw = io.BytesIO()
        stream = io.TextIOWrapper(raw, encoding="cp1252", errors="strict")
        handler = logging.StreamHandler(stream)
        logger = logging.getLogger("tec_core")
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)

        try:
            logger.info(
                "%s: receiver ECEF=%s, navigation=%s; computing elevations",
                "station.24o",
                [1.0, 2.0, 3.0],
                "station.24n",
            )
            logger.info(
                "%s: elevation range %.1f to %.1f degrees",
                "station.24o",
                25.0,
                82.5,
            )
            handler.flush()
        finally:
            logger.removeHandler(handler)
            stream.detach()

        output = raw.getvalue().decode("cp1252")
        self.assertIn("computing elevations", output)
        self.assertNotIn("\u2192", output)
        self.assertNotIn("\u00b0", output)

    def test_unicode_parser_error_is_escaped_to_ascii(self):
        diagnostic = _ascii_diagnostic(
            "bad epoch \u2192 cannot calculate 25\u00b0 elevation"
        )

        diagnostic.encode("cp1252", errors="strict")
        self.assertIn("\\u2192", diagnostic)
        self.assertIn("\\xb0", diagnostic)

    def test_unicode_georinex_error_does_not_escape_parser(self):
        with patch(
            "georinex.load",
            side_effect=RuntimeError("bad epoch \u2192 invalid observation"),
        ):
            result = read_rinex_files(
                [Path("station1140.24o")],
                TecConfig(),
            )

        self.assertTrue(result.empty)


if __name__ == "__main__":
    unittest.main()
