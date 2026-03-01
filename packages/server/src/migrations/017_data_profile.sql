-- Add data_profile JSONB column for lazy hydration of file metadata.
ALTER TABLE genomic_files ADD COLUMN IF NOT EXISTS data_profile jsonb;
