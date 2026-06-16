"""VTEC Theory content API — serves illustrations and equations to the Next.js frontend."""
from __future__ import annotations

from fastapi import APIRouter

from zgiis.processing.vtec_theory_content import build_vtec_theory_payload

router = APIRouter(prefix="/theory", tags=["theory"])


@router.get("/vtec")
async def get_vtec_theory():
    """Full VTEC Theory page: steps, inline SVG illustrations, and LaTeX equations."""
    return build_vtec_theory_payload()
