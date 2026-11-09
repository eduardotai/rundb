-- Bring two functions in line with the repo. Production still runs older bodies:
--
-- 1. public.handle_new_user(): the repo (commit ab674de, 2026-06-03) seeds
--    profiles.username from raw_user_meta_data ->> 'username' (public nickname);
--    production still copies 'full_name' (real names from OAuth providers).
--    Source: supabase/schema.sql before its truncation (git show ea15474:supabase/schema.sql).
--
-- 2. private.recompute_report_vote_totals(uuid): the repo (commit 0aef8b3,
--    2026-06-29) keeps rejected and staff-flagged reports from being
--    re-approved by vote recomputation; production still has the older body.
--    Source: supabase/legacy/incremental-reputation-voting.sql (verbatim).
--
-- Both statements are CREATE OR REPLACE with unchanged signatures, so they are
-- safe to re-run and do not touch existing rows.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'username',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;

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
        WHEN status = 'rejected'::report_status THEN status
        WHEN moderated_by IS NOT NULL AND status = 'flagged'::report_status THEN status
        WHEN v_down >= 3 AND v_score <= -3 THEN 'flagged'::report_status
        ELSE 'approved'::report_status
      END
  WHERE id = p_report_id;
END;
$$;
