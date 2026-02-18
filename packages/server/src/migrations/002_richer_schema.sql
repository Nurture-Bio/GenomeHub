-- 002 — richer data model: ExperimentType, Sample, ExternalLink
--        Update Experiment with new fields, add sampleId to GenomicFile

-- ─── Experiment types (user-defined, not hardcoded) ───────

CREATE TABLE IF NOT EXISTS experiment_types (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  default_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed common genomics experiment types
INSERT INTO experiment_types (name, description, default_tags) VALUES
  ('RNA-seq',   'Transcriptome profiling by RNA sequencing',           '{"transcriptome","expression"}'),
  ('ChIP-seq',  'Chromatin immunoprecipitation followed by sequencing','{"chromatin","histone","TF"}'),
  ('ATAC-seq',  'Assay for Transposase-Accessible Chromatin',         '{"chromatin","accessibility","open-chromatin"}'),
  ('WGS',       'Whole genome sequencing',                            '{"genome","resequencing"}'),
  ('Hi-C',      'Chromosome conformation capture',                    '{"3D-genome","chromatin-architecture"}'),
  ('scRNA-seq', 'Single-cell RNA sequencing',                         '{"single-cell","transcriptome"}'),
  ('CUT&Tag',   'Cleavage Under Targets and Tagmentation',            '{"chromatin","epigenomics"}'),
  ('CUT&Run',   'Cleavage Under Targets and Release Using Nuclease',  '{"chromatin","epigenomics"}'),
  ('MNase-seq', 'Micrococcal nuclease digestion followed by sequencing','{"nucleosome","chromatin"}'),
  ('RRBS',      'Reduced Representation Bisulfite Sequencing',        '{"methylation","epigenomics"}'),
  ('Ribo-seq',  'Ribosome profiling',                                 '{"translation","ribosome"}')
ON CONFLICT (name) DO NOTHING;

-- ─── Alter experiments ────────────────────────────────────

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS experiment_type_id UUID REFERENCES experiment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organism          TEXT,
  ADD COLUMN IF NOT EXISTS reference_genome  TEXT,
  ADD COLUMN IF NOT EXISTS metadata          JSONB,
  ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'complete', 'archived'));

-- Make name non-unique (multiple experiments can share a name across projects)
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_name_key;

CREATE INDEX IF NOT EXISTS idx_experiments_type ON experiments(experiment_type_id);

-- ─── Samples ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS samples (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  condition     TEXT,
  replicate     INTEGER,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_samples_experiment ON samples(experiment_id);

-- ─── External links (polymorphic) ─────────────────────────

CREATE TABLE IF NOT EXISTS external_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type TEXT NOT NULL CHECK (parent_type IN ('project', 'experiment', 'sample')),
  parent_id   UUID NOT NULL,
  url         TEXT NOT NULL,
  service     TEXT NOT NULL DEFAULT 'link',
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_links_parent ON external_links(parent_type, parent_id);

-- ─── Add sampleId to genomic_files ────────────────────────

ALTER TABLE genomic_files
  ADD COLUMN IF NOT EXISTS sample_id UUID REFERENCES samples(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_genomic_files_sample ON genomic_files(sample_id);
