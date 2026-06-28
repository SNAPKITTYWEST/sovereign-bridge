-- SOVEREIGNBRIDGE shell additions.
-- Shared PostgreSQL 16 database with SovereignSuite.

CREATE TABLE IF NOT EXISTS bridge_conflict (
    conflict_id      BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    source_system    TEXT NOT NULL,
    source_resource  TEXT NOT NULL,
    source_id        TEXT,
    sovereign_table  TEXT NOT NULL,
    sovereign_id     TEXT NOT NULL,
    original_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution       TEXT NOT NULL DEFAULT 'sovereign_authoritative',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bridge_external_ref (
    ref_id           BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    source_system    TEXT NOT NULL,
    source_resource  TEXT NOT NULL,
    source_id        TEXT NOT NULL,
    sovereign_table  TEXT NOT NULL,
    sovereign_id     TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, source_system, source_resource, source_id)
);

CREATE TABLE IF NOT EXISTS qbo_class (
    class_id         BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    qbo_id           TEXT,
    name             TEXT NOT NULL,
    parent_id        BIGINT REFERENCES qbo_class(class_id),
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_department (
    department_id    BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    qbo_id           TEXT,
    name             TEXT NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_taxcode (
    taxcode_id       BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    qbo_id           TEXT,
    name             TEXT NOT NULL,
    rate             NUMERIC(9,6) NOT NULL DEFAULT 0,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_attachment (
    attachment_id    BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    attachable_type  TEXT NOT NULL,
    attachable_id    TEXT NOT NULL,
    filename         TEXT NOT NULL,
    content_type     TEXT,
    minio_bucket     TEXT NOT NULL,
    minio_key        TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbo_webhook_event (
    event_id         BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    intuit_event_id  TEXT,
    payload          JSONB NOT NULL,
    signature_ok     BOOLEAN NOT NULL,
    worm_seq         BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sf_object (
    sf_object_id     BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    api_name         TEXT NOT NULL,
    label            TEXT NOT NULL,
    custom           BOOLEAN NOT NULL DEFAULT FALSE,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, api_name)
);

CREATE TABLE IF NOT EXISTS sf_field (
    sf_field_id      BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    object_type      TEXT NOT NULL,
    api_name         TEXT NOT NULL,
    label            TEXT NOT NULL,
    field_type       TEXT NOT NULL,
    nillable         BOOLEAN NOT NULL DEFAULT TRUE,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, object_type, api_name)
);

CREATE TABLE IF NOT EXISTS sf_record (
    record_id        BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    object_type      TEXT NOT NULL,
    sf_id            TEXT NOT NULL,
    external_id      TEXT,
    fields           JSONB NOT NULL DEFAULT '{}'::jsonb,
    owner_id         TEXT,
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    worm_seq         BIGINT,
    UNIQUE (company_id, object_type, sf_id)
);

CREATE INDEX IF NOT EXISTS idx_sf_record_object ON sf_record(company_id, object_type);
CREATE INDEX IF NOT EXISTS idx_sf_record_fields_gin ON sf_record USING gin(fields);

CREATE TABLE IF NOT EXISTS sf_relationship (
    relationship_id  BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    parent_object    TEXT NOT NULL,
    child_object     TEXT NOT NULL,
    field_name       TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sf_attachment (
    attachment_id    BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    object_type      TEXT NOT NULL,
    sf_id            TEXT NOT NULL,
    field_name       TEXT,
    filename         TEXT NOT NULL,
    content_type     TEXT,
    minio_bucket     TEXT NOT NULL,
    minio_key        TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sf_flow (
    flow_id          BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    name             TEXT NOT NULL,
    object_type      TEXT,
    definition       JSONB NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sf_trigger (
    trigger_id       BIGSERIAL PRIMARY KEY,
    company_id       BIGINT NOT NULL,
    object_type      TEXT NOT NULL,
    event_name       TEXT NOT NULL,
    handler          TEXT NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    definition       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
