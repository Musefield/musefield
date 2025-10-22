-- TFS seed
CREATE TABLE IF NOT EXISTS tfs_lineage (
  id serial PRIMARY KEY,
  dataset text,
  version text,
  uri text,
  created_at timestamptz DEFAULT now()
);
