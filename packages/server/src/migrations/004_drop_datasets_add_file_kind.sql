-- 004: Drop datasets, add kind to genomic_files
--
-- The Dataset abstraction is removed. The biological meaning (library, sample,
-- reference, etc.) now lives on the file itself as `kind`.

-- Drop datasets table and related edges
DROP TABLE IF EXISTS datasets CASCADE;
DELETE FROM entity_edges WHERE source_type = 'dataset' OR target_type = 'dataset';

-- Add kind to genomic_files
ALTER TABLE genomic_files
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'raw';
