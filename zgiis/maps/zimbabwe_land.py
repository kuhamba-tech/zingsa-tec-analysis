"""Zimbabwe outline used to keep TEC gradient cells inside the country.

The ring matches ``frontend/lib/zimbabweBoundary.ts`` ``ZIMBABWE_LAND``
(Natural Earth 110m). Lusaka, Francistown, Musina, and Chimoio stay outside.
"""
from __future__ import annotations

ZIMBABWE_LAND: tuple[tuple[float, float], ...] = (
    (31.19141, -22.25151),
    (30.65987, -22.15157),
    (30.32288, -22.27161),
    (29.83904, -22.10222),
    (29.43219, -22.09131),
    (28.79466, -21.63945),
    (28.02137, -21.48598),
    (27.72723, -20.8518),
    (27.72475, -20.49906),
    (27.29651, -20.39152),
    (26.16479, -19.29309),
    (25.85039, -18.71441),
    (25.64916, -18.53603),
    (25.26423, -17.73654),
    (26.38194, -17.84604),
    (26.70677, -17.96123),
    (27.04443, -17.93803),
    (27.59824, -17.29083),
    (28.46791, -16.4684),
    (28.82587, -16.38975),
    (28.94746, -16.04305),
    (29.51683, -15.64468),
    (30.27426, -15.50779),
    (30.33896, -15.88084),
    (31.17306, -15.86094),
    (31.6365, -16.07199),
    (31.85204, -16.31942),
    (32.32824, -16.39207),
    (32.84764, -16.7134),
    (32.84986, -17.97906),
    (32.65489, -18.67209),
    (32.61199, -19.41938),
    (32.77271, -19.71559),
    (32.65974, -20.30429),
    (32.50869, -20.39529),
    (32.24499, -21.11649),
)


def _contains(lon: float, lat: float) -> bool:
    ring = ZIMBABWE_LAND
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _segments_cross(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> bool:
    def orient(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    o1 = orient(a, b, c)
    o2 = orient(a, b, d)
    o3 = orient(c, d, a)
    o4 = orient(c, d, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def cell_intersects_zimbabwe(lat_south: float, lon_west: float, step: float = 1.0) -> bool:
    """True when the cell meets the Zimbabwe outline."""
    lat_north = lat_south + step
    lon_east = lon_west + step
    for dy in (0.2, 0.5, 0.8):
        for dx in (0.2, 0.5, 0.8):
            if _contains(lon_west + dx * step, lat_south + dy * step):
                return True
    for lon, lat in ZIMBABWE_LAND:
        if lon_west <= lon <= lon_east and lat_south <= lat <= lat_north:
            return True
    rect = (
        (lon_west, lat_south),
        (lon_east, lat_south),
        (lon_east, lat_north),
        (lon_west, lat_north),
    )
    ring = ZIMBABWE_LAND
    for i in range(len(ring)):
        a = ring[i]
        b = ring[(i + 1) % len(ring)]
        for j in range(4):
            if _segments_cross(a, b, rect[j], rect[(j + 1) % 4]):
                return True
    return False
