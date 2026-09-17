-- RunDB: real admin moderation (reports, report images, hardware aliases, bulk actions).
-- Safe to re-run on existing Supabase projects. Apply in the SQL Editor after
-- schema.sql, incremental-security-rls.sql, incremental-rls-performance.sql and
-- incremental-hardware-catalog.sql (needs public.is_moderator_or_admin(),
-- public.report_images and public.hardware_aliases).
--
-- What this adds:
-- 1. report_images moderation state (status / moderated_by / moderated_at) + RLS so
--    only approved images are public and moderators can review everything.
-- 2. public.is_admin() helper (admin-only destructive actions).
-- 3. public.moderation_log audit table (append-only, written by the RPCs below).
-- 4. SECURITY DEFINER RPCs for single + bulk moderation:
--      moderate_reports(uuid[], report_status, text, uuid)
--      moderate_report_images(uuid[], text, uuid)
--      delete_report_images(uuid[], uuid)
--      delete_reports(uuid[], uuid)
--    Each RPC resolves the acting moderator as:
--      * service_role caller  -> p_actor (the server action already verified the
--                                session via getStaffAccess(), which also honours
--                                the ADMIN_EMAILS allowlist that has no DB role)
--      * authenticated caller -> auth.uid(), and only if is_moderator_or_admin()
--                                (or is_admin() for destructive RPCs)
--    anon callers are never allowed (EXECUTE is revoked from anon).

-- ---------------------------------------------------------------------------
-- 1. report_images moderation columns + policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.report_images
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_report_images_status_created
  ON public.report_images (status, created_at DESC);

ALTER TABLE public.report_images ENABLE ROW LEVEL SECURITY;

-- Owners keep managing their own images (existing policy, re-created with (select auth.uid())).
DROP POLICY IF EXISTS "Users can manage images on their reports" ON public.report_images;
CREATE POLICY "Users can manage images on their reports" ON public.report_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.reports
      WHERE reports.id = report_images.report_id
        AND reports.user_id = (SELECT auth.uid())
    )
  );

-- Only approved images are visible to the public (pending/rejected never leak).
DROP POLICY IF EXISTS "Approved report images are publicly readable" ON public.report_images;
CREATE POLICY "Approved report images are publicly readable" ON public.report_images
  FOR SELECT USING (status = 'approved');

