-- 001 — initial schema

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS genomic_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  s3_key      TEXT NOT NULL,
  upload_id   TEXT,                        -- S3 multipart upload ID, cleared when done
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  format      TEXT NOT NULL DEFAULT 'other',
  md5         TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ready', 'error')),
  description TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_genomic_files_project ON genomic_files(project_id);
CREATE INDEX IF NOT EXISTS idx_genomic_files_format  ON genomic_files(format);
CREATE INDEX IF NOT EXISTS idx_genomic_files_status  ON genomic_files(status);
