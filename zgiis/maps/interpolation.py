"""TEC interpolation grid over Zimbabwe for heat-map rendering."""
from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Tuple

# Zimbabwe bounding box
ZW_LAT_MIN, ZW_LAT_MAX = -22.5, -15.5
ZW_LON_MIN, ZW_LON_MAX = 25.5, 33.5
GRID_RES = 60  # grid points per axis


def build_grid(res: int = GRID_RES) -> Tuple[np.ndarray, np.ndarray]:
    lats = np.linspace(ZW_LAT_MIN, ZW_LAT_MAX, res)
    lons = np.linspace(ZW_LON_MIN, ZW_LON_MAX, res)
    return np.meshgrid(lons, lats)


def interpolate_tec(
    station_lats: np.ndarray,
    station_lons: np.ndarray,
    station_tec: np.ndarray,
    method: str = "linear",
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Interpolate TEC values onto a regular grid over Zimbabwe.

    Returns (grid_lons, grid_lats, grid_tec).
    Falls back to nearest-neighbour if scipy is not available.
    """
    from scipy.interpolate import griddata

    grid_lons, grid_lats = build_grid()
    points = np.column_stack([station_lons, station_lats])
    grid_tec = griddata(points, station_tec, (grid_lons, grid_lats), method=method, fill_value=float("nan"))
    return grid_lons, grid_lats, grid_tec


def make_plotly_heatmap_trace(grid_lons, grid_lats, grid_tec):
    """Return a dict usable as a Plotly densitymapbox or heatmap trace."""
    import plotly.graph_objects as go

    flat_lons = grid_lons.ravel()
    flat_lats = grid_lats.ravel()
    flat_tec = grid_tec.ravel()
    mask = ~np.isnan(flat_tec)

    return go.Densitymapbox(
        lat=flat_lats[mask].tolist(),
        lon=flat_lons[mask].tolist(),
        z=flat_tec[mask].tolist(),
        radius=25,
        colorscale=[
            [0.0,  "#000080"],
            [0.25, "#0080ff"],
            [0.5,  "#00ff80"],
            [0.75, "#ff8000"],
            [1.0,  "#ff0000"],
        ],
        colorbar=dict(title="VTEC (TECU)"),
        name="TEC",
        showscale=True,
        opacity=0.7,
        hovertemplate="Lat: %{lat:.2f}<br>Lon: %{lon:.2f}<br>VTEC: %{z:.1f} TECU<extra></extra>",
    )
