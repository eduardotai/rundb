-- RESOLVED schema.sql
-- Merged best from PR39 (full restore + report_count + migration) + PR30/35 context + current intent.
-- Replaces the 134B placeholder on disk.

-- Core games table (with report_count added for 'sort by reports')
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  cover_url text,
  attribution text,
  genres text[] DEFAULT '{}',
  release_year int,
  developer text,
  publisher text,
  official_min_reqs jsonb,
  official_rec_reqs jsonb,
  steam_app_id bigint,
  igdb_id bigint,
  external_id_attribution text,
  ingest_status text,
  report_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for reports sort
CREATE INDEX IF NOT EXISTS idx_games_report_count ON games (report_count DESC NULLS LAST, name);

-- Incremental migration for existing deployments (safe, from PR descriptions)
-- Run this once on old DBs:
-- ALTER TABLE games ADD COLUMN IF NOT EXISTS report_count int DEFAULT 0;
-- CREATE INDEX IF NOT EXISTS idx_games_report_count ON games (report_count DESC NULLS LAST, name);

-- Trigger function to maintain report_count on approved reports
CREATE OR REPLACE FUNCTION update_game_report_count()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.status = 'approved' THEN
    UPDATE games SET report_count = (
      SELECT count(*) FROM reports WHERE game_id = NEW.game_id AND status = 'approved'
    ) WHERE id = NEW.game_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status <> 'approved') THEN
    UPDATE games SET report_count = (
      SELECT count(*) FROM reports WHERE game_id = COALESCE(NEW.game_id, OLD.game_id) AND status = 'approved'
    ) WHERE id = COALESCE(NEW.game_id, OLD.game_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger (example; adjust if policy differs)
DROP TRIGGER IF EXISTS trg_reports_report_count ON reports;
CREATE TRIGGER trg_reports_report_count
AFTER INSERT OR UPDATE OR DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION update_game_report_count();

-- Note: Backfill for existing:
-- UPDATE games g SET report_count = (SELECT count(*) FROM reports r WHERE r.game_id = g.id AND r.status = 'approved');
