"""Load the packaged historical TEC archive index."""
from __future__ import annotations

from pathlib import Path

import pandas as pd


ARCHIVE_INDEX_PATH = (
    Path(__file__).resolve().parents[2]
    / "static"
    / "data"
    / "tec_archive_hourly.csv"
)


def load_historical_tec() -> tuple[pd.DataFrame, dict]:
    """Return real hourly CMN-derived TEC observations and their provenance."""
    if not ARCHIVE_INDEX_PATH.exists():
        return pd.DataFrame(), {
            "source": "CMN archive index",
            "path": str(ARCHIVE_INDEX_PATH),
            "available": False,
        }

    frame = pd.read_csv(ARCHIVE_INDEX_PATH, parse_dates=["timestamp", "date"])
    required = {"timestamp", "date", "station", "vtec"}
    if frame.empty or not required.issubset(frame.columns):
        return pd.DataFrame(), {
            "source": "CMN archive index",
            "path": str(ARCHIVE_INDEX_PATH),
            "available": False,
        }

    frame["station"] = frame["station"].astype(str).str.lower()
    frame["constellation"] = frame.get("constellation", "GPS")
    frame["prn"] = frame.get("prn", "ALL")
    metadata = {
        "source": "Processed Zimbabwe CORS CMN observations",
        "path": str(ARCHIVE_INDEX_PATH),
        "available": True,
        "stations": sorted(frame["station"].dropna().unique().tolist()),
        "first_date": frame["date"].min(),
        "last_date": frame["date"].max(),
        "observations": int(frame.get("observations", pd.Series(dtype=int)).sum()),
        "source_files": int(
            frame.get("source_file", pd.Series(dtype=str)).nunique()
        ),
    }
    return frame, metadata
