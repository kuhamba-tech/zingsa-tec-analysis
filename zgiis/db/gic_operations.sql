-- Additive GIC provenance, configuration and receipts. Never seeds measurements.
ALTER TABLE gic_log ADD COLUMN IF NOT EXISTS original_time TEXT;
ALTER TABLE gic_log ADD COLUMN IF NOT EXISTS units TEXT NOT NULL DEFAULT 'A';
ALTER TABLE gic_log ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE gic_log ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE gic_log ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS gic_station_config (
    station_id TEXT PRIMARY KEY,
    configuration JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gic_config_audit (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL,
    configuration JSONB NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gic_ingest_audit (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    received INTEGER NOT NULL,
    inserted INTEGER NOT NULL,
    first_observation TIMESTAMPTZ,
    last_observation TIMESTAMPTZ
);
ALTER TABLE gic_station_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE gic_config_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE gic_ingest_audit ENABLE ROW LEVEL SECURITY;
