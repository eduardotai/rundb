-- RunDB Production Schema
-- Consolidated from Master Implementation Plan (approved)
-- Run this in Supabase SQL Editor after creating your project.

-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE performance_tier AS ENUM ('Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable');
CREATE TYPE graphics_preset AS ENUM ('Low', 'Medium', 'High', 'Ultra', 'Custom');
CREATE TYPE report_status AS ENUM ('pending', 'approved', 'rejected', 'flagged');

-- ============================================
-- TABLES
-- ============================================

-- Games
CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  cover_url text,
  genres text[] NOT NULL DEFAULT '{}',
  release_year int,
  developer text,
  publisher text,
  official_min_reqs jsonb,
  official_rec_reqs jsonb,
  igdb_id text,
  steam_app_id text,
  ingest_status text CHECK (ingest_status IN ('skeleton', 'enriched', 'failed')),
  last_ingested_at timestamptz,
  report_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ingest queue for two-phase catalog growth (ProtonDB seed → background enrich)
CREATE TABLE game_ingest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  steam_app_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  priority int NOT NULL DEFAULT 0,
  report_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  avatar_url text,
  main_cpu text,
  main_gpu text,
  main_ram integer CHECK (main_ram > 0 AND main_ram <= 256),
  preferred_resolution text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Usernames must be unique across accounts (case-insensitive; nulls for guests are fine).
-- This prevents two users from registering the same display name at signup time.
-- Use a unique index on the expression (the supported way in Postgres for this).
DROP INDEX IF EXISTS profiles_username_unique;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique 
  ON public.profiles (lower(username));

-- User Rigs (current saved hardware for compatibility checker)
CREATE TABLE user_rigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cpu text NOT NULL,
  gpu text NOT NULL,
  ram integer NOT NULL CHECK (ram > 0 AND ram <= 256),
  resolution text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Reports (core entity)
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Denormalized for performance
  game_name text NOT NULL,

  -- Hardware
  cpu text NOT NULL,
  gpu text NOT NULL,
  ram integer NOT NULL CHECK (ram >= 2 AND ram <= 256),
  ram_speed text,
  resolution text NOT NULL,
  refresh_rate integer CHECK (refresh_rate IS NULL OR refresh_rate BETWEEN 30 AND 1000),

  -- Settings & performance
  settings_preset graphics_preset NOT NULL,
  custom_settings_notes text,
  avg_fps numeric(6,1) NOT NULL CHECK (avg_fps > 0 AND avg_fps <= 2000),
  fps_1_percent_low numeric(6,1) CHECK (fps_1_percent_low IS NULL OR fps_1_percent_low > 0),
  performance_tier performance_tier NOT NULL,

  -- User content
  notes text,
  tweaks text,
  issues text,
  driver_version text,

  -- Moderation & engagement
  status report_status NOT NULL DEFAULT 'pending',
  helpful_votes integer NOT NULL DEFAULT 0 CHECK (helpful_votes >= 0),
  moderated_by uuid REFERENCES auth.users(id),
  moderated_at timestamptz,
  moderator_notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Votes (for real upvoting)
CREATE TABLE report_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id)
);

-- Report images (user-submitted proof)
CREATE TABLE report_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hardware normalization (for better similarity matching later)
CREATE TABLE hardware_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_string text UNIQUE NOT NULL,
  canonical text NOT NULL,
  vendor text,
  series text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for aliases (used in normalization / combobox fallback)
CREATE INDEX idx_hardware_aliases_raw ON hardware_aliases (lower(raw_string));
CREATE INDEX idx_hardware_aliases_canonical ON hardware_aliases (canonical);

-- ============================================
-- INDEXES (critical for performance)
-- ============================================
CREATE INDEX idx_reports_game_created ON reports (game_id, created_at DESC);
CREATE INDEX idx_reports_game_tier ON reports (game_id, performance_tier);
CREATE INDEX idx_reports_gpu ON reports (lower(gpu));
CREATE INDEX idx_reports_cpu ON reports (lower(cpu));
CREATE INDEX idx_reports_resolution ON reports (resolution);
CREATE INDEX idx_reports_status ON reports (status) WHERE status = 'approved';

