-- RLS / privilege behavior tests as anon, owner (alice), other user (bob) and moderator (mia).
-- Run with: psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/policies.sql
-- Everything runs in one transaction that is rolled back; each check raises on failure.
\set ON_ERROR_STOP on
BEGIN;

-- Fixtures (as postgres).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000000a11c', 'alice@example.test', '{"username": "alice"}'),
  ('00000000-0000-0000-0000-000000000b0b', 'bob@example.test', '{"username": "bob"}'),
  ('00000000-0000-0000-0000-00000000000d', 'mia@example.test', '{"username": "mia"}');
UPDATE public.profiles SET role = 'moderator' WHERE id = '00000000-0000-0000-0000-00000000000d';
UPDATE public.profiles SET steam_id = '76561190000000001', steam_persona = 'alice_steam', main_cpu = 'Ryzen 5' WHERE id = '00000000-0000-0000-0000-00000000a11c';
INSERT INTO public.games (id, slug, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'policy-game', 'Policy Game');
INSERT INTO public.reports (id, game_id, user_id, game_name, cpu, gpu, ram, resolution, settings_preset, avg_fps, performance_tier, status) VALUES
  ('00000000-0000-0000-0000-0000000a1a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000a11c', 'Policy Game', 'CPU', 'GPU', 16, '1080p', 'High', 60, 'Good', 'approved'),
  ('00000000-0000-0000-0000-0000000a1a02', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000a11c', 'Policy Game', 'CPU', 'GPU', 16, '1080p', 'High', 30, 'Struggling', 'pending'),
  ('00000000-0000-0000-0000-0000000b0b01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000b0b', 'Policy Game', 'CPU', 'GPU', 16, '1080p', 'High', 90, 'Excellent', 'approved');
INSERT INTO public.report_images (id, report_id, image_url, status) VALUES
  ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000a1a01', 'https://img.test/approved.webp', 'approved'),
  ('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000a1a01', 'https://img.test/pending.webp', 'pending');
INSERT INTO public.linked_accounts (user_id, provider, provider_user_id) VALUES ('00000000-0000-0000-0000-00000000a11c', 'steam', '76561190000000001');


-- ===== anon =====
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SET LOCAL ROLE anon;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT id, username, avatar_url, credibility_badge, reputation_score FROM public.profiles';
  GET DIAGNOSTICS n = ROW_COUNT;
  
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "anon reads public profile columns": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.profiles WHERE id IN ('00000000-0000-0000-0000-00000000a11c','00000000-0000-0000-0000-000000000b0b','00000000-0000-0000-0000-00000000000d')) s) = 3) THEN RAISE EXCEPTION 'assertion failed: anon sees all 3 fixture profiles by public columns (expected 3)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT role FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read profiles.role';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT steam_id FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read profiles.steam_id';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT main_cpu FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read profiles.main_cpu';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT preferred_resolution FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read profiles.preferred_resolution';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT * FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read profiles via *';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT * FROM public.get_my_profile()';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot call get_my_profile';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT * FROM public.linked_accounts';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot read linked_accounts';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.reports WHERE game_id = '00000000-0000-0000-0000-0000000000f1') s) = 2) THEN RAISE EXCEPTION 'assertion failed: anon sees only approved reports (expected 2)'; END IF;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.report_images WHERE report_id = '00000000-0000-0000-0000-0000000a1a01') s) = 1) THEN RAISE EXCEPTION 'assertion failed: anon sees only approved images (expected 1)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000b0b01'', ''00000000-0000-0000-0000-00000000a11c'', 1)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot vote';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.profiles (id, username) VALUES (gen_random_uuid(), ''x'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot insert profiles';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.games SET name = ''x''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot update games';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'TRUNCATE public.report_votes';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot truncate';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT private.recompute_profile_reputation(''00000000-0000-0000-0000-00000000a11c'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot call private reputation helper';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT public.handle_new_user()';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: anon cannot call handle_new_user';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT public.is_username_taken(''alice'')';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): anon can check username availability', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "anon can check username availability": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  IF NOT (public.is_username_taken('alice')) THEN RAISE EXCEPTION 'assertion failed: is_username_taken sees existing usernames'; END IF;
END $t$;

-- ===== alice (owner) =====
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000a11c", "role": "authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF NOT ((SELECT role = 'user' AND steam_id = '76561190000000001' AND main_cpu = 'Ryzen 5' FROM public.get_my_profile()) AND (SELECT count(*) FROM public.get_my_profile()) = 1) THEN RAISE EXCEPTION 'assertion failed: get_my_profile returns own private columns'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT role FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot read other users role directly';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.profiles SET username = ''alice2'', main_cpu = ''Ryzen 7'', main_ram = 32 WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner updates own username and rig', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner updates own username and rig": %', SQLERRM;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.profiles SET main_cpu = ''R5'', main_gpu = ''G'', main_ram = 16, preferred_resolution = ''1080p'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner saves rig with UPDATE (app path)', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner saves rig with UPDATE (app path)": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.profiles (id, main_cpu) VALUES (''00000000-0000-0000-0000-00000000a11c'', ''R5'') ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, main_cpu = EXCLUDED.main_cpu';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: rig upsert is denied (ON CONFLICT DO UPDATE needs SELECT on rig columns); app must use UPDATE';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'INSERT INTO public.profiles (id, username) VALUES (''00000000-0000-0000-0000-00000000a11c'', ''alice3'') ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, username = EXCLUDED.username';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner upserts own profile like PostgREST', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner upserts own profile like PostgREST": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET reputation_score = 9999 WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.reputation_score';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET credibility_badge = ''Legend'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.credibility_badge';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET reports_submitted = 50 WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.reports_submitted';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET votes_cast = 50 WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.votes_cast';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET steam_id = ''7656119999'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.steam_id';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET avatar_url = ''https://evil.test/a.png'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.avatar_url';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.profiles SET role = ''admin'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot update profiles.role';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.profiles (id, reputation_score) VALUES (''00000000-0000-0000-0000-00000000a11c'', 9999) ON CONFLICT (id) DO UPDATE SET reputation_score = EXCLUDED.reputation_score';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot upsert reputation';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.reports WHERE id = '00000000-0000-0000-0000-0000000a1a02') s) = 1) THEN RAISE EXCEPTION 'assertion failed: owner sees own pending report (expected 1)'; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.reports SET status = ''approved'' WHERE id = ''00000000-0000-0000-0000-0000000a1a02''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): owner cannot approve own pending report', n; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.reports (game_id, user_id, game_name, cpu, gpu, ram, resolution, settings_preset, avg_fps, performance_tier, status) VALUES (''00000000-0000-0000-0000-0000000000f1'', ''00000000-0000-0000-0000-00000000a11c'', ''x'', ''c'', ''g'', 16, ''1080p'', ''High'', 1, ''Good'', ''approved'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot insert reports directly';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000a1a01'', ''00000000-0000-0000-0000-00000000a11c'', 1)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot self-vote (insert)';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000b0b01'', ''00000000-0000-0000-0000-00000000a11c'', 1) ON CONFLICT (report_id, user_id) DO UPDATE SET vote = EXCLUDED.vote';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner votes on another users report', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner votes on another users report": %', SQLERRM;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.report_votes SET vote = -1 WHERE report_id = ''00000000-0000-0000-0000-0000000b0b01'' AND user_id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner changes own vote', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner changes own vote": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.report_votes SET vote = 5 WHERE report_id = ''00000000-0000-0000-0000-0000000b0b01'' AND user_id = ''00000000-0000-0000-0000-00000000a11c''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: vote must be -1 or 1';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000b0b01'', ''00000000-0000-0000-0000-000000000b0b'', 1)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: cannot vote as another user';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.report_images WHERE report_id = '00000000-0000-0000-0000-0000000a1a01') s) = 2) THEN RAISE EXCEPTION 'assertion failed: owner sees own images at any status (expected 2)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_images (report_id, image_url, status) VALUES (''00000000-0000-0000-0000-0000000a1a02'', ''https://img.test/x.webp'', ''approved'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot add an approved image';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'INSERT INTO public.report_images (report_id, image_url) VALUES (''00000000-0000-0000-0000-0000000a1a02'', ''https://img.test/new.webp'')';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner adds a pending image', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner adds a pending image": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.report_images SET status = ''approved'' WHERE id = ''00000000-0000-0000-0000-0000000e0002''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot self-approve pending image';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.report_images SET caption = ''c'' WHERE id = ''00000000-0000-0000-0000-0000000e0002''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): owner edits caption of pending image', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "owner edits caption of pending image": %', SQLERRM;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.report_images SET image_url = ''https://evil.test/x.png'' WHERE id = ''00000000-0000-0000-0000-0000000e0001''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): owner cannot edit an approved image', n; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_images (report_id, image_url) VALUES (''00000000-0000-0000-0000-0000000b0b01'', ''https://img.test/y.webp'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot add images to others reports';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.linked_accounts) s) = 1) THEN RAISE EXCEPTION 'assertion failed: owner reads own linked account (expected 1)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.linked_accounts SET provider_user_id = ''76561199999999999''';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot edit a Steam link';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT 1 FROM public.moderation_log) s) = 0) THEN RAISE EXCEPTION 'assertion failed: owner sees no moderation log rows (expected 0)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT public.moderate_reports(ARRAY[''00000000-0000-0000-0000-0000000a1a02'']::uuid[], ''approved'', NULL, NULL)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot run moderation RPC';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT private.recompute_report_vote_totals(''00000000-0000-0000-0000-0000000a1a01'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot call internal trigger helper';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT * FROM public.report_edits';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot read the edit log';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_edits (report_id, user_id) VALUES (''00000000-0000-0000-0000-0000000a1a01'', ''00000000-0000-0000-0000-00000000a11c'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: owner cannot forge edit log rows';
END $t$;

-- ===== bob (other user) =====
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000b0b", "role": "authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.reports WHERE id = '00000000-0000-0000-0000-0000000a1a02') s) = 0) THEN RAISE EXCEPTION 'assertion failed: other user does not see alice pending report (expected 0)'; END IF;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.report_images WHERE report_id = '00000000-0000-0000-0000-0000000a1a01') s) = 1) THEN RAISE EXCEPTION 'assertion failed: other user sees only approved images of alice (expected 1)'; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.profiles SET username = ''pwned'' WHERE id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): other user cannot update alice profile', n; END IF;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.linked_accounts) s) = 0) THEN RAISE EXCEPTION 'assertion failed: other user cannot see alice linked account (expected 0)'; END IF;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.linked_accounts (user_id, provider, provider_user_id) VALUES (''00000000-0000-0000-0000-000000000b0b'', ''steam'', ''76561199999999999'')';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: user without a link cannot forge a Steam link';
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'DELETE FROM public.linked_accounts WHERE user_id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): other user cannot delete alice link', n; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'DELETE FROM public.report_images WHERE report_id = ''00000000-0000-0000-0000-0000000a1a01''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): other user cannot delete alice images', n; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'UPDATE public.report_votes SET vote = 1 WHERE user_id = ''00000000-0000-0000-0000-00000000a11c''';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'expected 0 rows (%): other user cannot change alice vote', n; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000a1a01'', ''00000000-0000-0000-0000-000000000b0b'', 1)';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 rows (got %): other user votes on alice report', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "other user votes on alice report": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.report_votes (report_id, user_id, vote) VALUES (''00000000-0000-0000-0000-0000000b0b01'', ''00000000-0000-0000-0000-000000000b0b'', 1)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: other user cannot self-vote either';
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT id FROM public.get_my_profile()) = '00000000-0000-0000-0000-000000000b0b') THEN RAISE EXCEPTION 'assertion failed: get_my_profile returns only own row'; END IF;
END $t$;

