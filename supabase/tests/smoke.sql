-- Smoke check for a database built from supabase/migrations (CI job `db`).
-- Run with: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
-- Any failed check raises an exception, so psql exits non-zero.
-- Behavior checks run inside a transaction that is rolled back.

\set ON_ERROR_STOP on

-- 1. Expected tables exist.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY[
    'games', 'game_ingest_queue', 'game_media', 'profiles', 'user_rigs', 'reports',
    'report_votes', 'report_images', 'hardware_aliases', 'hardware_catalog',
    'linked_accounts', 'moderation_log'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing tables: %', missing;
  END IF;
END $$;

-- 2. RLS is enabled on every table in public.
DO $$
DECLARE
  no_rls text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO no_rls
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF no_rls IS NOT NULL THEN
    RAISE EXCEPTION 'RLS disabled on: %', no_rls;
  END IF;
END $$;

-- 3. Functions the app and policies depend on exist.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(f, ', ') INTO missing
  FROM unnest(ARRAY[
    'public.is_username_taken(text)',
    'public.is_moderator_or_admin()',
    'public.is_admin()',
    'public.handle_new_user()',
    'public.moderate_reports(uuid[], public.report_status, text, uuid)',
    'public.delete_reports(uuid[], uuid)',
    'public.moderate_report_images(uuid[], text, uuid)',
    'public.delete_report_images(uuid[], uuid)',
    'private.resolve_moderation_actor(uuid, boolean)',
    'private.recompute_report_vote_totals(uuid)',
    'private.recompute_profile_reputation(uuid)',
    'public.get_my_profile()'
  ]) AS f
  WHERE to_regprocedure(f) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing functions: %', missing;
  END IF;
END $$;

-- 4. Key policies and triggers exist.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(format('%s: %s', tbl, pol), '; ') INTO missing
  FROM (VALUES
    ('reports', 'Approved reports are publicly readable'),
    ('reports', 'Users can read their own reports'),
    ('reports', 'Moderators can read all reports for moderation'),
    ('report_images', 'Approved report images are publicly readable'),
    ('moderation_log', 'Moderators can read the moderation log'),
    ('profiles', 'Users can update own profile'),
    ('linked_accounts', 'Users can read own linked accounts'),
    ('linked_accounts', 'Users can unlink own linked accounts'),
    ('report_votes', 'Users can vote on other users'' reports')
  ) AS expected(tbl, pol)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = expected.tbl AND p.policyname = expected.pol
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing policies: %', missing;
  END IF;

  SELECT string_agg(trg, ', ') INTO missing
  FROM unnest(ARRAY[
    'on_auth_user_created', 'profiles_prevent_client_role_change', 'trg_reports_report_count',
    'reports_recompute_profile_reputation', 'report_votes_recompute_reputation',
    'linked_accounts_clear_profile_steam'
  ]) AS trg
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = trg AND NOT t.tgisinternal);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing triggers: %', missing;
  END IF;
END $$;

