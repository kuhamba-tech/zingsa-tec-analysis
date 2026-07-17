from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd

from tec_core import _load_dcb_for_date


DCB_TEXT = """
* CODE DCB sample
G01   0.62   0.01
G02  -1.79   0.01
R01   1.25   0.02
"""


def test_load_dcb_prefers_monthly_archive_without_fetch(tmp_path: Path):
    (tmp_path / "P1C12404.DCB").write_text("G01 0.10\n", encoding="ascii")
    (tmp_path / "P1P22404.DCB").write_text("G01 0.20\n", encoding="ascii")

    with patch("requests.get") as get:
        p1c1, p1p2 = _load_dcb_for_date(tmp_path, pd.Timestamp("2024-04-15"))

    assert p1c1 == {"G01": 0.10}
    assert p1p2 == {"G01": 0.20}
    get.assert_not_called()


def test_load_dcb_fetches_daily_code_products_when_monthly_missing(tmp_path: Path):
    response = Mock()
    response.text = DCB_TEXT
    response.raise_for_status.return_value = None

    with patch("requests.get", return_value=response) as get:
        p1c1, p1p2 = _load_dcb_for_date(tmp_path, pd.Timestamp("2024-04-15"))

    assert p1c1["G01"] == 0.62
    assert p1c1["G02"] == -1.79
    assert p1p2["R01"] == 1.25
    assert (tmp_path / "P1C1.DCB").exists()
    assert (tmp_path / "P1P2.DCB").exists()
    assert get.call_count == 2
