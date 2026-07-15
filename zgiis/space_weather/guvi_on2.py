from __future__ import annotations

from datetime import date, datetime, timezone


SOURCE_URL = "http://guvitimed.jhuapl.edu/guvi-galleryl3on2"
MISSION_URL = "http://guvitimed.jhuapl.edu/"

REFERENCE_OVERPASSES = [
    {
        "date": "2021-11-03",
        "overpass_ut": "07:56",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
    {
        "date": "2021-11-04",
        "overpass_ut": "07:46",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
    {
        "date": "2021-11-05",
        "overpass_ut": "07:36",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
]


def _parse_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def build_guvi_on2_payload(start: str | None = None, end: str | None = None) -> dict:
    """Return TIMED/GUVI O/N2 context for the time-series space segment.

    The repo currently has overpass metadata, not the downloaded Level-3 O/N2
    image grids. Ratio values remain null until a grid/csv importer is wired in.
    """

    start_d = _parse_day(start)
    end_d = _parse_day(end)
    rows = []
    for row in REFERENCE_OVERPASSES:
        row_d = date.fromisoformat(row["date"])
        if start_d and row_d < start_d:
            continue
        if end_d and row_d > end_d:
            continue
        rows.append(dict(row))

    return {
        "source": "TIMED/GUVI Level-3 O/N2 gallery",
        "source_url": SOURCE_URL,
        "mission_url": MISSION_URL,
        "instrument": "Thermosphere Ionosphere Mesosphere Energetics and Dynamics / Global Ultraviolet Imager",
        "altitude_range_km": [60, 180],
        "region": "Africa",
        "status": "metadata_only",
        "message": (
            "Historical TIMED/GUVI O/N2 overpass context is available. "
            "Measured O/N2 ratios require importing the downloaded Level-3 map grids."
        ),
        "series": rows,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
