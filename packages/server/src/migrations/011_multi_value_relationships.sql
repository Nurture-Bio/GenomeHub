BEGIN;

-- File type: single text → text array
ALTER TABLE genomic_files ALTER COLUMN type DROP DEFAULT;
ALTER TABLE genomic_files ALTER COLUMN type TYPE text[]
  USING CASE WHEN type IS NOT NULL AND type != '' THEN ARRAY[type] ELSE '{}' END;
ALTER TABLE genomic_files ALTER COLUMN type SET DEFAULT '{}';
ALTER TABLE genomic_files ALTER COLUMN type SET NOT NULL;

-- Collection type: single text → text array
ALTER TABLE collections ALTER COLUMN type DROP DEFAULT;
ALTER TABLE collections ALTER COLUMN type TYPE text[]
  USING CASE WHEN type IS NOT NULL AND type != '' THEN ARRAY[type] ELSE '{}' END;
ALTER TABLE collections ALTER COLUMN type SET DEFAULT '{}';
ALTER TABLE collections ALTER COLUMN type SET NOT NULL;

-- Index for array containment queries (used by type filter)
CREATE INDEX idx_genomic_files_type_gin ON genomic_files USING GIN (type);
CREATE INDEX idx_collections_type_gin ON collections USING GIN (type);

COMMIT;