-- ===== mia (moderator) =====
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF NOT ((SELECT role FROM public.get_my_profile()) = 'moderator') THEN RAISE EXCEPTION 'assertion failed: moderator role visible via get_my_profile'; END IF;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.reports WHERE game_id = '00000000-0000-0000-0000-0000000000f1') s) = 3) THEN RAISE EXCEPTION 'assertion failed: moderator reads all reports incl. pending (expected 3)'; END IF;
END $t$;
DO $t$
BEGIN
  IF NOT ((SELECT count(*) FROM (SELECT id FROM public.report_images WHERE report_id = '00000000-0000-0000-0000-0000000a1a01') s) = 2) THEN RAISE EXCEPTION 'assertion failed: moderator reads pending images (expected 2)'; END IF;
END $t$;
DO $t$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT * FROM public.moderation_log';
  GET DIAGNOSTICS n = ROW_COUNT;
  
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'unexpected error in "moderator can read moderation log": %', SQLERRM;
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT steam_id FROM public.profiles';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: moderator still cannot read profile private columns directly';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT public.moderate_reports(ARRAY[''00000000-0000-0000-0000-0000000a1a02'']::uuid[], ''approved'', NULL, NULL)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: moderator cannot call moderation RPC directly (service role only)';
END $t$;
DO $t$
BEGIN
  BEGIN
    EXECUTE 'SELECT public.delete_reports(ARRAY[''00000000-0000-0000-0000-0000000a1a02'']::uuid[], NULL)';
  EXCEPTION
    -- Only denials count: privilege/RLS (42501), CHECK (23514), trigger RAISE (P0001).
    -- Any other error (typo, missing column) propagates and fails the run.
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected failure: moderator cannot call delete RPC directly (service role only)';
END $t$;

-- ===== side effects (as postgres) =====
RESET ROLE;
DO $t$
BEGIN
  IF NOT ((SELECT vote_score FROM public.reports WHERE id = '00000000-0000-0000-0000-0000000a1a01') = 1) THEN RAISE EXCEPTION 'assertion failed: votes recomputed after vote writes'; END IF;
END $t$;
DELETE FROM public.linked_accounts WHERE user_id = '00000000-0000-0000-0000-00000000a11c';
DO $t$
BEGIN
  IF NOT ((SELECT steam_id IS NULL AND steam_persona IS NULL FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000a11c')) THEN RAISE EXCEPTION 'assertion failed: unlink clears profile steam columns'; END IF;
END $t$;

ROLLBACK;
\echo 'policies: all checks passed'
