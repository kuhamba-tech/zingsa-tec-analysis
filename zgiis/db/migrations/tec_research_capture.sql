-- Apply explicitly to the existing PostgreSQL database before deploying.
-- No production deployment or migration is performed by local development.
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS observation_id TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS stored_at TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS received_at TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS station_latitude DOUBLE PRECISION;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS station_longitude DOUBLE PRECISION;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS ipp_latitude DOUBLE PRECISION;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS ipp_longitude DOUBLE PRECISION;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS quality_flag TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS processing_version TEXT;
ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS data_source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vtec_obs_identity ON vtec_obs (time, observation_id);
-- Existing rows keep NULL IDs, so no historical rows are deleted.
