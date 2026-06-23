-- Namespaces
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS meta;

CREATE TABLE IF NOT EXISTS meta.data_version (
  id          BIGSERIAL PRIMARY KEY,
  built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision    TEXT NOT NULL,
  note        TEXT
);
CREATE TABLE IF NOT EXISTS meta.ingest_log (
  match_id    TEXT PRIMARY KEY,
  source_file TEXT,
  file_rev    INT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL  -- ok | error
);
