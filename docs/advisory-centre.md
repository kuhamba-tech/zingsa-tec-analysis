# ZINGSA Space Weather Advisory Centre

## Purpose

Operational advisory product that separates:

1. **Global geomagnetic storm severity** (observed Kp → NOAA G-scale, Dst context)
2. **Zimbabwe GNSS reliability** (measured VTEC / S4 / provisional risk label)
3. **Solar-wind / IMF watch** screening (never storm confirmation by itself)
4. **Forecast vs observed** wording

Route: `/space-weather/advisory-centre/`

## Classification (preliminary, configurable)

| Level | Meaning |
| --- | --- |
| GREEN | No significant geomagnetic or confirmed local GNSS disturbance |
| YELLOW | Elevated solar-wind/IMF/solar watch; not a confirmed storm from wind alone |
| ORANGE | Observed G1–G2 and/or significant local GNSS disturbance warning |
| RED | Observed G3+ and/or severe validated local GNSS disruption |

**Hard rules**

- Solar wind > 500 km/s alone → at most YELLOW (never ORANGE/RED).
- G1/G2 are not “severe”.
- Local GNSS disturbance must not be mislabelled as a global geomagnetic storm.
- Missing data is disclosed; it is never treated as quiet.

Thresholds live in `zgiis/space_weather/advisory_centre_config.py` and are returned with each assessment for transparency.

## Reuse

- Live indices: existing `get_space_weather` + solar activity feeds
- Alerts Centre / Early Warning remain the multi-rule alert engine
- Navigation News remains audience packaging for GNSS users
- This centre is the national colour-scale advisory product + archive/approval layer

## API

- `GET /space-weather/advisory-centre?persist=`
- `GET /space-weather/advisory-centre/history`
- `GET /space-weather/advisory-centre/latest-published`
- `POST /space-weather/advisory-centre/approve|publish|withdraw` (admin key)

## Publication workflow

1. Live assessment (draft)
2. Optional `persist=true` / Save draft → `space_weather_advisory_log`
3. Scientific approve (`X-Broadcast-Admin-Key`)
4. Publish
5. Withdraw if corrected

WhatsApp/Facebook buttons open share links; they do not claim delivery unless a broadcast API confirms it.

## Limitations

- Regional North/Central/South TEC tiles and ROTI proxies are not yet fused into this product (reuse existing TEC modules next).
- PDF export uses `downloadAdvisoryCentrePdf` in `frontend/lib/reportPdf.ts` (plus TXT download).
- Thresholds require historical validation before national public-warning reliance.
- Role-based reviewer accounts are keyed by shared admin secret for now.
