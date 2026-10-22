# Vercel live-data diagnosis (26 September 2026)

Verified production responses:

- GET `/api/cors-router/?__zr=%2Fcors%2Fstations`: HTTP 200, all 25 stations unknown, TEC null.
- POST `/api/cors-router/?__zr=%2Fcors%2Fstatus%2Fsnapshots` with invalid empty object (no observations written): HTTP 503, `API write protection is not configured`.
- Local collector saves actual NTRIP measurements to local SQLite. Vercel cannot read that file.

## Required production repair

Configure the same durable PostgreSQL database for the persistent collector and Vercel using `SUPABASE_DATABASE_URL` (or another existing supported database setting). Apply the existing TEC and station-status schema/migrations before switching the collector. Preserve local SQLite history; do not delete or replace it. Confirm both runtimes actually connect to PostgreSQL rather than silently falling back to SQLite.

The collector already writes station snapshots and VTEC to its database. A shared database is the preferred path; uploading station status alone cannot supply TEC. Vercel must read the shared database while collection continues on the always-on host.

If using HTTP station-status uploads as well, configure server-side `API_KEY` in Vercel and matching `STATUS_SNAPSHOT_PUSH_API_KEY` on the collector. The collector now also accepts its server-side `API_KEY`. Existing read endpoints require the API key when configured, so configure the existing server-side frontend proxy consistently; do not expose a write-capable secret as a NEXT_PUBLIC variable.

Production environment changes need a new deployment. No deployment was made during this diagnosis. Project access is currently unavailable through the connected Vercel account (no teams returned; project lookup also encounters connector schema validation errors).

## Acceptance checks

1. Collector and Vercel report the same PostgreSQL destination (verify without printing credentials).
2. Two successive database checks show increasing observation timestamps.
3. Vercel returns genuine online/offline station states with current snapshot timestamps.
4. Vercel TEC observations match the stored observation timestamps and freshness rules.
5. A fresh serverless instance retains access to the same records.

Do not fabricate station status, use bundled historical TEC as live data, disable write protection, or deploy a local SQLite file as a production data feed.
