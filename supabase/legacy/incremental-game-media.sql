-- Idempotent: add game_media if missing (safe when base schema already applied).
-- Run in Supabase SQL Editor or: npm run setup:supabase (with SUPABASE_ACCESS_TOKEN or DATABASE_URL).

CREATE TABLE IF NOT EXISTS game_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('cover', 'screenshot', 'artwork', 'logo', 'video')),
  url text NOT NULL,
  thumbnail_url text,
  width integer,
  height integer,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'igdb',
  external_id text,
  attribution text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_media_game ON game_media (game_id, media_type, sort_order);

ALTER TABLE game_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Game media are publicly readable" ON game_media FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
