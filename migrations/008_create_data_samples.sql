-- Migration 008: delivery log for the Data Samples tab (buyer image + JSON zips)
--
-- Additive only: a new schema with three tables; nothing existing is touched.
-- Run: npm run migrate-008   (or paste into the Supabase SQL editor)
--
-- Why it exists: a buyer on a monthly plan must never receive the same photo
-- twice, and when a user asks to be deleted we must be able to say which
-- buyers already have their photos.

CREATE SCHEMA IF NOT EXISTS datasales;

CREATE TABLE IF NOT EXISTS datasales.buyers (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL UNIQUE,
    notes           TEXT,
    -- HMAC key for this buyer's pseudonymous user ids: stable across all of
    -- the buyer's deliveries, unlinkable to any other buyer's. Secret.
    pseudonym_key   BYTEA NOT NULL,
    -- Next sample number: sample ids continue across deliveries, never reused.
    next_sample_seq INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS datasales.exports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        INTEGER NOT NULL REFERENCES datasales.buyers(id),
    source          VARCHAR(40) NOT NULL,        -- ready_to_train | app_poop | stool_logs
    config          JSONB NOT NULL,              -- counts per type, fields, options
    requested_count INTEGER NOT NULL,
    prepared_count  INTEGER NOT NULL,
    delivered_count INTEGER,                     -- photos actually in the zip
    -- prepared: sampled, photos reserved for this buyer
    -- delivered: zip fully downloaded at least once
    -- voided: never sent; its photos are available again
    status          VARCHAR(20) NOT NULL DEFAULT 'prepared'
                    CHECK (status IN ('prepared', 'delivered', 'voided')),
    created_by      VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    voided_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_datasales_exports_buyer
    ON datasales.exports (buyer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS datasales.export_items (
    export_id     UUID NOT NULL REFERENCES datasales.exports(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL,              -- order inside the zip
    sample_id     VARCHAR(40) NOT NULL,          -- what the buyer sees
    source_table  VARCHAR(40) NOT NULL,          -- app.poop | softai.stool_logs
    source_row_id TEXT NOT NULL,
    image_hash    VARCHAR(64),                   -- stool_logs: same photo re-submitted
    person_ref    TEXT,                          -- Firebase uid; NULL for anonymous uploads
    bristol_type  SMALLINT NOT NULL,
    failed        BOOLEAN NOT NULL DEFAULT false, -- image unavailable; not delivered
    PRIMARY KEY (export_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_datasales_items_row
    ON datasales.export_items (source_table, source_row_id);
CREATE INDEX IF NOT EXISTS idx_datasales_items_hash
    ON datasales.export_items (image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_datasales_items_person
    ON datasales.export_items (person_ref) WHERE person_ref IS NOT NULL;

-- Defence in depth: if this schema is ever exposed through Supabase's Data
-- API, RLS with no policies denies anon/authenticated roles. The backend
-- connects as the table owner and is unaffected.
ALTER TABLE datasales.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasales.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasales.export_items ENABLE ROW LEVEL SECURITY;
