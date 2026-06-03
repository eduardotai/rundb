-- RunDB reputation + signed voting.
-- Safe to re-run on existing Supabase projects.

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS downvote_votes integer NOT NULL DEFAULT 0 CHECK (downvote_votes >= 0),
  ADD COLUMN IF NOT EXISTS vote_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credibility_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credibility_badge text NOT NULL DEFAULT 'New'
    CHECK (credibility_badge IN ('New', 'Helpful', 'Trusted', 'Expert', 'Legend'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reputation_score integer NOT NULL DEFAULT 0 CHECK (reputation_score >= 0),
  ADD COLUMN IF NOT EXISTS credibility_badge text NOT NULL DEFAULT 'New'
    CHECK (credibility_badge IN ('New', 'Helpful', 'Trusted', 'Expert', 'Legend')),
  ADD COLUMN IF NOT EXISTS reports_submitted integer NOT NULL DEFAULT 0 CHECK (reports_submitted >= 0),
  ADD COLUMN IF NOT EXISTS votes_cast integer NOT NULL DEFAULT 0 CHECK (votes_cast >= 0);

ALTER TABLE public.report_votes
  ADD COLUMN IF NOT EXISTS vote smallint NOT NULL DEFAULT 1 CHECK (vote IN (-1, 1)),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.reports ALTER COLUMN status SET DEFAULT 'approved';
UPDATE public.reports SET status = 'approved' WHERE status = 'pending';
UPDATE public.report_votes SET vote = 1 WHERE vote IS NULL;

CREATE INDEX IF NOT EXISTS idx_reports_vote_score ON public.reports (vote_score DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_reputation ON public.profiles (reputation_score DESC);

CREATE OR REPLACE FUNCTION private.credibility_badge_for_score(p_score integer)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_score >= 500 THEN 'Legend'
    WHEN p_score >= 200 THEN 'Expert'
    WHEN p_score >= 75 THEN 'Trusted'
    WHEN p_score >= 20 THEN 'Helpful'
    ELSE 'New'
  END;
$$;

CREATE OR REPLACE FUNCTION private.touch_report_vote()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_votes_touch_updated_at ON public.report_votes;
CREATE TRIGGER report_votes_touch_updated_at
BEFORE UPDATE ON public.report_votes
FOR EACH ROW EXECUTE FUNCTION private.touch_report_vote();

CREATE OR REPLACE FUNCTION private.recompute_report_vote_totals(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private AS $$
DECLARE
  v_up integer;
  v_down integer;
  v_score integer;
  v_badge text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE vote = 1),
    COUNT(*) FILTER (WHERE vote = -1)
  INTO v_up, v_down
  FROM public.report_votes
  WHERE report_id = p_report_id;

  v_up := COALESCE(v_up, 0);
  v_down := COALESCE(v_down, 0);
  v_score := v_up - v_down;
  v_badge := private.credibility_badge_for_score(GREATEST(0, v_score * 10 + v_up * 2));

  UPDATE public.reports
  SET helpful_votes = v_up,
      downvote_votes = v_down,
      vote_score = v_score,
      credibility_score = GREATEST(0, v_score * 10 + v_up * 2),
      credibility_badge = v_badge,
      status = CASE
        WHEN v_down >= 3 AND v_score <= -3 THEN 'flagged'::report_status
        ELSE 'approved'::report_status
      END
  WHERE id = p_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.recompute_profile_reputation(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private AS $$
DECLARE
  v_reports integer;
  v_live integer;
  v_up integer;
  v_down integer;
  v_score integer;
  v_votes_cast integer;
  v_rep integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'approved'),
    COALESCE(SUM(helpful_votes), 0),
    COALESCE(SUM(downvote_votes), 0),
    COALESCE(SUM(vote_score), 0)
  INTO v_reports, v_live, v_up, v_down, v_score
  FROM public.reports
  WHERE user_id = p_user_id;

  SELECT COUNT(*) INTO v_votes_cast
  FROM public.report_votes
  WHERE user_id = p_user_id;

  v_rep := GREATEST(0, v_live * 8 + v_up * 3 + v_score - v_down * 2 + v_reports + LEAST(v_votes_cast, 250));

  UPDATE public.profiles
  SET reports_submitted = COALESCE(v_reports, 0),
      votes_cast = COALESCE(v_votes_cast, 0),
      reputation_score = v_rep,
      credibility_badge = private.credibility_badge_for_score(v_rep)
  WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.after_report_vote_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private AS $$
DECLARE
  v_reporter uuid;
BEGIN
  PERFORM private.recompute_report_vote_totals(COALESCE(NEW.report_id, OLD.report_id));

  SELECT user_id INTO v_reporter
  FROM public.reports
  WHERE id = COALESCE(NEW.report_id, OLD.report_id);

  PERFORM private.recompute_profile_reputation(v_reporter);
  PERFORM private.recompute_profile_reputation(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_votes_count ON public.report_votes;
DROP TRIGGER IF EXISTS report_votes_recompute_reputation ON public.report_votes;
CREATE TRIGGER report_votes_recompute_reputation
AFTER INSERT OR UPDATE OR DELETE ON public.report_votes
FOR EACH ROW EXECUTE FUNCTION private.after_report_vote_changed();

CREATE OR REPLACE FUNCTION private.after_report_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private AS $$
BEGIN
  PERFORM private.recompute_profile_reputation(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reports_recompute_profile_reputation ON public.reports;
CREATE TRIGGER reports_recompute_profile_reputation
AFTER INSERT OR UPDATE OF user_id, status, helpful_votes, downvote_votes, vote_score OR DELETE ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.after_report_changed();

DROP POLICY IF EXISTS "Users can vote on reports" ON public.report_votes;
DROP POLICY IF EXISTS "Users can update own report votes" ON public.report_votes;
DROP POLICY IF EXISTS "Users can delete own report votes" ON public.report_votes;

CREATE POLICY "Users can vote on reports" ON public.report_votes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND vote IN (-1, 1));

CREATE POLICY "Users can update own report votes" ON public.report_votes
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND vote IN (-1, 1));

CREATE POLICY "Users can delete own report votes" ON public.report_votes
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Anyone can insert reports (self or anonymous)" ON public.reports;
DROP POLICY IF EXISTS "Authenticated users can insert reports" ON public.reports;

CREATE POLICY "Anyone can insert reports (self or anonymous)" ON public.reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'approved'
    AND helpful_votes = 0
    AND downvote_votes = 0
    AND vote_score = 0
    AND ((user_id IS NULL) OR (user_id = auth.uid()))
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.games, public.reports, public.profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_votes TO authenticated;
GRANT INSERT ON public.reports TO anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, user_id FROM public.reports LOOP
    PERFORM private.recompute_report_vote_totals(r.id);
    PERFORM private.recompute_profile_reputation(r.user_id);
  END LOOP;
END $$;