CREATE INDEX idx_games_slug ON games (slug);
CREATE INDEX idx_games_ingest_status ON games (ingest_status);
CREATE INDEX idx_games_report_count ON games (report_count DESC, name ASC);
CREATE INDEX idx_queue_status_priority ON game_ingest_queue (status, priority);

-- Trigram search for /games browse at scale (requires pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_games_name_trgm ON games USING gin (name gin_trgm_ops);

-- ============================================
-- TRIGGERS & FUNCTIONS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER game_ingest_queue_updated_at BEFORE UPDATE ON game_ingest_queue FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Denormalized public approved-report counts for catalog browse sorting.
CREATE OR REPLACE FUNCTION public.recompute_game_report_count(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_game_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE games
  SET report_count = (
    SELECT COUNT(*)::int
    FROM reports
    WHERE game_id = p_game_id AND status = 'approved'
  )
  WHERE id = p_game_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_game_report_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE TRIGGER reports_game_report_count
AFTER INSERT OR UPDATE OF game_id, status OR DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION public.update_game_report_count();

-- Role grants are privileged. Authenticated clients may update profile metadata,
-- but profile.role must only change through trusted SQL/service-role contexts.
CREATE OR REPLACE FUNCTION public.prevent_client_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.role() = 'service_role' OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'profile role cannot be changed by client sessions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_prevent_client_role_change
BEFORE UPDATE OF role ON profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_role_change();

-- Helpful votes maintenance
CREATE OR REPLACE FUNCTION public.update_helpful_votes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reports SET helpful_votes = helpful_votes + 1 WHERE id = NEW.report_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reports SET helpful_votes = GREATEST(helpful_votes - 1, 0) WHERE id = OLD.report_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_report_votes_count
AFTER INSERT OR DELETE ON report_votes
FOR EACH ROW EXECUTE FUNCTION public.update_helpful_votes();

-- Auto-create profile on new user
-- username is the public display nick (no real names). Prefer explicit 'username' from our signup or provider (Discord provides 'username' handle),
-- never copy real full_name from Google etc to avoid personal data exposure. Existing rows with old names can be edited by users in /profile.
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

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Public helper to check username availability before/during registration.
-- Uses SECURITY DEFINER so anon clients can call it without RLS allowing full profile reads.
CREATE OR REPLACE FUNCTION public.is_username_taken(p_username text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) = 0 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE lower(username) = lower(p_username)
  );
END;
$$;

-- Allow unauthenticated users (at signup) and authenticated to call the check.
GRANT EXECUTE ON FUNCTION public.is_username_taken(text) TO anon, authenticated;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_ingest_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_rigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_images ENABLE ROW LEVEL SECURITY;

-- Games: fully public read
CREATE POLICY "Games are publicly readable" ON games FOR SELECT USING (true);

-- Reports: public read only approved ones
CREATE POLICY "Approved reports are publicly readable" ON reports
  FOR SELECT USING (status = 'approved');

-- Owners can always read their own reports (any status). REQUIRED so that:
--   1. insert().select() can return the freshly inserted 'pending' row (otherwise the
--      RETURNING clause is denied by RLS and you get error 42501 on submit), and
--   2. the rate-limit / duplicate-detection count queries in submitReportAction can
--      actually see the user's own pending reports.
CREATE POLICY "Users can read their own reports" ON reports
  FOR SELECT USING (user_id = (select auth.uid()));

-- Anyone (including fully anonymous clients using the anon key, or authenticated users/guests via signInAnonymously)
-- can insert reports. The row must claim user_id=NULL or exactly the current auth.uid().
-- Submissions use submitReportAction (direct insert, status=approved for immediate publish) or submit_report RPC (pending).
-- Policy allows both; counters/moderator_notes default or set by action (catalog prefix only).
CREATE POLICY "Anyone can insert reports (self or anonymous)" ON reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status IN ('pending', 'approved')
    AND ((user_id IS NULL) OR (user_id = (select auth.uid())))
  );

-- Owners can update their own pending reports
CREATE POLICY "Users can update own pending reports" ON reports
  FOR UPDATE USING (user_id = (select auth.uid()) AND status = 'pending');

-- Votes
CREATE POLICY "Users can vote on reports" ON report_votes
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can see their own votes" ON report_votes
  FOR SELECT USING (user_id = (select auth.uid()));

