-- CFS seed
CREATE TABLE IF NOT EXISTS cfs_metrics (
  id serial PRIMARY KEY,
  ts timestamptz DEFAULT now(),
  coherence_index numeric,
  rhythm_variance numeric
);
