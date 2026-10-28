"""Scharr and half-window TEC gradients."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from zgiis.maps.tec_gradients import gradient_maps_from_pierce_points, scharr_magnitude


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
