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
  last_ingested_at timestamptz,
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
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE games ENABLE ROW LEVEL SECURITY;
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

-- Authenticated users can insert their own reports (or anonymous)
CREATE POLICY "Authenticated users can insert reports" ON reports
  FOR INSERT WITH CHECK (
    (user_id IS NULL) OR (user_id = auth.uid())
  );

-- Owners can update their own pending reports
CREATE POLICY "Users can update own pending reports" ON reports
  FOR UPDATE USING (user_id = auth.uid() AND status = 'pending');

-- Votes
CREATE POLICY "Users can vote on reports" ON report_votes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can see their own votes" ON report_votes
  FOR SELECT USING (user_id = auth.uid());

-- Profiles: users manage their own
CREATE POLICY "Users can view and update own profile" ON profiles
  FOR ALL USING (auth.uid() = id);

-- User rigs: owners only
CREATE POLICY "Users can manage their own rig" ON user_rigs
  FOR ALL USING (user_id = auth.uid());

-- Report images: owners can manage
CREATE POLICY "Users can manage images on their reports" ON report_images
  FOR ALL USING (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = report_images.report_id AND reports.user_id = auth.uid())
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

-- ============================================
-- PHASE 2 ADDITIONS (Master Implementation Plan aligned)
-- Real reports submission (status=pending default, server performance_tier, moderation fields)
-- Upvoting via report_votes + existing trigger (already in base schema)
-- Moderator access for /admin/reports
-- Anti-abuse: rate limits + duplicate detection (enforced in RPC or Server Action)
-- ============================================

-- 1. Moderator RLS policies (REQUIRED for /admin/reports UI to function)
-- Moderators/admins can SELECT every report (pending/approved/rejected/flagged) for review
CREATE POLICY "Moderators can read all reports for moderation" ON reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('moderator', 'admin')
    )
  );

-- Moderators/admins can UPDATE any report (change status, add moderator_notes, set moderated_* fields)
-- This complements the existing "Users can update own pending reports" policy
CREATE POLICY "Moderators can moderate any report" ON reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('moderator', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('moderator', 'admin')
    )
  );

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
  p_custom_settings_notes text DEFAULT NULL
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

  -- Insert respects schema exactly: status=pending default, performance_tier computed, moderation fields NULL
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
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('moderator', 'admin')
    )
  );

CREATE POLICY "Moderators and admins can update hardware catalog entries"
  ON hardware_catalog FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('moderator', 'admin')
    )
  );

CREATE POLICY "Moderators and admins can delete hardware catalog entries"
  ON hardware_catalog FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('moderator', 'admin')
    )
  );

-- Optional denorm columns on reports (recommended for production scale)
-- Run these when you want server-side similarity pruning:
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS canonical_cpu text;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS canonical_gpu text;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS gpu_perf_index numeric(6,2);
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS cpu_perf_index numeric(6,2);

-- Recommended supporting indexes (uncomment when adding columns above)
-- CREATE INDEX IF NOT EXISTS idx_reports_canonical_gpu ON reports (canonical_gpu);
-- CREATE INDEX IF NOT EXISTS idx_reports_gpu_perf ON reports (gpu_perf_index DESC NULLS LAST);