from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from backend.deps import require_api_key

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/pdf")
async def generate_pdf(
    station: str = "N/A",
    period: str = "N/A",
    _=Depends(require_api_key),
):
    try:
        from zgiis.reports.pdf_report import generate_report
        from zgiis.space_weather.fetch_indices import get_space_weather
        sw = get_space_weather()
        pdf_bytes = generate_report(station=station, period=period,
                                    daily_df=None, monthly_df=None, sw_info=sw)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="zgiis_{station}_{period}.pdf"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
