from datetime import date
import io
import zipfile

import georinex as gr
import numpy as np
import pytest
import xarray as xr

from tec_core import _rnx_to_frame
from zgiis.processing.rinex3_write import write_rinex3_obs
from zgiis.processing.rinex_converter import _copy_nav, RinexConvertConfig
from zgiis.processing import rinex_download as downloads


def test_rinex3_export_roundtrips_fields_epochs_and_gps_selection(tmp_path):
    times = np.array(["2024-04-01T01:02:03.123456", "2024-04-01T01:02:18.123456"], dtype="datetime64[us]")
    dataset = xr.Dataset({
        key: (("time", "sv"), np.full((2, 2), value))
        for key, value in {"P1": 20000000, "P2": 20000010, "L1": 100000000, "L2": 80000000}.items()
    }, coords={"time": times, "sv": ["G01", "R01"]}, attrs={"position": [1000000, 2000000, 3000000], "time_system": "GPS"})
    path = write_rinex3_obs(dataset, tmp_path / "roundtrip.obs")
    header = path.read_text().split("END OF HEADER")[0]
    assert "TIME OF FIRST OBS" in header
    parsed = gr.load(str(path))
    np.testing.assert_array_equal(parsed.time.values.astype("datetime64[us]"), times)
    np.testing.assert_allclose(parsed["C1P"].values, 20000000)
    frame, used_civilian = _rnx_to_frame(parsed)
    assert len(frame) == 2
    assert set(frame.prn) == {"G01"}
    assert not used_civilian


def test_nav_comment_preserves_ephemeris_body(tmp_path):
    source = tmp_path / "station.18n"
    body = " 1 18 06 22 08 00 00  1.23456789D-04\n"
    source.write_text("".ljust(60) + "END OF HEADER\n" + body)
    out = tmp_path / "converted"
    out.mkdir()
    result = _copy_nav(source, out, RinexConvertConfig(nav_header="Verification comment"))
    text = result.read_text()
    assert text.endswith(body)
    assert "COMMENT" in text.split("END OF HEADER")[0]


def test_archive_dates_and_compressed_year_extensions():
    assert downloads._is_obs_name("14601736.18o.gz")
    assert downloads._is_nav_name("14601736.18n.gz")
    assert downloads._is_nav_name("KARO00ZWE_R_20241140000_01D_MN.rnx.gz")
    assert not downloads._is_obs_name("KARO00ZWE_R_20241140000_01D_MN.rnx.gz")
    assert downloads._matches_day("14601736.18o", date(2018, 6, 22))
    assert downloads._matches_day("KARO00ZWE_S_20241140000_01D_30S_MO.rnx.gz", date(2024, 4, 23))


def test_nav_only_package_is_not_reported_as_observation_download(monkeypatch):
    monkeypatch.setattr(downloads, "find_archive_files", lambda *args, **kwargs: [])
    monkeypatch.setattr(downloads, "download_url_template", lambda: "")
    hit = downloads.RinexFileHit("brdc", date(2024, 4, 1), "", "brdc0920.24n", "nav", "brdc")
    monkeypatch.setattr(downloads, "fetch_brdc_nav", lambda day: (hit, b"navigation only"))
    with pytest.raises(ValueError, match="No RINEX observation files"):
        downloads.build_download_zip(["karo"], date(2024, 4, 1), date(2024, 4, 1))
