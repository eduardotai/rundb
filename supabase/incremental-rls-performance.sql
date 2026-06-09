-- RunDB: RLS + FK index performance hardening (Supabase Postgres best practices).
-- Safe to re-run on existing projects. Apply in Supabase SQL Editor after base schema.
--
-- Fixes identified by auditing schema.sql against Supabase RLS/index guidance:
-- 1. Wrap auth.uid() as (select auth.uid()) so Postgres evaluates it once per query.
-- 2. Replace per-row EXISTS moderator checks with a SECURITY DEFINER helper.
-- 3. Index foreign keys and rate-limit columns used heavily in policies/RPCs.

-- ---------------------------------------------------------------------------
-- Helper: moderator/admin check (bypasses RLS on profiles, single indexed lookup)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_moderator_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('moderator', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_moderator_or_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- Indexes: FK columns + submit_report hot paths
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reports_user_created
  ON public.reports (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_user_game_created
  ON public.reports (user_id, game_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_votes_report
  ON public.report_votes (report_id);

CREATE INDEX IF NOT EXISTS idx_report_images_report
  ON public.report_images (report_id);

CREATE INDEX IF NOT EXISTS idx_game_ingest_queue_game
  ON public.game_ingest_queue (game_id)
  WHERE game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (id)
  WHERE role IN ('moderator', 'admin');

-- ---------------------------------------------------------------------------
-- Reports policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read their own reports" ON public.reports;
CREATE POLICY "Users can read their own reports" ON public.reports
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Anyone can insert reports (self or anonymous)" ON public.reports;
CREATE POLICY "Anyone can insert reports (self or anonymous)" ON public.reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status IN ('pending', 'approved')
    AND ((user_id IS NULL) OR (user_id = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Users can update own pending reports" ON public.reports;
CREATE POLICY "Users can update own pending reports" ON public.reports
  FOR UPDATE USING (user_id = (SELECT auth.uid()) AND status = 'pending');

DROP POLICY IF EXISTS "Moderators can read all reports for moderation" ON public.reports;
CREATE POLICY "Moderators can read all reports for moderation" ON public.reports
  FOR SELECT USING ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators can moderate any report" ON public.reports;
CREATE POLICY "Moderators can moderate any report" ON public.reports
  FOR UPDATE USING ((SELECT public.is_moderator_or_admin()))
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

-- ---------------------------------------------------------------------------
-- Profiles policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = id AND role = 'user');

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Votes, rigs, images, linked accounts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can vote on reports" ON public.report_votes;
CREATE POLICY "Users can vote on reports" ON public.report_votes
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can see their own votes" ON public.report_votes;
CREATE POLICY "Users can see their own votes" ON public.report_votes
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own rig" ON public.user_rigs;
CREATE POLICY "Users can manage their own rig" ON public.user_rigs
  FOR ALL USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage images on their reports" ON public.report_images;
CREATE POLICY "Users can manage images on their reports" ON public.report_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.reports
      WHERE reports.id = report_images.report_id
        AND reports.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can manage own linked accounts" ON public.linked_accounts;
CREATE POLICY "Users can manage own linked accounts" ON public.linked_accounts
  FOR ALL USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Hardware catalog moderator policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Moderators and admins can insert hardware catalog entries" ON public.hardware_catalog;
CREATE POLICY "Moderators and admins can insert hardware catalog entries"
  ON public.hardware_catalog FOR INSERT
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can update hardware catalog entries" ON public.hardware_catalog;
CREATE POLICY "Moderators and admins can update hardware catalog entries"
  ON public.hardware_catalog FOR UPDATE
  USING ((SELECT public.is_moderator_or_admin()))
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can delete hardware catalog entries" ON public.hardware_catalog;
CREATE POLICY "Moderators and admins can delete hardware catalog entries"
  ON public.hardware_catalog FOR DELETE
  USING ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can insert hardware aliases" ON public.hardware_aliases;
CREATE POLICY "Moderators and admins can insert hardware aliases"
  ON public.hardware_aliases FOR INSERT
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can update hardware aliases" ON public.hardware_aliases;
CREATE POLICY "Moderators and admins can update hardware aliases"
  ON public.hardware_aliases FOR UPDATE
  USING ((SELECT public.is_moderator_or_admin()))
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can delete hardware aliases" ON public.hardware_aliases;
CREATE POLICY "Moderators and admins can delete hardware aliases"
  ON public.hardware_aliases FOR DELETE
  USING ((SELECT public.is_moderator_or_admin()));