-- Profiles: users manage their own non-privileged fields. Role changes are
-- blocked by profiles_prevent_client_role_change even if clients send role.
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING ((select auth.uid()) = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id AND role = 'user');

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- Public read of basic profile fields (username, avatar, credibility/role) so approved reports can
-- publicly attribute the reporting user and display their badges (e.g. "Trusted", Steam-verified intent).
-- No sensitive data in profiles; this enables the "who reported this" + badge features on /games/[slug] etc.
CREATE POLICY "Public can view basic profile info for report authors" ON profiles
  FOR SELECT USING (true);

-- User rigs: owners only
CREATE POLICY "Users can manage their own rig" ON user_rigs
  FOR ALL USING (user_id = (select auth.uid()));

-- Report images: owners can manage
CREATE POLICY "Users can manage images on their reports" ON report_images
  FOR ALL USING (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = report_images.report_id AND reports.user_id = (select auth.uid()))
  );

-- ============================================
-- PHASE 1: Game Media (for IGDB/Steam/PCGW images & media)
-- Consolidated addition for real-data ingestion pipeline.
-- Stores multiple images per game (covers, screenshots, artworks).
-- ============================================
CREATE TABLE game_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('cover', 'screenshot', 'artwork', 'logo', 'video')),
  url text NOT NULL,
  thumbnail_url text,
  width integer,
  height integer,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'igdb',
  external_id text,
  attribution text,  -- Legal attribution / credit string for the media (e.g. "Sourced from IGDB.com. Images © their respective copyright holders. Used for non-commercial, informational purposes.")
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_media_game ON game_media (game_id, media_type, sort_order);

ALTER TABLE game_media ENABLE ROW LEVEL SECURITY;

-- Public read (ingestion uses service_role key server-side only)
CREATE POLICY "Game media are publicly readable" ON game_media FOR SELECT USING (true);

-- ============================================
-- NOTES
-- ============================================
-- Run this entire script in the Supabase SQL Editor.
-- After running, enable Anonymous + Google + Discord providers in Authentication > Providers.
-- Add your anon + service_role keys to .env.local as SUPABASE_URL and keys.
-- For Phase 1 ingestion: re-apply this schema or run the added block if table missing.
-- For hardware catalog (live autocomplete/similarity): use supabase/incremental-hardware-catalog.sql for existing DBs (or full schema for fresh).

-- ============================================
-- PHASE 2 ADDITIONS (Master Implementation Plan aligned)
-- Real reports submission (status=pending default, server performance_tier, moderation fields)
-- Upvoting via report_votes + existing trigger (already in base schema)
-- Moderator access for /admin/reports
-- Anti-abuse: rate limits + duplicate detection (enforced in RPC or Server Action)
-- ============================================

-- 1. Moderator RLS policies (REQUIRED for /admin/reports UI to function)
-- Helper: moderator/admin check. SECURITY DEFINER bypasses RLS on profiles and lets
-- Postgres evaluate the role lookup once per query instead of per row (see
-- supabase/incremental-rls-performance.sql for the migration applied to existing projects).
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

-- Moderators/admins can SELECT every report (pending/approved/rejected/flagged) for review
CREATE POLICY "Moderators can read all reports for moderation" ON reports
  FOR SELECT USING ((select public.is_moderator_or_admin()));

-- Moderators/admins can UPDATE any report (change status, add moderator_notes, set moderated_* fields)
-- This complements the existing "Users can update own pending reports" policy
CREATE POLICY "Moderators can moderate any report" ON reports
  FOR UPDATE USING ((select public.is_moderator_or_admin()))
  WITH CHECK ((select public.is_moderator_or_admin()));

-- 2. Helper + RPCs for clean submission + upvoting (anti-abuse + tier calc in DB)
-- These are OPTIONAL but recommended. Server Actions (below) may call rpc or mirror the logic.
CREATE OR REPLACE FUNCTION public.calculate_performance_tier(p_avg_fps numeric)
RETURNS performance_tier
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_avg_fps >= 90 THEN 'Excellent'::performance_tier
    WHEN p_avg_fps >= 60 THEN 'Good'::performance_tier
    WHEN p_avg_fps >= 40 THEN 'Playable'::performance_tier
    WHEN p_avg_fps >= 25 THEN 'Struggling'::performance_tier
    ELSE 'Unplayable'::performance_tier
  END;
