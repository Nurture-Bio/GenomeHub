CREATE TABLE IF NOT EXISTS relation_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO relation_types (name, description) VALUES
  ('derived_from', 'File was derived from another file'),
  ('sequenced_from', 'File was sequenced from another file'),
  ('produced_by', 'File was produced by another file')
ON CONFLICT (name) DO NOTHING;
