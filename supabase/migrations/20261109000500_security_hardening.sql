-- Security hardening for RLS and privileges (PR 4).
-- Fixes the gaps the production baseline reproduced as-is (listed in PR #65):
--   1. linked_accounts: clients could insert/update their own Steam link (forge a verified link).
--   2. profiles: "update own row" let clients change reputation, badge, counters and steam_* columns.
--   3. profiles: anon/authenticated could read every column of every profile (role, steam_id, rig).
--   4. report_images: owner FOR ALL policy had no WITH CHECK, so owners could self-approve images.
--   5. report_votes: users could vote on their own reports; INSERT policy did not pin vote to -1/1.
--   6. reports: "Users can update own pending reports" let owners rewrite any column of a pending report
--      (vote counters, FPS) without the server-side validation in updateReportAction.
--   7. Every function was EXECUTE-able by PUBLIC/anon, including internal trigger helpers.
--   8. Supabase default grants gave anon/authenticated TRUNCATE/TRIGGER/REFERENCES/MAINTAIN and anon writes.
-- Writes that need privileged columns now go through the service role on the server
-- (Steam OpenID callback) or SECURITY DEFINER functions/triggers below.
-- supabase/tests/policies.sql exercises every rule as anon / owner / other user / moderator.

-- ---------------------------------------------------------------------------
-- 8. Table privileges: no TRUNCATE/TRIGGER/REFERENCES/MAINTAIN for API roles; anon is read-only.
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- 2 + 3. profiles: column-level grants.
-- Everyone (anon + authenticated) may read only the public columns. A signed-in user reads
-- their own private columns (role, rig, steam_*) through public.get_my_profile().
-- Clients may write only username and rig columns; reputation, badge, counters, role,
-- avatar_url and steam_* are written by triggers or the service role.
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, avatar_url, credibility_badge, reputation_score, reports_submitted, votes_cast, created_at, updated_at)
  ON TABLE public.profiles TO anon, authenticated;
-- id is included so PostgREST upserts (ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, ...) work;
-- the RLS WITH CHECK (auth.uid() = id) still pins it to the caller.
GRANT INSERT (id, username, main_cpu, main_gpu, main_ram, preferred_resolution)
  ON TABLE public.profiles TO authenticated;
GRANT UPDATE (id, username, main_cpu, main_gpu, main_ram, preferred_resolution)
  ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.* FROM public.profiles p WHERE p.id = (SELECT auth.uid());
$$;
COMMENT ON FUNCTION public.get_my_profile() IS
  'Returns the caller''s own profile row with every column (role, rig, steam_*). Other users'' profiles are readable only through the public column grants on public.profiles.';
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. linked_accounts: clients can read and delete their own link only.
-- Links are created by the Steam OpenID callback with the service role after verification.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own linked accounts" ON public.linked_accounts;
DROP POLICY IF EXISTS "Public can see linked Steam for verification badges" ON public.linked_accounts;

DROP POLICY IF EXISTS "Users can read own linked accounts" ON public.linked_accounts;
CREATE POLICY "Users can read own linked accounts" ON public.linked_accounts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can unlink own linked accounts" ON public.linked_accounts;
CREATE POLICY "Users can unlink own linked accounts" ON public.linked_accounts
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.linked_accounts FROM anon;
REVOKE INSERT, UPDATE ON TABLE public.linked_accounts FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.linked_accounts TO authenticated;

-- Unlinking clears the denormalized steam_* columns on profiles (clients can no longer write them).
CREATE OR REPLACE FUNCTION private.clear_profile_steam_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.provider = 'steam' THEN
    UPDATE public.profiles
    SET steam_id = NULL, steam_persona = NULL, steam_avatar_url = NULL, steam_linked_at = NULL
    WHERE id = OLD.user_id AND steam_id IS NOT DISTINCT FROM OLD.provider_user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS linked_accounts_clear_profile_steam ON public.linked_accounts;
CREATE TRIGGER linked_accounts_clear_profile_steam
  AFTER DELETE ON public.linked_accounts
  FOR EACH ROW EXECUTE FUNCTION private.clear_profile_steam_link();

-- ---------------------------------------------------------------------------
-- 4. report_images: owners may add pending images and edit/delete them while pending.
-- Approval stays with moderators (moderate_report_images RPC / moderator policies).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage images on their reports" ON public.report_images;

DROP POLICY IF EXISTS "Users can read images on their reports" ON public.report_images;
CREATE POLICY "Users can read images on their reports" ON public.report_images
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_images.report_id AND r.user_id = (SELECT auth.uid())
  ));
DROP POLICY IF EXISTS "Users can add pending images to their reports" ON public.report_images;
CREATE POLICY "Users can add pending images to their reports" ON public.report_images
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending' AND moderated_by IS NULL AND moderated_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_images.report_id AND r.user_id = (SELECT auth.uid())
    )
  );
DROP POLICY IF EXISTS "Users can edit their pending images" ON public.report_images;
CREATE POLICY "Users can edit their pending images" ON public.report_images
  FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_images.report_id AND r.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    status = 'pending' AND moderated_by IS NULL AND moderated_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_images.report_id AND r.user_id = (SELECT auth.uid())
    )
  );
DROP POLICY IF EXISTS "Users can delete images on their reports" ON public.report_images;
CREATE POLICY "Users can delete images on their reports" ON public.report_images
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_images.report_id AND r.user_id = (SELECT auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 5. report_votes: no self-votes; vote must be -1 or 1 on insert and update.
-- ---------------------------------------------------------------------------
-- The owner check reads public.reports under the caller's RLS; owners can always read their
-- own reports (any status), so the subquery sees exactly the reports that would be self-votes.
DROP POLICY IF EXISTS "Users can vote on reports" ON public.report_votes;
DROP POLICY IF EXISTS "Users can update own report votes" ON public.report_votes;
DROP POLICY IF EXISTS "Users can delete own report votes" ON public.report_votes;
DROP POLICY IF EXISTS "Users can see their own votes" ON public.report_votes;

CREATE POLICY "Users can see their own votes" ON public.report_votes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can vote on other users' reports" ON public.report_votes;
CREATE POLICY "Users can vote on other users' reports" ON public.report_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND vote IN (-1, 1)
    AND NOT EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_votes.report_id AND r.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "Users can update own report votes" ON public.report_votes
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND vote IN (-1, 1)
    AND NOT EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_votes.report_id AND r.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "Users can delete own report votes" ON public.report_votes
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. reports: owner edits go through updateReportAction (service role, validated).
-- The client policy allowed raw edits of every column on pending reports (USING doubled as the
-- check, so status stayed 'pending', but vote counters and FPS could be set to anything).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own pending reports" ON public.reports;

-- ---------------------------------------------------------------------------
-- 7. Function EXECUTE: internal helpers are not callable through the API.
-- Trigger functions do not need EXECUTE to fire. Functions used inside RLS policies
-- (is_admin, is_moderator_or_admin) and the sign-up check (is_username_taken) stay callable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION
  public.handle_new_user(),
  public.handle_updated_at(),
  public.prevent_client_profile_role_change(),
  public.update_game_report_count(),
  public.update_helpful_votes(),
  private.after_report_changed(),
  private.after_report_vote_changed(),
  private.credibility_badge_for_score(integer),
  private.recompute_profile_reputation(uuid),
  private.recompute_report_vote_totals(uuid),
  private.touch_report_vote(),
  private.clear_profile_steam_link()
FROM authenticated;

GRANT EXECUTE ON FUNCTION public.is_username_taken(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_moderator_or_admin() TO anon, authenticated;
