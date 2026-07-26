-- Incremental: games.report_count for Browse Games "Most reports" sort
-- Safe to re-run. Required when production predates schema.sql report_count.

ALTER TABLE games ADD COLUMN IF NOT EXISTS report_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_games_report_count
  ON games (report_count DESC NULLS LAST, name);

-- Keep denormalized count in sync for approved reports
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

DROP TRIGGER IF EXISTS trg_reports_report_count ON reports;
CREATE TRIGGER trg_reports_report_count
AFTER INSERT OR UPDATE OR DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION update_game_report_count();

-- One-time backfill
UPDATE games g
SET report_count = (
  SELECT count(*) FROM reports r
  WHERE r.game_id = g.id AND r.status = 'approved'
);
