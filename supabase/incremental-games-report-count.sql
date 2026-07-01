-- RunDB games.report_count backfill and maintenance.
-- Safe to re-run on existing Supabase projects.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS report_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_games_report_count
  ON public.games (report_count DESC, name ASC);

CREATE OR REPLACE FUNCTION public.recompute_game_report_count(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF p_game_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.games
  SET report_count = (
    SELECT COUNT(*)::int
    FROM public.reports
    WHERE game_id = p_game_id AND status = 'approved'
  )
  WHERE id = p_game_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_game_report_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_game_report_count(NEW.game_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.game_id IS DISTINCT FROM OLD.game_id THEN
      PERFORM public.recompute_game_report_count(OLD.game_id);
    END IF;
    PERFORM public.recompute_game_report_count(NEW.game_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_game_report_count(OLD.game_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reports_game_report_count ON public.reports;
CREATE TRIGGER reports_game_report_count
AFTER INSERT OR UPDATE OF game_id, status OR DELETE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.update_game_report_count();

UPDATE public.games AS g
SET report_count = COALESCE((
  SELECT COUNT(*)::int
  FROM public.reports AS r
  WHERE r.game_id = g.id AND r.status = 'approved'
), 0);
