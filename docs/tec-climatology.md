# TEC Climatology & Regional Analysis

Local page: http://127.0.0.1:3100/tec-climatology/

Entry points: the existing home page Analysis Modules cards and sidebar.
The operational dashboard, existing maps and station assignments are preserved.

## Regional definition

The operator selected the existing fixed map bands, rather than the older
North–South research module's operational-station tertiles:

- North: latitude > −18.2°.
- Central: −20.2° < latitude ≤ −18.2°.
- South: latitude ≤ −20.2°.

The backend imports `zimbabwe_lat_band` from the existing research implementation;
its fixed thresholds match `frontend/lib/zimbabweLatBands.ts`. Coordinates come
from `zgiis/cors/stations.py`. Tests cover the boundary equality cases.

## Data and capture

The existing `vtec_obs` table remains the observation archive. Its live
`code_live` measurements are now excluded from retention cleanup. Historical
rows are preserved, including rows preceding the metadata migration. Analysis
deduplicates their timestamp/station/constellation/satellite/method identities.
New writes have a unique `(time, observation_id)` key and UTC storage timestamps.

Additive columns: `observation_id`, `stored_at`, `received_at`,
`station_latitude`, `station_longitude`, `ipp_latitude`, `ipp_longitude`,
`region`, `quality_flag`, `processing_version`, `data_source`.
`received_at` means the time a valid computed VTEC measurement entered the
capture pipeline. IPP fields remain null when the producer does not supply them.
Historical received/stored times are not fabricated. The quality label denotes
existing pipeline checks, not independent scientific validation or DCB correction.

The dedicated collector journals each valid measurement to
`static/data/tec_capture_outbox.sqlite`, table `pending`, before batch storage.
SQLite FULL synchronous WAL journaling survives ordinary process restarts.
After a successful archive write, the journal entries are acknowledged. A crash
between commit and acknowledgement replays safely through the unique key.
Failed writes remain queued. Keep this file and the main database on persistent
storage; a browser and Vercel function are not substitutes for the collector.

The new page does not start ingestion. Closing it leaves the collector running.
Automatic restart after a Windows reboot is not installed by this change.

## Statistics

Only real `code_live` measurements with 0 < VTEC < 200 TECU enter research.
Forecasts, archive imports and map interpolation are excluded. Satellites are
averaged within each station/time bin. Station summaries are then combined with
equal station weights. Regional medians and boxes describe station summaries,
not pooled satellite samples. Completeness is occupied station/time bins divided
by expected bins for all selected stations across the entire selected range.
This is bin coverage, not a claim about receiver epoch completeness.

CAT grouping shifts UTC by two hours before assigning dates/hours/seasons.
December seasons are labelled with their January year. Future dates and missing
months remain missing. Configurable seasons must partition all twelve months.
Day/night means 06:00–18:00 versus 18:00–06:00 in the selected clock zone.

Regional differences use matching time bins. Latitude scatter uses bins shared
by all contributing stations. Pairwise gradients use stations within 1° longitude
and at least 0.15° latitude apart; great-circle separation is reported alongside
TECU/100 km. This is an along-baseline estimate, not an exact meridional gradient.

Geomagnetic latitude uses IGRF-14 degree-one centered-dipole coefficients and
2025–2030 secular variation at the displayed midpoint epoch, after converting
ground geodetic latitude to geocentric latitude. It is not apex/quasi-dipole
latitude. Outside model validity it is unavailable. Source:
https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt

## Files

- `zgiis/processing/tec_climatology.py`: aggregation, coverage, regions, seasonal
  year handling, magnetic coordinates and matched comparisons.
- `backend/routers/live.py`: authenticated `/live/tec-climatology` endpoint.
- `zgiis/db/timescale.py`: additive metadata, idempotent writes, retained history.
- `zgiis/db/migrations/tec_research_capture.sql`: explicit PostgreSQL migration.
- `zgiis/live/stec_vtec.py`: capture metadata, locked pending batches and retries.
- `zgiis/live/tec_outbox.py`: durable collector pending journal.
- `scripts/live_ntrip_collector.py`: journal replay and capture wiring.
- `zgiis/live/ntrip_stream.py`: real RTCM text rejection decoding and shared
  connection-limit cooldown, discovered during capture validation.
- `frontend/app/tec-climatology/page.tsx`, `ResearchExtras.tsx`, `GraphExports.tsx`:
  controls, four analysis tabs, charts, map, tables and graph export.
- `frontend/app/tec-climatology/page.module.css`: page-scoped presentation.
- `frontend/lib/tecClimatology.ts`, `frontend/lib/api.ts`: API types and client.
- `frontend/app/page.tsx`, `frontend/components/layout/AppShell.tsx`: navigation.
- `tests/test_tec_climatology.py`, `tests/test_tec_research_storage.py`,
  `tests/test_ntrip_stream_transport.py`: scientific, storage and transport tests.

## Deployment and limits

No production deployment or production database migration has been performed.
Apply the PostgreSQL migration before deploying the updated writer to a hosted
database. Keep the collector on a persistent worker with durable outbox storage.
Review any database-side retention policies before using it for climatology.
Local `.env` uses four concurrent streams: twenty caused account-limit responses.

Verified historical geomagnetic indices are not yet linked: quiet/disturbed
filtering is deliberately disabled. IPP-based research is unavailable until the
producer provides IPPs. Station plots use the existing approximate Zimbabwe
outline, not a new surveyed administrative boundary. Core plot CSV exports carry
coverage and source metadata; station and matched-comparison tables have separate
exports. Continuous accumulation can fill future months, not recover previously
deleted history.

Final local verification: 20 targeted tests passed (scientific calculations,
storage/outbox replay, collector and transport); TypeScript checking passed.
All four tabs were opened in the browser without reported JavaScript errors.
The frontend proxy returned 74,149 deduplicated observations from 15 stations for
22–23 September 2026. An empty 2025 range returned zero observations, and a full
2026 range retained missing months rather than filling them.

Fresh browser-independent capture could not be verified in this session: the
caster explicitly replied `Too many concurrent connections.` The collector
now decodes that actual RTCM text and shares a cooldown across waiting stations.
The page reports stale capture. Account capacity/other sessions must be resolved
before fresh storage can be claimed. Existing archived research remains usable.
