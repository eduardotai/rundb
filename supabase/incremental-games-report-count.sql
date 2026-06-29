-- Browse Games "Most reports" support for existing Supabase projects.
-- Adds a denormalized approved-report counter to games and keeps it in sync.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS report_count int NOT NULL DEFAULT 0;

UPDATE public.games g
SET report_count = (
  SELECT COUNT(*)::int
  FROM public.reports r
  WHERE r.game_id = g.id
    AND r.status = 'approved'
);

CREATE INDEX IF NOT EXISTS idx_games_report_count
  ON public.games (report_count DESC, name ASC);

CREATE OR REPLACE FUNCTION public.refresh_game_report_count(p_game_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE games
  SET report_count = (
    SELECT COUNT(*)::int
    FROM reports
    WHERE game_id = p_game_id
      AND status = 'approved'
  )
  WHERE id = p_game_id;
$$;

CREATE OR REPLACE FUNCTION public.update_game_report_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.refresh_game_report_count(NEW.game_id);
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.game_id IS DISTINCT FROM NEW.game_id) THEN
    PERFORM public.refresh_game_report_count(OLD.game_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_game_report_count ON public.reports;
CREATE TRIGGER trg_reports_game_report_count
AFTER INSERT OR UPDATE OF game_id, status OR DELETE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.update_game_report_count();
