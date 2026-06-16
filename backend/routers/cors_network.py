from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import CorsHealthOut, StationOut

router = APIRouter(prefix="/cors", tags=["cors"])


def _stations() -> list:
    from zgiis.cors.stations import stations_for_map
    return stations_for_map()


@router.get("/stations", response_model=list[StationOut])
async def stations(_=Depends(require_api_key)):
    return [
        StationOut(
            code=s.code,
            name=s.name,
            lat=s.lat,
            lon=s.lon,
            status=s.status,
            constellations=list(s.constellations) if s.constellations else [],
            current_tec=s.current_tec,
            height_m=getattr(s, "height_m", None),
        )
        for s in _stations()
    ]


@router.get("/stations/{code}", response_model=StationOut)
async def station_detail(code: str, _=Depends(require_api_key)):
    match = next((s for s in _stations() if s.code == code.lower()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Station '{code}' not found")
    return StationOut(
        code=match.code,
        name=match.name,
        lat=match.lat,
        lon=match.lon,
        status=match.status,
        constellations=list(match.constellations) if match.constellations else [],
        current_tec=match.current_tec,
        height_m=getattr(match, "height_m", None),
    )


@router.get("/health", response_model=CorsHealthOut)
async def health(_=Depends(require_api_key)):
    all_s = _stations()
    online = sum(1 for s in all_s if s.status == "online")
    degraded = sum(1 for s in all_s if s.status == "degraded")
    offline = sum(1 for s in all_s if s.status == "offline")
    return CorsHealthOut(online=online, degraded=degraded, offline=offline, total=len(all_s))
