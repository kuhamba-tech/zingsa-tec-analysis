"""Scharr and half-window TEC gradients."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from zgiis.maps.tec_gradients import gradient_maps_from_pierce_points, scharr_magnitude
from zgiis.maps.zimbabwe_land import cell_intersects_zimbabwe


def test_scharr_unit_ramp_is_one_tecu_per_degree():
    grid = np.tile(np.arange(7, dtype=float), (7, 1))
    magnitude = scharr_magnitude(grid)
    assert abs(float(magnitude[3, 3]) - 1.0) < 1e-9


def test_scharr_constant_field_is_zero():
    magnitude = scharr_magnitude(np.full((7, 7), 18.0))
    assert abs(float(magnitude[3, 3])) < 1e-9


def test_temporal_gradient_is_half_window_difference_per_minute():
    now = datetime(2026, 10, 28, 7, 30, tzinfo=timezone.utc)
    points = []
    for half, tec in ((14, 10.0), (4, 10.75)):
        stamp = now - timedelta(minutes=half)
        for lat in (-22, -21, -20, -19):
            for lon in (28, 29, 30, 31):
                points.append((stamp, float(lat), float(lon), tec))
    payload = gradient_maps_from_pierce_points(points, now=now)
    assert payload["available"] is True
    assert payload["temporal_available"] is True
    assert payload["spatial_max_tecu_per_deg"] == 0
    values = [cell for row in payload["temporal"] for cell in row if cell is not None]
    assert values
    assert abs(values[0] - 0.1) < 1e-3
    assert payload["temporal_max_tecu_per_min"] == payload["temporal_min_tecu_per_min"]


def test_cells_without_pierce_points_stay_empty():
    now = datetime(2026, 10, 28, 7, 30, tzinfo=timezone.utc)
    points = []
    stamp = now - timedelta(minutes=5)
    for lat in (-22, -21, -20, -19):
        for lon in (28, 29, 30, 31):
            points.append((stamp, float(lat), float(lon), 12.0))
    payload = gradient_maps_from_pierce_points(points, now=now)
    assert payload["available"] is True
    assert payload["temporal_available"] is False
    assert payload["temporal"] is None


def test_gradient_cells_outside_zimbabwe_stay_empty():
    now = datetime(2026, 10, 28, 7, 30, tzinfo=timezone.utc)
    points = []
    stamp = now - timedelta(minutes=5)
    for lat in (-22, -21, -20, -19):
        for lon in (28, 29, 30, 31):
            points.append((stamp, float(lat), float(lon), 12.0))
    for lat in (-14, -13):
        for lon in (28, 29, 30):
            points.append((stamp, float(lat), float(lon), 40.0))
    payload = gradient_maps_from_pierce_points(points, now=now)
    assert payload["available"] is True
    lat0 = payload["lat0"]
    lon0 = payload["lon0"]
    filled = 0
    for i, row in enumerate(payload["spatial"]):
        for j, cell in enumerate(row):
            if cell is None:
                continue
            filled += 1
            assert cell_intersects_zimbabwe(lat0 + i, lon0 + j)
    assert filled > 0
    foreign = [row for i, row in enumerate(payload["spatial"]) if lat0 + i >= -14]
    assert foreign
    for row in foreign:
        assert all(cell is None for cell in row)


def test_every_zimbabwe_cell_is_coloured_from_the_nearest_measured_bin():
    now = datetime(2026, 10, 28, 7, 30, tzinfo=timezone.utc)
    stamp = now - timedelta(minutes=5)
    points = []
    for lat in (-22, -21, -20):
        for lon in (28, 29, 30):
            points.append((stamp, float(lat), float(lon), 12.0))
    payload = gradient_maps_from_pierce_points(points, now=now)
    assert payload["available"] is True
    lat0 = payload["lat0"]
    lon0 = payload["lon0"]
    inside = 0
    missing = 0
    for i, row in enumerate(payload["spatial"]):
        for j, cell in enumerate(row):
            if not cell_intersects_zimbabwe(lat0 + i, lon0 + j):
                continue
            inside += 1
            if cell is None:
                missing += 1
    assert inside > 10
    assert missing == 0


def test_database_failure_is_not_reported_as_no_observations(monkeypatch):
    from datetime import datetime, timezone
    import psycopg2
    import pytest
    import zgiis.db.config as config
    from zgiis.maps.tec_gradients import _query_rows

    monkeypatch.setattr(config, "pooled_database_dsn", lambda: "test-database")

    def offline(*args, **kwargs):
        raise psycopg2.OperationalError("connection timed out")

    monkeypatch.setattr(psycopg2, "connect", offline)
    with pytest.raises(RuntimeError, match="TEC database could not be reached"):
        _query_rows(datetime.now(timezone.utc))


def test_gradient_requests_share_one_nonblocking_build(monkeypatch):
    from concurrent.futures import Future
    import zgiis.maps.tec_gradients as gradients

    future = Future()
    submissions = []

    class Pool:
        def submit(self, fn, **kwargs):
            submissions.append(kwargs)
            return future

    monkeypatch.setattr(gradients, "_build_pool", Pool())
    monkeypatch.setattr(gradients, "_build_job", None)
    monkeypatch.setattr(gradients, "_cache", None)
    first = gradients.build_tec_gradient_maps()
    again = gradients.build_tec_gradient_maps()
    assert not first["available"] and not again["available"]
    assert "background" in first["message"]
    assert len(submissions) == 1
    ready = {"available": True, "spatial": [[1.0]]}
    future.set_result(ready)
    assert gradients.build_tec_gradient_maps() is ready