DROP POLICY IF EXISTS "Moderators can read all report images" ON public.report_images;
CREATE POLICY "Moderators can read all report images" ON public.report_images
  FOR SELECT USING ((SELECT public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators can moderate report images" ON public.report_images;
CREATE POLICY "Moderators can moderate report images" ON public.report_images
  FOR UPDATE USING ((SELECT public.is_moderator_or_admin()))
  WITH CHECK ((SELECT public.is_moderator_or_admin()));

GRANT SELECT ON public.report_images TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.report_images TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admin helper (mirrors is_moderator_or_admin, admin only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
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
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Append-only moderation audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moderation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('report', 'report_image', 'hardware_alias', 'game')),
  target_id uuid,
  action text NOT NULL,
  previous_status text,
  new_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_log_created ON public.moderation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_log_target ON public.moderation_log (target_type, target_id);

ALTER TABLE public.moderation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Moderators can read the moderation log" ON public.moderation_log;
CREATE POLICY "Moderators can read the moderation log" ON public.moderation_log
  FOR SELECT USING ((SELECT public.is_moderator_or_admin()));

-- No INSERT/UPDATE/DELETE policies on purpose: rows are written only by the
-- SECURITY DEFINER RPCs below (and by service_role from server code).
REVOKE ALL ON public.moderation_log FROM anon, authenticated;
GRANT SELECT ON public.moderation_log TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Actor resolution shared by the RPCs
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

-- Returns the acting user id or raises. p_require_admin restricts to admins.
CREATE OR REPLACE FUNCTION private.resolve_moderation_actor(p_actor uuid, p_require_admin boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), current_user::text);
  v_uid uuid := auth.uid();
BEGIN
  IF v_role = 'service_role' THEN
    -- Trusted server code (getStaffAccess() already authorised this actor).
    IF p_actor IS NULL THEN
      RAISE EXCEPTION 'moderation actor is required for service_role calls' USING ERRCODE = '22023';
    END IF;
    RETURN p_actor;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_require_admin THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.is_moderator_or_admin() THEN
    RAISE EXCEPTION 'moderator or admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_moderation_actor(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Report moderation (single + bulk)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderate_reports(
  p_report_ids uuid[],
  p_status report_status,
  p_notes text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_updated integer := 0;
BEGIN
  v_actor := private.resolve_moderation_actor(p_actor, false);

  IF p_report_ids IS NULL OR cardinality(p_report_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_report_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 reports can be moderated per call' USING ERRCODE = '22023';
  END IF;

  WITH changed AS (
    UPDATE public.reports r
    SET status = p_status,
        moderated_by = v_actor,
        moderated_at = now(),
        moderator_notes = CASE WHEN p_notes IS NULL THEN r.moderator_notes ELSE v_notes END
    FROM (SELECT id, status AS previous_status FROM public.reports WHERE id = ANY (p_report_ids)) prev
    WHERE r.id = prev.id
    RETURNING r.id, prev.previous_status
  ),
  logged AS (
    INSERT INTO public.moderation_log (actor_id, target_type, target_id, action, previous_status, new_status, notes)
    SELECT v_actor, 'report', changed.id, 'set_status', changed.previous_status::text, p_status::text, v_notes
    FROM changed
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM logged;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_reports(uuid[], report_status, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_reports(uuid[], report_status, text, uuid) TO authenticated, service_role;

-- Admin-only hard delete (spam / doxxing). Cascades votes + images.
CREATE OR REPLACE FUNCTION public.delete_reports(
  p_report_ids uuid[],
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_deleted integer := 0;
BEGIN
  v_actor := private.resolve_moderation_actor(p_actor, true);

  IF p_report_ids IS NULL OR cardinality(p_report_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_report_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 reports can be deleted per call' USING ERRCODE = '22023';
  END IF;

  WITH removed AS (
    DELETE FROM public.reports
    WHERE id = ANY (p_report_ids)
    RETURNING id, status
  ),
  logged AS (
    INSERT INTO public.moderation_log (actor_id, target_type, target_id, action, previous_status, new_status)
    SELECT v_actor, 'report', removed.id, 'delete', removed.status::text, NULL
    FROM removed
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM logged;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_reports(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_reports(uuid[], uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Report image moderation (single + bulk) and admin delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderate_report_images(
  p_image_ids uuid[],
  p_status text,
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_updated integer := 0;
BEGIN
  v_actor := private.resolve_moderation_actor(p_actor, false);

  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid image status %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_image_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 images can be moderated per call' USING ERRCODE = '22023';
  END IF;

  WITH changed AS (
    UPDATE public.report_images i
    SET status = p_status,
        moderated_by = v_actor,
        moderated_at = now()
    FROM (SELECT id, status AS previous_status FROM public.report_images WHERE id = ANY (p_image_ids)) prev
    WHERE i.id = prev.id
    RETURNING i.id, prev.previous_status
  ),
  logged AS (
    INSERT INTO public.moderation_log (actor_id, target_type, target_id, action, previous_status, new_status)
    SELECT v_actor, 'report_image', changed.id, 'set_status', changed.previous_status, p_status
    FROM changed
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM logged;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_report_images(uuid[], text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_report_images(uuid[], text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_report_images(
  p_image_ids uuid[],
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_deleted integer := 0;
BEGIN
  v_actor := private.resolve_moderation_actor(p_actor, true);

  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_image_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 images can be deleted per call' USING ERRCODE = '22023';
  END IF;

  WITH removed AS (
    DELETE FROM public.report_images
    WHERE id = ANY (p_image_ids)
    RETURNING id, status
  ),
  logged AS (
    INSERT INTO public.moderation_log (actor_id, target_type, target_id, action, previous_status, new_status)
    SELECT v_actor, 'report_image', removed.id, 'delete', removed.status, NULL
    FROM removed
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM logged;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_report_images(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_report_images(uuid[], uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Hardware aliases: keep existing moderator RLS, add admin-only delete + audit
-- ---------------------------------------------------------------------------
-- Existing policies (incremental-hardware-catalog.sql / incremental-rls-performance.sql)
-- let moderators insert/update. Deletion is tightened to admins to match the UI.
DROP POLICY IF EXISTS "Moderators and admins can delete hardware aliases" ON public.hardware_aliases;
DROP POLICY IF EXISTS "Admins can delete hardware aliases" ON public.hardware_aliases;
CREATE POLICY "Admins can delete hardware aliases" ON public.hardware_aliases
  FOR DELETE USING ((SELECT public.is_admin()));

-- Case-insensitive uniqueness so "RTX 4090" and "rtx 4090" cannot both exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hardware_aliases_raw_unique_ci
  ON public.hardware_aliases (lower(raw_string));

GRANT SELECT ON public.hardware_aliases TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hardware_aliases TO authenticated;