$$;

-- submit_report RPC: authoritative tier, rate limit (5 reports/hr/auth user), exact duplicate detection (24h)
CREATE OR REPLACE FUNCTION public.submit_report(
  p_game_id uuid,
  p_cpu text,
  p_gpu text,
  p_ram integer,
  p_resolution text,
  p_settings_preset graphics_preset,
  p_avg_fps numeric,
  p_refresh_rate integer DEFAULT NULL,
  p_fps_1_percent_low numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_tweaks text DEFAULT NULL,
  p_issues text DEFAULT NULL,
  p_driver_version text DEFAULT NULL,
  p_ram_speed text DEFAULT NULL,
  p_custom_settings_notes text DEFAULT NULL,
  p_kernel text DEFAULT NULL,
  p_distro text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_game_name text;
  v_tier performance_tier;
  v_report_id uuid;
  v_count int;
BEGIN
  SELECT name INTO v_game_name FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found for id %', p_game_id;
  END IF;

  v_tier := public.calculate_performance_tier(p_avg_fps);

  IF v_user_id IS NOT NULL THEN
    -- Rate limit: 5 submissions per rolling hour
    SELECT COUNT(*) INTO v_count
    FROM reports
    WHERE user_id = v_user_id AND created_at > now() - INTERVAL '1 hour';
    IF v_count >= 5 THEN
      RAISE EXCEPTION 'Rate limit exceeded: max 5 reports per hour. Try again later.';
    END IF;

    -- Duplicate detection: identical hardware + game + user within 24h
    SELECT COUNT(*) INTO v_count
    FROM reports
    WHERE user_id = v_user_id
      AND game_id = p_game_id
      AND cpu = p_cpu AND gpu = p_gpu
      AND ram = p_ram AND resolution = p_resolution
      AND created_at > now() - INTERVAL '24 hours';
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Duplicate report: you submitted a nearly identical report for this game/hardware recently.';
    END IF;
  END IF;

  -- Insert respects schema exactly: status=pending default, performance_tier computed, moderation fields NULL.
  -- Note: kernel/distro (and other later ALTER columns) are omitted from this INSERT so the RPC
  -- works even if the full schema.sql (with ADD COLUMN IF NOT EXISTS at the bottom) hasn't been
  -- re-applied to an existing table. When those columns exist they will be NULL (fine, since
  -- current submit UI doesn't populate them yet). Update this INSERT list when wiring richer paste data.
  INSERT INTO reports (
    game_id, user_id, game_name,
    cpu, gpu, ram, ram_speed, resolution, refresh_rate,
    settings_preset, custom_settings_notes,
    avg_fps, fps_1_percent_low, performance_tier,
    notes, tweaks, issues, driver_version,
    status
  ) VALUES (
    p_game_id, v_user_id, v_game_name,
    p_cpu, p_gpu, p_ram, p_ram_speed, p_resolution, p_refresh_rate,
    p_settings_preset, p_custom_settings_notes,
    p_avg_fps, p_fps_1_percent_low, v_tier,
    p_notes, p_tweaks, p_issues, p_driver_version,
    'pending'
  ) RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_report TO anon, authenticated;

-- Simple upvote wrapper (leverages existing report_votes + trigger for helpful_votes)
CREATE OR REPLACE FUNCTION public.upvote_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must sign in to upvote reports';
  END IF;
  INSERT INTO report_votes (report_id, user_id) VALUES (p_report_id, auth.uid());
  -- Trigger trg_report_votes_count auto-increments helpful_votes
END;
$$;

GRANT EXECUTE ON FUNCTION public.upvote_report TO authenticated;

-- 3. Notes for operators
-- After running: 
--   1. Set a user's role to 'moderator' or 'admin' via UPDATE profiles SET role='moderator' WHERE id=... 
--   2. Use the /admin/reports UI (Phase 2)
--   3. Set NEXT_PUBLIC_USE_REAL_DATA=true in env to activate real submission path
-- The report_votes table + trigger already present in base schema (no changes needed).
-- Server Actions in app will prefer the RPCs above when available for centralized logic.
-- End of Phase 2 SQL additions.

-- =============================================================================
-- HARDWARE CATALOG (Phase 6+ — Production Live Version)
-- This is the live, editable hardware database backing autocomplete,
-- similarity scoring, and validation when NEXT_PUBLIC_USE_REAL_DATA=true.
-- The static file (lib/hardware-catalog.ts) remains the authoritative seed + offline fallback.
--
-- 2026-06 EXPANSION: Comprehensive market coverage since 2015-16 launches (Pascal/Polaris
-- through RTX 50 / Zen 5 / Arc + mid/low-end density). See plan + static catalog header.
-- New columns added for full HardwareCatalogEntry fidelity (architecture, threads, tdp_w).
--
-- For existing projects: Use supabase/incremental-hardware-catalog.sql (idempotent, recommended) OR scroll down to the "RECOMMENDED: COPY & PASTE THIS BLOCK" section (kept for backwards compat).
-- =============================================================================

CREATE TABLE hardware_catalog (
  canonical text PRIMARY KEY,
  component_type text NOT NULL CHECK (component_type IN ('cpu','gpu','ram','motherboard','psu')),
  vendor text,
  series text,
  perf_index numeric(6,2),
  vram_gb integer,
  cores integer,
  has_3d_vcache boolean DEFAULT false,
  memory_type text,
  speed_mts integer,
  release_year integer,
  architecture text,
  threads integer,
  tdp_w integer,
  notes text,
  source text,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookup in combobox + similarity
CREATE INDEX idx_hardware_catalog_vendor ON hardware_catalog (vendor);
CREATE INDEX idx_hardware_catalog_series ON hardware_catalog (series);
CREATE INDEX idx_hardware_catalog_type ON hardware_catalog (component_type);
CREATE INDEX idx_hardware_catalog_perf ON hardware_catalog (perf_index DESC NULLS LAST);

-- Enable RLS
ALTER TABLE hardware_catalog ENABLE ROW LEVEL SECURITY;

-- Public can read the catalog (needed for combobox + predictions for all users)
CREATE POLICY "Hardware catalog is publicly readable" 
  ON hardware_catalog FOR SELECT USING (true);

-- Only moderators and admins can modify the catalog
CREATE POLICY "Moderators and admins can insert hardware catalog entries"
  ON hardware_catalog FOR INSERT
  WITH CHECK ((select public.is_moderator_or_admin()));

CREATE POLICY "Moderators and admins can update hardware catalog entries"
  ON hardware_catalog FOR UPDATE
  USING ((select public.is_moderator_or_admin()))
  WITH CHECK ((select public.is_moderator_or_admin()));

CREATE POLICY "Moderators and admins can delete hardware catalog entries"
  ON hardware_catalog FOR DELETE
  USING ((select public.is_moderator_or_admin()));

-- =============================================================================
-- HARDWARE CATALOG EXPANSION - SAFE MIGRATION FOR EXISTING PROJECTS
-- Preferred: run supabase/incremental-hardware-catalog.sql (fully idempotent CREATE TABLE IF + DO policy blocks).
-- The block below is kept for manual compatibility.
-- =============================================================================

-- =============================================================================
-- RECOMMENDED (legacy path): COPY & PASTE THIS BLOCK INTO SUPABASE SQL EDITOR
-- (For any project that had the old hardware_catalog / aliases tables)
-- Completely safe. Uses DROP POLICY IF EXISTS + CREATE POLICY (Postgres does not support IF NOT EXISTS on policies).
-- =============================================================================

-- 1. Hardware catalog new columns (required for the big 2015-16+ database)
ALTER TABLE hardware_catalog
  ADD COLUMN IF NOT EXISTS architecture text,
  ADD COLUMN IF NOT EXISTS threads integer,
  ADD COLUMN IF NOT EXISTS tdp_w integer;

CREATE INDEX IF NOT EXISTS idx_hardware_catalog_canonical_lower 
  ON hardware_catalog (lower(canonical));

-- 2. Hardware aliases table indexes + RLS (was incomplete before)
CREATE INDEX IF NOT EXISTS idx_hardware_aliases_raw 
  ON hardware_aliases (lower(raw_string));
CREATE INDEX IF NOT EXISTS idx_hardware_aliases_canonical 
  ON hardware_aliases (canonical);

ALTER TABLE hardware_aliases ENABLE ROW LEVEL SECURITY;

-- Public read for normalization/combobox
DROP POLICY IF EXISTS "Hardware aliases are publicly readable" ON hardware_aliases;
CREATE POLICY "Hardware aliases are publicly readable"
  ON hardware_aliases FOR SELECT USING (true);

-- Moderator / admin can manage aliases
DROP POLICY IF EXISTS "Moderators and admins can insert hardware aliases" ON hardware_aliases;
CREATE POLICY "Moderators and admins can insert hardware aliases"
  ON hardware_aliases FOR INSERT
  WITH CHECK ((select public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can update hardware aliases" ON hardware_aliases;
CREATE POLICY "Moderators and admins can update hardware aliases"
  ON hardware_aliases FOR UPDATE
  USING ((select public.is_moderator_or_admin()))
  WITH CHECK ((select public.is_moderator_or_admin()));

DROP POLICY IF EXISTS "Moderators and admins can delete hardware aliases" ON hardware_aliases;
CREATE POLICY "Moderators and admins can delete hardware aliases"
  ON hardware_aliases FOR DELETE
  USING ((select public.is_moderator_or_admin()));

-- After running this, you can safely run: npm run seed:hardware
-- =============================================================================

-- ============================================================
-- Hardware Identification (Plan 4) - Additive columns + Steam linking
-- ============================================================

-- Optional columns on user_rigs and reports for detection provenance
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS detection_method text;
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS detected_raw jsonb;

-- Richer ProtonDB-style hardware details (Phase 1)
-- These are captured from high-quality pastes (especially inxi) and browser detection where possible.
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS driver_version text;
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS kernel text;
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS distro text;

-- Phase 2 Multi-Device support (ProtonDB "My Devices" parity)
-- Allow users to have multiple named rigs (like "Desktop", "Laptop", "Steam Deck").
-- We add label + is_primary. The old UNIQUE(user_id) is dropped so multiple rigs are possible.
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE user_rigs ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false;

-- Note: To fully support multiples, the original UNIQUE(user_id) constraint should be dropped manually
-- once in production (or via migration). The data layer will treat the most recent primary as "My Rig".

ALTER TABLE reports ADD COLUMN IF NOT EXISTS detection_method text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS detected_raw jsonb;

-- Richer hardware details on reports (driver_version already existed; adding kernel + distro for precision parity)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS kernel text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS distro text;

-- Steam linking table (from Plan 2 + C)
CREATE TABLE IF NOT EXISTS linked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('steam')),
  provider_user_id text NOT NULL,
  provider_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user ON linked_accounts(user_id);

ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own linked accounts" ON linked_accounts
  FOR ALL USING (user_id = (select auth.uid()));

CREATE POLICY "Public can see linked Steam for verification badges" ON linked_accounts
  FOR SELECT USING (provider = 'steam');

-- Denorm columns on profiles for fast display
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_persona text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_linked_at timestamptz;

-- Optional denorm columns on reports (recommended for production scale)
-- Run these when you want server-side similarity pruning:
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS canonical_cpu text;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS canonical_gpu text;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS gpu_perf_index numeric(6,2);
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS cpu_perf_index numeric(6,2);

-- Recommended supporting indexes (uncomment when adding columns above)
-- CREATE INDEX IF NOT EXISTS idx_reports_canonical_gpu ON reports (canonical_gpu);
-- CREATE INDEX IF NOT EXISTS idx_reports_gpu_perf ON reports (gpu_perf_index DESC NULLS LAST);

-- ============================================================
-- RLS + FK index performance hardening
-- Mirrors supabase/incremental-rls-performance.sql so fresh installs get the
-- same indexes that existing projects receive from the incremental migration.
-- ============================================================

-- FK columns + submit_report hot paths (rate limiting, duplicate detection)
CREATE INDEX IF NOT EXISTS idx_reports_user_created
  ON reports (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_user_game_created
  ON reports (user_id, game_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_votes_report
  ON report_votes (report_id);

CREATE INDEX IF NOT EXISTS idx_report_images_report
  ON report_images (report_id);

CREATE INDEX IF NOT EXISTS idx_game_ingest_queue_game
  ON game_ingest_queue (game_id)
  WHERE game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles (id)
  WHERE role IN ('moderator', 'admin');
