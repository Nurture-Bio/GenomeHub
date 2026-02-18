CREATE TABLE IF NOT EXISTS file_kinds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO file_kinds (name, description) VALUES
  ('library', 'Sequencing library'),
  ('sample', 'Raw sample data'),
  ('reference', 'Reference genome or assembly'),
  ('alignment', 'Aligned reads'),
  ('counts', 'Count or expression matrix'),
  ('annotation', 'Genome annotation'),
  ('qc', 'Quality control report'),
  ('index', 'Index file'),
  ('raw', 'Unclassified file'),
  ('other', 'Other file type')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;
