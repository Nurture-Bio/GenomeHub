-- 005: Generalize experiments → collections, experiment_types → techniques
--
-- An experiment is just one kind of collection (playlist of files).
-- A sequencing batch, a paper's figure set, a QC failure list — all playlists.
-- Kind-specific metadata (experiment_date, status) moves to JSONB.
-- No hardcoded columns that only apply to some collection types.
--
-- ExperimentType is just a sequencing technique (ChIP-seq, RNA-seq, etc.).
-- Rename to "techniques" — generic reference data, not experiment-specific.

-- ─── Fix has_type edges FIRST ────────────────────────────────
-- has_type edges currently have target_type = 'experiment' (pointing at
-- experiment_types rows). Fix them BEFORE the blanket rename so they
-- don't accidentally become 'collection'.
UPDATE entity_edges SET target_type = 'technique'
  WHERE relation = 'has_type' AND target_type = 'experiment';

-- ─── Rename experiments → collections ────────────────────────
ALTER TABLE experiments RENAME TO collections;

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'experiment';

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Migrate existing experiment-specific columns into metadata
UPDATE collections
SET metadata = jsonb_strip_nulls(jsonb_build_object(
  'experimentDate', experiment_date,
  'status', status
))
WHERE experiment_date IS NOT NULL OR status != 'active';

-- For rows where status is 'active' and no date, set empty metadata
UPDATE collections
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

-- Drop the hardcoded columns
ALTER TABLE collections DROP COLUMN IF EXISTS experiment_date;
ALTER TABLE collections DROP COLUMN IF EXISTS status;

-- Update edge references: 'experiment' → 'collection'
UPDATE entity_edges SET source_type = 'collection' WHERE source_type = 'experiment';
UPDATE entity_edges SET target_type = 'collection' WHERE target_type = 'experiment';

-- ─── Rename experiment_types → techniques ────────────────────
ALTER TABLE experiment_types RENAME TO techniques;
