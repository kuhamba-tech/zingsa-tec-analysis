"""Identity of a measured GOPI observation.

GOPI code TEC, the Gg calibration, the DLR reference grid and map
interpolation answer different questions. Only GOPI code-live rows may enter
a measured-TEC climatology or day-night profile. A method name that merely
contains ``code_live`` is not enough: an interpolated or modelled series must
not pass by sharing that fragment.
"""
from __future__ import annotations

from zgiis.processing.elevation_mask import ELEVATION_MIN_DEG

# Stored method written by the live NTRIP code-TEC path.
GOPI_CODE_LIVE_METHOD = "gopi_eq_4_11_code_live"
VTEC_MIN_EXCLUSIVE = 0.0
VTEC_MAX_EXCLUSIVE = 200.0


def is_measured_gopi(method: object, data_source: object = None) -> bool:
    """True for absolute GOPI code-live measurements only."""
    text = str(method or "").strip().lower()
    source = str(data_source or "").strip().lower()
    if not text.startswith("gopi_") or "code_live" not in text:
        return False
    if text.startswith("dlr_"):
        return False
    blob = f"{text} {source}"
    if "interpol" in blob or "model" in blob or blob.startswith("gg_") or " gg_" in f" {blob}":
        return False
    return True


def measured_gopi_clause(marker: str, *, elevation: bool) -> tuple[str, list[str]]:
    """SQL fragment and bind values. ``marker`` is ``%s`` or ``?``."""
    clause = (
        f"tec_method LIKE {marker} "
        f"AND tec_method NOT LIKE {marker} "
        f"AND LOWER(tec_method) NOT LIKE {marker} "
        f"AND LOWER(COALESCE(data_source, '')) NOT LIKE {marker} "
        f"AND vtec_tecu > {VTEC_MIN_EXCLUSIVE:g} "
        f"AND vtec_tecu < {VTEC_MAX_EXCLUSIVE:g}"
    )
    if elevation:
        clause += f" AND elevation_deg >= {ELEVATION_MIN_DEG:g}"
    params = ["gopi_%code_live%", "dlr_%", "%interpol%", "%model%"]
    return clause, params
