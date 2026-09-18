"""VTEC Theory content API — serves illustrations and equations to the Next.js frontend."""
from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter

router = APIRouter(prefix="/theory", tags=["theory"])


@lru_cache(maxsize=1)
def _understanding_tec_payload():
    from zgiis.processing.understanding_tec_content import build_understanding_tec_payload

    return build_understanding_tec_payload()


@lru_cache(maxsize=1)
def _vtec_theory_payload():
    from zgiis.processing.vtec_theory_content import build_vtec_theory_payload

    return build_vtec_theory_payload()


@lru_cache(maxsize=1)
def _geomagnetic_theory_payload():
    from zgiis.space_weather.geomagnetic_theory_content import build_geomagnetic_theory_payload

    return build_geomagnetic_theory_payload()


@router.get("/vtec")
async def get_vtec_theory():
    """Full VTEC Theory page: steps, inline SVG illustrations, and LaTeX equations."""
    return _vtec_theory_payload()


@router.get("/geomagnetic")
async def get_geomagnetic_theory():
    """Geomagnetic storm metrics theory: Kp, Dst, Ap, F10.7, solar wind, and Zimbabwe impacts."""
    return _geomagnetic_theory_payload()


@router.get("/prn-constellations")
async def get_prn_constellations():
    """Chapter 4 constellation explanations for the PRN Explorer."""
    from zgiis.gnss_prn.constellation_content import build_prn_constellation_payload
    return build_prn_constellation_payload()


@router.get("/understanding-tec")
async def get_understanding_tec():
    """Plain-language guide to Total Electron Content for Zimbabwe CORS users."""
    return _understanding_tec_payload()