-- 5. Privilege shape: clients cannot insert reports or call moderation RPCs anonymously.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.reports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.reports', 'INSERT') THEN
    RAISE EXCEPTION 'anon/authenticated must not have INSERT on public.reports';
  END IF;
  IF has_function_privilege('anon', 'public.moderate_reports(uuid[], public.report_status, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_reports(uuid[], uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute moderation RPCs';
  END IF;
  IF has_table_privilege('anon', 'public.moderation_log', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read public.moderation_log';
  END IF;
END $$;

-- 5b. Privilege guardrails (enforced for every table/function, including future ones).
-- A new table or function created under Supabase default privileges fails here until its
-- grants are made explicit in its migration.
DO $$
DECLARE
  bad text;
BEGIN
  -- No API role may TRUNCATE / TRIGGER / REFERENCES / MAINTAIN any public table.
  SELECT string_agg(format('%s:%s:%s', r, c.relname, priv), ', ') INTO bad
  FROM pg_class c
  CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r
  CROSS JOIN unnest(ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']) AS priv
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
    AND has_table_privilege(r, c.oid, priv);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'API roles must not hold: %', bad;
  END IF;

  -- anon is read-only on every public table.
  SELECT string_agg(format('%s:%s', c.relname, priv), ', ') INTO bad
  FROM pg_class c
  CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS priv
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
    AND has_table_privilege('anon', c.oid, priv);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon must not write: %', bad;
  END IF;

  -- Private profile columns are not readable by API roles (use get_my_profile()).
  SELECT string_agg(format('%s:%s', r, col), ', ') INTO bad
  FROM unnest(ARRAY['anon', 'authenticated']) AS r
  CROSS JOIN unnest(ARRAY['role', 'steam_id', 'steam_persona', 'steam_avatar_url', 'steam_linked_at',
                          'main_cpu', 'main_gpu', 'main_ram', 'preferred_resolution']) AS col
  WHERE has_column_privilege(r, 'public.profiles', col, 'SELECT');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'private profile columns readable by: %', bad;
  END IF;

  -- Clients cannot write server-owned profile columns.
  SELECT string_agg(format('%s:%s', col, priv), ', ') INTO bad
  FROM unnest(ARRAY['role', 'reputation_score', 'credibility_badge', 'reports_submitted', 'votes_cast',
                    'avatar_url', 'steam_id', 'steam_persona', 'steam_avatar_url', 'steam_linked_at']) AS col
  CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS priv
  WHERE has_column_privilege('authenticated', 'public.profiles', col, priv);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can write server-owned profile columns: %', bad;
  END IF;

  -- Clients cannot create or edit linked accounts (verified server-side only).
  IF has_table_privilege('authenticated', 'public.linked_accounts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.linked_accounts', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated must not insert/update public.linked_accounts';
  END IF;

  -- anon may execute only these app functions (extension functions are excluded).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
  FROM pg_proc p
  WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.oid::regprocedure::text NOT IN ('is_username_taken(text)', 'is_admin()', 'is_moderator_or_admin()');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon can execute: %', bad;
  END IF;

  -- authenticated may execute only these app functions.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
  FROM pg_proc p
  WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.oid::regprocedure::text NOT IN (
      'is_username_taken(text)', 'is_admin()', 'is_moderator_or_admin()', 'get_my_profile()',
      'moderate_reports(uuid[],report_status,text,uuid)', 'delete_reports(uuid[],uuid)',
      'moderate_report_images(uuid[],text,uuid)', 'delete_report_images(uuid[],uuid)'
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can execute: %', bad;
  END IF;
END $$;

-- 6. Behavior (rolled back): signup trigger, report_count trigger, public RLS on reports.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'smoke@example.test', '{"username": "smoke_user"}');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '00000000-0000-0000-0000-0000000000a1' AND username = 'smoke_user' AND role = 'user'
  ) THEN
    RAISE EXCEPTION 'handle_new_user did not create the expected profile';
  END IF;
END $$;

INSERT INTO public.games (id, slug, name)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'smoke-game', 'Smoke Game');

INSERT INTO public.reports (game_id, user_id, game_name, cpu, gpu, ram, resolution, settings_preset, avg_fps, performance_tier, status)
VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Smoke Game', 'CPU', 'GPU', 16, '1080p', 'High', 60, 'Good', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Smoke Game', 'CPU', 'GPU', 16, '1080p', 'High', 30, 'Struggling', 'pending');

DO $$
BEGIN
  IF (SELECT report_count FROM public.games WHERE id = '00000000-0000-0000-0000-0000000000b1') <> 1 THEN
    RAISE EXCEPTION 'report_count trigger should count only approved reports';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.reports WHERE game_id = '00000000-0000-0000-0000-0000000000b1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'anon should see only the approved report, saw %', n;
  END IF;
END $$;
RESET ROLE;

ROLLBACK;

\echo 'smoke: all checks passed'
