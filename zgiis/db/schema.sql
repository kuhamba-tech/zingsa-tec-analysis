-- Supabase/PostgreSQL schema for the ZGIIS live operations database.
-- Run this once in the Supabase SQL editor or with psql:
--   psql "$SUPABASE_DATABASE_URL" -f zgiis/db/schema.sql
--
-- The application also creates these tables on startup when a hosted
-- Postgres URL is configured. This file is useful for explicit bootstrapping.

-- VTEC / STEC observations
-- One row per epoch, station, and PRN from the live NTRIP stream.
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TIMESTAMPTZ      NOT NULL,
    station        TEXT             NOT NULL,
    constellation  TEXT             NOT NULL,
    prn            TEXT             NOT NULL,
    tecg_tecu      DOUBLE PRECISION,
    tecp_tecu      DOUBLE PRECISION,
    stec_tecu      DOUBLE PRECISION,
    vtec_tecu      DOUBLE PRECISION,
    elevation_deg  DOUBLE PRECISION,
    cnr_dbhz       DOUBLE PRECISION,
    tec_method     TEXT,
    bias_method    TEXT
);

CREATE INDEX IF NOT EXISTS vtec_obs_station_time ON vtec_obs (station, time DESC);
CREATE INDEX IF NOT EXISTS vtec_obs_prn_time ON vtec_obs (prn, time DESC);
CREATE INDEX IF NOT EXISTS vtec_obs_time_idx ON vtec_obs (time DESC);

-- Standard Postgres materialized view for 15-minute VTEC summaries.
-- Refresh manually or from a scheduled job if you need this aggregate.
CREATE MATERIALIZED VIEW IF NOT EXISTS vtec_15min AS
SELECT
    date_bin(INTERVAL '15 minutes', time, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
    station,
    constellation,
    AVG(vtec_tecu) AS mean_vtec,
    MAX(vtec_tecu) AS max_vtec,
    AVG(elevation_deg) AS mean_elev,
    COUNT(*) AS n_obs
FROM vtec_obs
GROUP BY bucket, station, constellation
WITH NO DATA;

CREATE INDEX IF NOT EXISTS vtec_15min_station_bucket
    ON vtec_15min (station, bucket DESC);

-- RTK monitoring
CREATE TABLE IF NOT EXISTS rtk_quality (
    time           TIMESTAMPTZ NOT NULL,
    station        TEXT        NOT NULL,
    latency_ms     REAL,
    msg_rate_hz    REAL,
    quality        TEXT
);

CREATE INDEX IF NOT EXISTS rtk_quality_station_time
    ON rtk_quality (station, time DESC);

-- CNN-GRU forecast results
CREATE TABLE IF NOT EXISTS vtec_forecast (
    issued_at      TIMESTAMPTZ NOT NULL,
    valid_at       TIMESTAMPTZ NOT NULL,
    station        TEXT,
    vtec_forecast  DOUBLE PRECISION,
    model_version  TEXT
);

CREATE INDEX IF NOT EXISTS vtec_forecast_station_valid
    ON vtec_forecast (station, valid_at DESC);
CREATE INDEX IF NOT EXISTS vtec_forecast_valid_idx
    ON vtec_forecast (valid_at DESC);

-- Space weather dashboard archive
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

CREATE INDEX IF NOT EXISTS sw_log_time_idx ON space_weather_log (time DESC);

-- CORS station status archive
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

CREATE TABLE IF NOT EXISTS station_status_snapshots (
    time              TIMESTAMPTZ      NOT NULL,
    station_code      TEXT             NOT NULL,
    status            TEXT             NOT NULL,
    api_reachable     BOOLEAN          NOT NULL DEFAULT TRUE,
    source            TEXT
);

CREATE INDEX IF NOT EXISTS st_status_events_time_idx
    ON station_status_events (time DESC);
CREATE INDEX IF NOT EXISTS st_status_events_code_time_idx
    ON station_status_events (station_code, time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_time_idx
    ON station_status_snapshots (time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_code_time_idx
    ON station_status_snapshots (station_code, time DESC);

-- EKF deviation alerts
CREATE TABLE IF NOT EXISTS ekf_alert_log (
    alert_id            TEXT PRIMARY KEY,
    time                TIMESTAMPTZ NOT NULL,
    parameter           TEXT,
    parameter_label     TEXT,
    observed_value      DOUBLE PRECISION,
    ekf_predicted_value DOUBLE PRECISION,
    prediction_error    DOUBLE PRECISION,
    threshold           DOUBLE PRECISION,
    severity            TEXT,
    related_indicators  TEXT,
    alert_message       TEXT,
    acknowledged_status BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ekf_alert_time_idx ON ekf_alert_log (time DESC);

-- COSMIC-2 Zimbabwe research module (Phase 1) — profile summaries, CORS
-- matches, and calibration runs only. Raw electron-density sample arrays
-- stay on disk (static/data/cosmic2_cache/); see zgiis/db/cosmic2_db.py.
CREATE TABLE IF NOT EXISTS cosmic2_profiles (
    profile_id              TEXT NOT NULL,
    day                     DATE NOT NULL,
    occ_time                TIMESTAMPTZ,
    tangent_lat             DOUBLE PRECISION,
    tangent_lon             DOUBLE PRECISION,
    source_file             TEXT,
    quality_status          TEXT NOT NULL,
    quality_reasons         TEXT,
    valid_sample_count      INTEGER,
    nmf2_el_m3              DOUBLE PRECISION,
    hmf2_km                 DOUBLE PRECISION,
    fof2_mhz                DOUBLE PRECISION,
    partial_tec_tecu        DOUBLE PRECISION,
    tec_integration_min_km  DOUBLE PRECISION,
    tec_integration_max_km  DOUBLE PRECISION,
    computed_at             TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_profiles_id_uq ON cosmic2_profiles (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_day_idx ON cosmic2_profiles (day DESC);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_quality_idx ON cosmic2_profiles (quality_status);

CREATE TABLE IF NOT EXISTS cosmic2_matches (
    profile_id            TEXT NOT NULL,
    day                   DATE NOT NULL,
    station_code          TEXT,
    station_distance_km   DOUBLE PRECISION,
    cors_timestamp        TIMESTAMPTZ,
    cors_vtec_tecu        DOUBLE PRECISION,
    time_delta_minutes    DOUBLE PRECISION,
    match_valid           BOOLEAN NOT NULL DEFAULT FALSE,
    match_quality         TEXT NOT NULL,
    match_reason          TEXT NOT NULL,
    computed_at           TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_matches_profile_uq ON cosmic2_matches (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_matches_day_idx ON cosmic2_matches (day DESC);

CREATE TABLE IF NOT EXISTS cosmic2_calibration_runs (
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    slope           DOUBLE PRECISION,
    intercept       DOUBLE PRECISION,
    r_squared       DOUBLE PRECISION,
    pearson_r       DOUBLE PRECISION,
    rmse_tecu       DOUBLE PRECISION,
    mae_tecu        DOUBLE PRECISION,
    mean_bias_tecu  DOUBLE PRECISION,
    sample_count    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    message         TEXT,
    computed_at     TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_calibration_range_uq ON cosmic2_calibration_runs (start_date, end_date);
