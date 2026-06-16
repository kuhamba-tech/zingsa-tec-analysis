-- TimescaleDB schema for ZGIIS live VTEC pipeline
-- Run this once against your TimescaleDB (PostgreSQL) instance:
--   psql -h <host> -U <user> -d <db> -f schema.sql

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── VTEC / STEC observations ─────────────────────────────────────────────────
-- One row per epoch × station × PRN from the live NTRIP stream.
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TIMESTAMPTZ      NOT NULL,
    station        TEXT             NOT NULL,   -- 4-char CORS ID (e.g. 'zinh')
    constellation  TEXT             NOT NULL,   -- GPS | GLONASS | Galileo | BeiDou
    prn            TEXT             NOT NULL,   -- G01, R05, E12, C23 …
    stec_tecu      DOUBLE PRECISION,            -- Slant TEC (TECU)
    vtec_tecu      DOUBLE PRECISION,            -- Vertical TEC after M(E) mapping
    elevation_deg  DOUBLE PRECISION,            -- Satellite elevation (degrees)
    cnr_dbhz       DOUBLE PRECISION             -- Carrier-to-noise ratio (dB-Hz)
);

-- Convert to hypertable (7-day chunks)
SELECT create_hypertable('vtec_obs', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

-- Indices
CREATE INDEX IF NOT EXISTS vtec_obs_station_time ON vtec_obs (station, time DESC);
CREATE INDEX IF NOT EXISTS vtec_obs_prn_time     ON vtec_obs (prn,     time DESC);

-- Continuous aggregate: 15-min mean VTEC per station (for CNN-GRU input)
CREATE MATERIALIZED VIEW IF NOT EXISTS vtec_15min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS bucket,
    station,
    constellation,
    AVG(vtec_tecu)      AS mean_vtec,
    MAX(vtec_tecu)      AS max_vtec,
    AVG(elevation_deg)  AS mean_elev,
    COUNT(*)            AS n_obs
FROM vtec_obs
GROUP BY bucket, station, constellation
WITH NO DATA;

SELECT add_continuous_aggregate_policy('vtec_15min',
    start_offset  => INTERVAL '2 days',
    end_offset    => INTERVAL '1 minute',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);

-- ── RTK monitoring ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rtk_quality (
    time           TIMESTAMPTZ NOT NULL,
    station        TEXT        NOT NULL,
    latency_ms     REAL,
    msg_rate_hz    REAL,
    quality        TEXT        -- Good | Degraded | Poor | Offline
);

SELECT create_hypertable('rtk_quality', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists       => TRUE
);

-- ── CNN-GRU forecast results ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vtec_forecast (
    issued_at      TIMESTAMPTZ NOT NULL,    -- when the forecast was made
    valid_at       TIMESTAMPTZ NOT NULL,    -- epoch the forecast is for
    station        TEXT,                   -- NULL = network-wide
    vtec_forecast  DOUBLE PRECISION,
    model_version  TEXT
);

SELECT create_hypertable('vtec_forecast', 'valid_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

-- ── Space weather dashboard archive ───────────────────────────────────────────
-- One row per dashboard sample (Kp, Dst, F10.7, wind, S4, GNSS risk, CORS).
CREATE TABLE IF NOT EXISTS space_weather_log (
    time              TIMESTAMPTZ      NOT NULL,
    kp                DOUBLE PRECISION,
    kp_condition      TEXT,
    dst               DOUBLE PRECISION,
    f107              DOUBLE PRECISION,
    plasma_speed      DOUBLE PRECISION,
    s4                DOUBLE PRECISION,
    gnss_risk         TEXT,
    gnss_risk_score   DOUBLE PRECISION,
    stations_online   INTEGER,
    stations_total    INTEGER,
    mean_vtec         DOUBLE PRECISION,
    source            TEXT
);

SELECT create_hypertable('space_weather_log', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

CREATE INDEX IF NOT EXISTS sw_log_time_idx ON space_weather_log (time DESC);

-- ── CORS station status archive ───────────────────────────────────────────────
-- Transitions (online / degraded / offline / unknown) and periodic snapshots.
CREATE TABLE IF NOT EXISTS station_status_events (
    time              TIMESTAMPTZ      NOT NULL,
    station_code      TEXT,
    status            TEXT             NOT NULL,
    previous_status   TEXT,
    event_type        TEXT             NOT NULL,
    online_count      INTEGER,
    degraded_count    INTEGER,
    offline_count     INTEGER,
    unknown_count     INTEGER,
    api_reachable     BOOLEAN          NOT NULL DEFAULT TRUE,
    message           TEXT,
    source            TEXT
);

SELECT create_hypertable('station_status_events', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

CREATE TABLE IF NOT EXISTS station_status_snapshots (
    time              TIMESTAMPTZ      NOT NULL,
    station_code      TEXT             NOT NULL,
    status            TEXT             NOT NULL,
    api_reachable     BOOLEAN          NOT NULL DEFAULT TRUE,
    source            TEXT
);

SELECT create_hypertable('station_status_snapshots', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

CREATE INDEX IF NOT EXISTS st_status_events_time_idx
    ON station_status_events (time DESC);
CREATE INDEX IF NOT EXISTS st_status_events_code_time_idx
    ON station_status_events (station_code, time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_time_idx
    ON station_status_snapshots (time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_code_time_idx
    ON station_status_snapshots (station_code, time DESC);
