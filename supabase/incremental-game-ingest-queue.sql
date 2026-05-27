-- RunDB: game ingest queue (Choice 4 — two-phase catalog growth)
-- Run in Supabase SQL Editor after base schema.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE games ADD COLUMN IF NOT EXISTS ingest_status text
  CHECK (ingest_status IN ('skeleton', 'enriched', 'failed'));

CREATE TABLE IF NOT EXISTS game_ingest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  steam_app_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  priority int NOT NULL DEFAULT 0,
  report_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON game_ingest_queue (status, priority);
CREATE INDEX IF NOT EXISTS idx_games_ingest_status ON games (ingest_status);
CREATE INDEX IF NOT EXISTS idx_games_name_trgm ON games USING gin (name gin_trgm_ops);

CREATE TRIGGER game_ingest_queue_updated_at
  BEFORE UPDATE ON game_ingest_queue
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE game_ingest_queue ENABLE ROW LEVEL SECURITY;
-- No public policies: service role only (same as games INSERT pattern)
