from datetime import date

import numpy as np
from netCDF4 import Dataset

from zgiis.space_weather.guvi_on2 import fetch_guvi_on2_payload, read_guvi_netcdf


def test_reader_uses_coordinates_and_valid_point_counts():
    dataset = Dataset("test-guvi", "w", memory=1024)
    dataset.createDimension("orbit", 1)
    dataset.createDimension("point", 5)
    for name, values in {
        "lat": [-18, -19, -18, 45, -18],
        "lon": [30, 390, 30, 30, 30],
        "on2": [0.6, 0.8, -999, 2, 100],
        "ut": [6, 8, 7, 6, 8],
    }.items():
        dataset.createVariable(name, "f8", ("orbit", "point"))[:] = np.array([values])
    dataset.createVariable("points", "i4", ("orbit",))[:] = [4]
    raw = bytes(dataset.close())
    row = read_guvi_netcdf(raw, date(2004, 4, 1))
    assert row["ratio"] == 0.7
    assert row["overpass_ut"] == "07:00"
    assert "2 valid orbit samples" in row["note"]


def test_later_dates_do_not_masquerade_as_measured_data():
    payload = fetch_guvi_on2_payload("2021-11-03", "2021-11-03")
    assert payload["status"] == "metadata_only"
    assert payload["series"][0]["ratio"] is None
    assert "2002–2007" in payload["message"]
