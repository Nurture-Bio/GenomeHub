-- 003 — Knowledge graph data model
--        Replace FK tree with entity_edges, replace samples with datasets
--        Fresh schema — no data to preserve

-- ─── Drop old tables ────────────────────────────────────────

DROP TABLE IF EXISTS external_links CASCADE;
DROP TABLE IF EXISTS samples CASCADE;

-- ─── Drop FK columns from experiments ───────────────────────

ALTER TABLE experiments
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS organism_id,
  DROP COLUMN IF EXISTS experiment_type_id;

-- ─── Drop FK columns from genomic_files ─────────────────────

ALTER TABLE genomic_files
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS experiment_id,
  DROP COLUMN IF EXISTS sample_id,
  DROP COLUMN IF EXISTS organism_id;

-- ─── Create datasets table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS datasets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'sample'
    CHECK (kind IN ('sample','library','reference','pool','control','other')),
  description TEXT,
  condition   TEXT,
  replicate   INTEGER,
  metadata    JSONB,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Create entity_edges table ──────────────────────────────

CREATE TABLE IF NOT EXISTS entity_edges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id   UUID NOT NULL,
  target_type TEXT NOT NULL,
  target_id   UUID NOT NULL,
  relation    TEXT NOT NULL,
  metadata    JSONB,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edges_source
  ON entity_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target
  ON entity_edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_edges_source_relation
  ON entity_edges(source_type, source_id, relation);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
  ON entity_edges(source_type, source_id, target_type, target_id, relation);
