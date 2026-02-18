CREATE TABLE IF NOT EXISTS file_kinds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO file_kinds (name, description) VALUES
  ('library', 'Library prep (fastq)'),
  ('sample', 'Raw sample data'),
  ('reference', 'Reference genome/assembly'),
  ('alignment', 'Aligned reads (bam/cram)'),
  ('counts', 'Count matrix'),
  ('annotation', 'Genome annotation (gff/gtf)'),
  ('qc', 'Quality control report'),
  ('index', 'Index file'),
  ('raw', 'Unclassified file'),
  ('other', 'Other file type')
ON CONFLICT (name) DO NOTHING;
