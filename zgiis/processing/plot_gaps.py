"""Gap detection helpers for TEC time-series plots."""
from __future__ import annotations

import numpy as np


def gap_break_indices(values, *, xlabel: str) -> np.ndarray:
    """Return indices where a new observation arc should start."""
    x_arr = np.asarray(values)
    if x_arr.size < 2:
        return np.array([], dtype=int)

    diffs = np.diff(x_arr)
    if np.issubdtype(x_arr.dtype, np.datetime64):
        threshold = np.timedelta64(1, "D")
    elif xlabel == "UT (hrs)":
        threshold = 15.0 / 60.0
    else:
        threshold = 1.0

    return np.flatnonzero(diffs > threshold) + 1
