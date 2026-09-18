"""TEC interpolation grid over Zimbabwe for heat-map rendering."""
from __future__ import annotations

import numpy as np
from typing import Tuple

# Zimbabwe bounding box
ZW_LAT_MIN, ZW_LAT_MAX = -22.5, -15.5
ZW_LON_MIN, ZW_LON_MAX = 25.5, 33.5
GRID_RES = 60  # grid points per axis
MATAMBA_GRID_STEP_DEG = 1.0
MATAMBA_MEDIAN_FILTER_SIZE = 7


def build_grid(res: int = GRID_RES) -> Tuple[np.ndarray, np.ndarray]:
    lats = np.linspace(ZW_LAT_MIN, ZW_LAT_MAX, res)
    lons = np.linspace(ZW_LON_MIN, ZW_LON_MAX, res)
    return np.meshgrid(lons, lats)


def build_degree_grid(step_deg: float = MATAMBA_GRID_STEP_DEG) -> Tuple[np.ndarray, np.ndarray]:
    """Build the 1 degree latitude/longitude grid used by Matamba and Danskin."""
    if step_deg <= 0:
        step_deg = MATAMBA_GRID_STEP_DEG
    lats = np.arange(ZW_LAT_MIN, ZW_LAT_MAX + (step_deg * 0.5), step_deg)
    lons = np.arange(ZW_LON_MIN, ZW_LON_MAX + (step_deg * 0.5), step_deg)
    return np.meshgrid(lons, lats)


def interpolate_tec(
    station_lats: np.ndarray,
    station_lons: np.ndarray,
    station_tec: np.ndarray,
    method: str = "linear",
    *,
    grid_lons: np.ndarray | None = None,
    grid_lats: np.ndarray | None = None,
    median_filter_size: int = 0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Interpolate TEC values onto a regular grid over Zimbabwe.

    Returns (grid_lons, grid_lats, grid_tec).
    Linear interpolation is used when requested and possible; remaining NaN
    cells are filled with nearest-neighbour values so the heat-map overlay
    always covers Zimbabwe.
    """
    from scipy.interpolate import griddata

    if grid_lons is None or grid_lats is None:
        grid_lons, grid_lats = build_grid()
    points = np.column_stack([station_lons, station_lats])
    primary = "linear" if method == "linear" and len(station_tec) >= 3 else "nearest"
    grid_tec = griddata(points, station_tec, (grid_lons, grid_lats), method=primary, fill_value=float("nan"))
    if np.isnan(grid_tec).any():
        nearest = griddata(points, station_tec, (grid_lons, grid_lats), method="nearest")
        grid_tec = np.where(np.isfinite(grid_tec), grid_tec, nearest)
    if median_filter_size and median_filter_size > 1 and np.isfinite(grid_tec).any():
        from scipy.ndimage import median_filter

        grid_tec = median_filter(grid_tec, size=int(median_filter_size), mode="nearest")
    return grid_lons, grid_lats, grid_tec


def interpolate_tec_matamba(
    station_lats: np.ndarray,
    station_lons: np.ndarray,
    station_tec: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Matamba-style NRT TEC gridding: 1 degree nearest-neighbour + 7-cell median filter."""
    grid_lons, grid_lats = build_degree_grid()
    return interpolate_tec(
        station_lats,
        station_lons,
        station_tec,
        method="nearest",
        grid_lons=grid_lons,
        grid_lats=grid_lats,
        median_filter_size=MATAMBA_MEDIAN_FILTER_SIZE,
    )


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
