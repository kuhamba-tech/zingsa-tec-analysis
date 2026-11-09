-- Scientific literature RAG tables for ZINGSA Google Drive library.
-- Apply with: python scripts/init_scientific_rag_schema.py
-- Does not invent bibliographic metadata; missing fields stay NULL.

CREATE TABLE IF NOT EXISTS scientific_rag_collections (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scientific_rag_documents (
    drive_file_id   TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    mime_type       TEXT,
    authors         TEXT,
    publication_year INTEGER,
    journal         TEXT,
    doi             TEXT,
    source_url      TEXT,
    drive_modified  TIMESTAMPTZ,
    document_version TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    page_count      INTEGER,
    byte_size       BIGINT,
    content_sha256  TEXT,
    indexed_at      TIMESTAMPTZ,
    removed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scientific_rag_documents_status_idx
    ON scientific_rag_documents (status);
CREATE INDEX IF NOT EXISTS scientific_rag_documents_modified_idx
    ON scientific_rag_documents (drive_modified DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS scientific_rag_document_collections (
    drive_file_id   TEXT NOT NULL REFERENCES scientific_rag_documents(drive_file_id) ON DELETE CASCADE,
    collection_id   TEXT NOT NULL REFERENCES scientific_rag_collections(id) ON DELETE CASCADE,
    PRIMARY KEY (drive_file_id, collection_id)
);

CREATE TABLE IF NOT EXISTS scientific_rag_chunks (
    id              BIGSERIAL PRIMARY KEY,
    drive_file_id   TEXT NOT NULL REFERENCES scientific_rag_documents(drive_file_id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    page_start      INTEGER,
    page_end        INTEGER,
    section_heading TEXT,
    text            TEXT NOT NULL,
    token_estimate  INTEGER,
    embedding       REAL[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (drive_file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS scientific_rag_chunks_file_idx
    ON scientific_rag_chunks (drive_file_id, chunk_index);

CREATE TABLE IF NOT EXISTS scientific_rag_sync_runs (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    mode            TEXT NOT NULL DEFAULT 'incremental',
    listed          INTEGER DEFAULT 0,
    indexed         INTEGER DEFAULT 0,
    failed          INTEGER DEFAULT 0,
    removed         INTEGER DEFAULT 0,
    message         TEXT
);

INSERT INTO scientific_rag_collections (id, title, description) VALUES
    ('gnss-tec', 'GNSS Total Electron Content (TEC)', 'TEC methodology and observations'),
    ('african-iono', 'African / Southern African ionosphere', 'Regional African ionospheric studies'),
    ('diurnal-seasonal', 'Diurnal and seasonal TEC variation', 'Quiet-day and seasonal climatology'),
    ('eia', 'Equatorial Ionization Anomaly', 'EIA physics and African signatures'),
    ('solar-activity', 'Solar activity and solar cycles', 'Flares, cycles, EUV forcing'),
    ('geomagnetic-storms', 'Geomagnetic storms and disturbances', 'Storm-time ionosphere'),
    ('scintillation-roti', 'GNSS scintillation and ROTI', 'Amplitude/phase scintillation'),
    ('sw-forecasting', 'Space-weather forecasting', 'Forecast methods and verification'),
    ('gnss-performance', 'GNSS positioning performance', 'RTK/PPP/navigation impacts'),
    ('gic', 'Geomagnetically Induced Currents', 'GIC science and monitoring'),
    ('sbas', 'Satellite-Based Augmentation Systems', 'SBAS ionospheric corrections'),
    ('methods-validation', 'Scientific data processing and validation', 'QC, baselines, uncertainty')
ON CONFLICT (id) DO NOTHING;
