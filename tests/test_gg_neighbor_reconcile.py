"""A station Gg that breaks from its neighbours is retuned; a shared offset is kept."""

from backend.routers.live import _reconcile_gg_with_neighbors
from backend.schemas import TecMethodStationCompare


def _row(code: str, gopi: float, gg: float | None) -> TecMethodStationCompare:
    delta = None if gg is None else round(gg - gopi, 2)
    return TecMethodStationCompare(
        station=code,
        gopi_latest=gopi,
        gg_latest=gg,
        delta_latest=delta,
        gopi_samples=20,
        gg_samples=0 if gg is None else 20,
    )


def test_failed_arc_bias_follows_neighbour_offset():
    stations = [
        _row("kari", 24.0, 18.0),
        _row("cent", 23.0, 17.0),
        _row("gokw", 24.0, 18.0),
        _row("bing", 26.0, 20.0),
        _row("karo", 25.0, 0.4),
        _row("muto", 24.0, None),
    ]
    _reconcile_gg_with_neighbors(stations)
    by = {row.station: row for row in stations}
    assert by["kari"].gg_latest == 18.0
    assert by["karo"].gg_latest == 19.0
    assert by["karo"].delta_latest == -6.0
    assert by["muto"].gg_latest == 18.0
