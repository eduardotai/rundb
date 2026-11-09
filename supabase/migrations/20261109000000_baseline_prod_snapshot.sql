-- =============================================================================
-- RunDB baseline: snapshot of the production `public` + `private` schemas.
--
-- Captured 2026-11-09 by rebuilding the production schema locally from the SQL
-- files in git history and diffing a catalog signature (columns + order,
-- defaults, constraints, indexes, RLS flags, policies, function bodies/config,
-- EXECUTE and table grants, triggers, comments, enums, extensions) against the
-- live project until identical, then exporting with pg_dump --schema-only.
--
-- This file intentionally reproduces production AS-IS, including known RLS
-- weaknesses (fixed in later migrations, not here). Changes that exist in the
-- repo but were never applied to production follow as separate migrations:
--   20261109000100_sync_function_bodies_with_repo.sql
--   20261109000200_rls_performance.sql
--   20261109000300_hardware_catalog_igpu.sql
--   20261109000400_admin_moderation.sql
--
-- Not included (owned by the Supabase platform): roles, the auth/storage
-- schemas, pgcrypto/uuid-ossp in `extensions`, the `ensure_rls` event trigger
-- (public.rls_auto_enable), storage buckets (declared in supabase/config.toml).
--
-- Production adoption (never run `db push` before this):
--   supabase migration repair --remote --status applied 20261109000000
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11 (Debian 17.11-0+deb13u1)

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;

--
-- Name: graphics_preset; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.graphics_preset AS ENUM (
    'Low',
    'Medium',
    'High',
    'Ultra',
    'Custom'
);

--
-- Name: performance_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.performance_tier AS ENUM (
    'Excellent',
    'Good',
    'Playable',
    'Struggling',
    'Unplayable'
);

--
-- Name: report_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'flagged'
);

--
-- Name: after_report_changed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.after_report_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
BEGIN
  PERFORM private.recompute_profile_reputation(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
END;
$$;

--
-- Name: after_report_vote_changed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.after_report_vote_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
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

--
-- Name: credibility_badge_for_score(integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.credibility_badge_for_score(p_score integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_score >= 500 THEN 'Legend'
    WHEN p_score >= 200 THEN 'Expert'
    WHEN p_score >= 75 THEN 'Trusted'
    WHEN p_score >= 20 THEN 'Helpful'
    ELSE 'New'
  END;
$$;

--
-- Name: recompute_profile_reputation(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.recompute_profile_reputation(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
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

--
-- Name: recompute_report_vote_totals(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.recompute_report_vote_totals(p_report_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
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

--
-- Name: touch_report_vote(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.touch_report_vote() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

--
-- Name: handle_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: is_username_taken(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_username_taken(p_username text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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

--
-- Name: prevent_client_profile_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_client_profile_role_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: update_game_report_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_game_report_count() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.status = 'approved' THEN
    UPDATE games SET report_count = (
      SELECT count(*) FROM reports WHERE game_id = NEW.game_id AND status = 'approved'
    ) WHERE id = NEW.game_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status <> 'approved') THEN
    UPDATE games SET report_count = (
      SELECT count(*) FROM reports WHERE game_id = COALESCE(NEW.game_id, OLD.game_id) AND status = 'approved'
    ) WHERE id = COALESCE(NEW.game_id, OLD.game_id);
  END IF;
  RETURN NULL;
END;
$$;

--
-- Name: update_helpful_votes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_helpful_votes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reports SET helpful_votes = helpful_votes + 1 WHERE id = NEW.report_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reports SET helpful_votes = GREATEST(helpful_votes - 1, 0) WHERE id = OLD.report_id;
  END IF;
  RETURN NULL;
END;
$$;

--
-- Name: game_ingest_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_ingest_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    steam_app_id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_ingest_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])))
);

--
-- Name: game_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    media_type text NOT NULL,
    url text NOT NULL,
    thumbnail_url text,
    width integer,
    height integer,
    sort_order integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'igdb'::text NOT NULL,
    external_id text,
    attribution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_media_media_type_check CHECK ((media_type = ANY (ARRAY['cover'::text, 'screenshot'::text, 'artwork'::text, 'logo'::text, 'video'::text])))
);

--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    cover_url text,
    genres text[] DEFAULT '{}'::text[] NOT NULL,
    release_year integer,
    developer text,
    publisher text,
    official_min_reqs jsonb,
    official_rec_reqs jsonb,
    igdb_id text,
    steam_app_id text,
    last_ingested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingest_status text,
    official_reqs_checked_at timestamp with time zone,
    official_reqs_status text,
    report_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT games_ingest_status_check CHECK ((ingest_status = ANY (ARRAY['skeleton'::text, 'enriched'::text, 'failed'::text])))
);

--
-- Name: COLUMN games.official_reqs_checked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.official_reqs_checked_at IS 'When we last attempted to load Steam pc_requirements for this game.';

--
-- Name: COLUMN games.official_reqs_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.games.official_reqs_status IS 'pending | ready | empty | error | rate_limited — see incremental-game-official-reqs-cache.sql';

--
-- Name: hardware_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hardware_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    raw_string text NOT NULL,
    canonical text NOT NULL,
    vendor text,
    series text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: hardware_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hardware_catalog (
    canonical text NOT NULL,
    component_type text NOT NULL,
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
    last_updated timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hardware_catalog_component_type_check CHECK ((component_type = ANY (ARRAY['cpu'::text, 'gpu'::text, 'ram'::text, 'motherboard'::text, 'psu'::text])))
);

--
-- Name: linked_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linked_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    provider_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT linked_accounts_provider_check CHECK ((provider = 'steam'::text))
);

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    username text,
    avatar_url text,
    main_cpu text,
    main_gpu text,
    main_ram integer,
    preferred_resolution text,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reputation_score integer DEFAULT 0 NOT NULL,
    credibility_badge text DEFAULT 'New'::text NOT NULL,
    reports_submitted integer DEFAULT 0 NOT NULL,
    votes_cast integer DEFAULT 0 NOT NULL,
    steam_id text,
    steam_persona text,
    steam_avatar_url text,
    steam_linked_at timestamp with time zone,
    CONSTRAINT profiles_credibility_badge_check CHECK ((credibility_badge = ANY (ARRAY['New'::text, 'Helpful'::text, 'Trusted'::text, 'Expert'::text, 'Legend'::text]))),
    CONSTRAINT profiles_main_ram_check CHECK (((main_ram > 0) AND (main_ram <= 256))),
    CONSTRAINT profiles_reports_submitted_check CHECK ((reports_submitted >= 0)),
    CONSTRAINT profiles_reputation_score_check CHECK ((reputation_score >= 0)),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'moderator'::text, 'admin'::text]))),
    CONSTRAINT profiles_votes_cast_check CHECK ((votes_cast >= 0))
);

--
-- Name: report_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    image_url text NOT NULL,
    caption text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: report_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    vote smallint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_votes_vote_check CHECK ((vote = ANY (ARRAY['-1'::integer, 1])))
);

--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    user_id uuid,
    game_name text NOT NULL,
    cpu text NOT NULL,
    gpu text NOT NULL,
    ram integer NOT NULL,
    ram_speed text,
    resolution text NOT NULL,
    refresh_rate integer,
    settings_preset public.graphics_preset NOT NULL,
    custom_settings_notes text,
    avg_fps numeric(6,1) NOT NULL,
    fps_1_percent_low numeric(6,1),
    performance_tier public.performance_tier NOT NULL,
    notes text,
    tweaks text,
    issues text,
    driver_version text,
    status public.report_status DEFAULT 'approved'::public.report_status NOT NULL,
    helpful_votes integer DEFAULT 0 NOT NULL,
    moderated_by uuid,
    moderated_at timestamp with time zone,
    moderator_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    downvote_votes integer DEFAULT 0 NOT NULL,
    vote_score integer DEFAULT 0 NOT NULL,
    credibility_score integer DEFAULT 0 NOT NULL,
    credibility_badge text DEFAULT 'New'::text NOT NULL,
    detection_method text,
    detected_raw jsonb,
    kernel text,
    distro text,
    CONSTRAINT reports_avg_fps_check CHECK (((avg_fps > (0)::numeric) AND (avg_fps <= (2000)::numeric))),
    CONSTRAINT reports_credibility_badge_check CHECK ((credibility_badge = ANY (ARRAY['New'::text, 'Helpful'::text, 'Trusted'::text, 'Expert'::text, 'Legend'::text]))),
    CONSTRAINT reports_downvote_votes_check CHECK ((downvote_votes >= 0)),
    CONSTRAINT reports_fps_1_percent_low_check CHECK (((fps_1_percent_low IS NULL) OR (fps_1_percent_low > (0)::numeric))),
    CONSTRAINT reports_helpful_votes_check CHECK ((helpful_votes >= 0)),
    CONSTRAINT reports_ram_check CHECK (((ram >= 2) AND (ram <= 256))),
    CONSTRAINT reports_refresh_rate_check CHECK (((refresh_rate IS NULL) OR ((refresh_rate >= 30) AND (refresh_rate <= 1000))))
);

--
-- Name: user_rigs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_rigs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    cpu text NOT NULL,
    gpu text NOT NULL,
    ram integer NOT NULL,
    resolution text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    detection_method text,
    detected_raw jsonb,
    driver_version text,
    kernel text,
    distro text,
    label text,
    is_primary boolean DEFAULT false,
    CONSTRAINT user_rigs_ram_check CHECK (((ram > 0) AND (ram <= 256)))
);

--
-- Name: game_ingest_queue game_ingest_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_ingest_queue
    ADD CONSTRAINT game_ingest_queue_pkey PRIMARY KEY (id);

--
-- Name: game_ingest_queue game_ingest_queue_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_ingest_queue
    ADD CONSTRAINT game_ingest_queue_slug_key UNIQUE (slug);

--
-- Name: game_media game_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_media
    ADD CONSTRAINT game_media_pkey PRIMARY KEY (id);

--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);

--
-- Name: games games_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_slug_key UNIQUE (slug);

--
-- Name: hardware_aliases hardware_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hardware_aliases
    ADD CONSTRAINT hardware_aliases_pkey PRIMARY KEY (id);

--
-- Name: hardware_aliases hardware_aliases_raw_string_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hardware_aliases
    ADD CONSTRAINT hardware_aliases_raw_string_key UNIQUE (raw_string);

--
-- Name: hardware_catalog hardware_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hardware_catalog
    ADD CONSTRAINT hardware_catalog_pkey PRIMARY KEY (canonical);

--
-- Name: linked_accounts linked_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_pkey PRIMARY KEY (id);

--
-- Name: linked_accounts linked_accounts_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);

--
-- Name: linked_accounts linked_accounts_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_user_id_provider_key UNIQUE (user_id, provider);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: report_images report_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_pkey PRIMARY KEY (id);

--
-- Name: report_votes report_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_votes
    ADD CONSTRAINT report_votes_pkey PRIMARY KEY (id);

--
-- Name: report_votes report_votes_report_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_votes
    ADD CONSTRAINT report_votes_report_id_user_id_key UNIQUE (report_id, user_id);

--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

--
-- Name: user_rigs user_rigs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_rigs
    ADD CONSTRAINT user_rigs_pkey PRIMARY KEY (id);

--
-- Name: idx_game_media_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_media_game ON public.game_media USING btree (game_id, media_type, sort_order);

--
-- Name: idx_games_ingest_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_ingest_status ON public.games USING btree (ingest_status);

--
-- Name: idx_games_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_name_trgm ON public.games USING gin (name public.gin_trgm_ops);

--
-- Name: idx_games_official_reqs_unchecked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_official_reqs_unchecked ON public.games USING btree (steam_app_id) WHERE ((official_reqs_checked_at IS NULL) AND (steam_app_id IS NOT NULL));

--
-- Name: idx_games_report_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_report_count ON public.games USING btree (report_count DESC NULLS LAST, name);

--
-- Name: idx_games_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_slug ON public.games USING btree (slug);

--
-- Name: idx_hardware_aliases_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_aliases_canonical ON public.hardware_aliases USING btree (canonical);

--
-- Name: idx_hardware_aliases_raw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_aliases_raw ON public.hardware_aliases USING btree (lower(raw_string));

--
-- Name: idx_hardware_catalog_canonical_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_catalog_canonical_lower ON public.hardware_catalog USING btree (lower(canonical));

--
-- Name: idx_hardware_catalog_perf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_catalog_perf ON public.hardware_catalog USING btree (perf_index DESC NULLS LAST);

--
-- Name: idx_hardware_catalog_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_catalog_series ON public.hardware_catalog USING btree (series);

--
-- Name: idx_hardware_catalog_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_catalog_type ON public.hardware_catalog USING btree (component_type);

--
-- Name: idx_hardware_catalog_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hardware_catalog_vendor ON public.hardware_catalog USING btree (vendor);

--
-- Name: idx_linked_accounts_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_linked_accounts_provider_id ON public.linked_accounts USING btree (provider, provider_user_id);

--
-- Name: idx_linked_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_linked_accounts_user ON public.linked_accounts USING btree (user_id);

--
-- Name: idx_profiles_reputation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_reputation ON public.profiles USING btree (reputation_score DESC);

--
-- Name: idx_profiles_steam_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_steam_id ON public.profiles USING btree (steam_id) WHERE (steam_id IS NOT NULL);

--
-- Name: idx_queue_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_queue_status_priority ON public.game_ingest_queue USING btree (status, priority);

--
-- Name: idx_reports_cpu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_cpu ON public.reports USING btree (lower(cpu));

--
-- Name: idx_reports_game_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_game_created ON public.reports USING btree (game_id, created_at DESC);

--
-- Name: idx_reports_game_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_game_tier ON public.reports USING btree (game_id, performance_tier);

--
-- Name: idx_reports_gpu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_gpu ON public.reports USING btree (lower(gpu));

--
-- Name: idx_reports_resolution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_resolution ON public.reports USING btree (resolution);

--
-- Name: idx_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_status ON public.reports USING btree (status) WHERE (status = 'approved'::public.report_status);

--
-- Name: idx_reports_vote_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_vote_score ON public.reports USING btree (vote_score DESC);

--
-- Name: idx_user_rigs_user_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_rigs_user_primary ON public.user_rigs USING btree (user_id, is_primary DESC NULLS LAST, updated_at DESC NULLS LAST);

--
-- Name: profiles_username_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_unique ON public.profiles USING btree (lower(username));

--
-- Name: game_ingest_queue game_ingest_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_ingest_queue_updated_at BEFORE UPDATE ON public.game_ingest_queue FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

--
-- Name: games games_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

--
-- Name: linked_accounts linked_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER linked_accounts_updated_at BEFORE UPDATE ON public.linked_accounts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

--
-- Name: profiles profiles_prevent_client_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_prevent_client_role_change BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_role_change();

--
-- Name: profiles profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

--
-- Name: report_votes report_votes_recompute_reputation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER report_votes_recompute_reputation AFTER INSERT OR DELETE OR UPDATE ON public.report_votes FOR EACH ROW EXECUTE FUNCTION private.after_report_vote_changed();

--
-- Name: report_votes report_votes_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER report_votes_touch_updated_at BEFORE UPDATE ON public.report_votes FOR EACH ROW EXECUTE FUNCTION private.touch_report_vote();

--
-- Name: reports reports_recompute_profile_reputation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reports_recompute_profile_reputation AFTER INSERT OR DELETE OR UPDATE OF user_id, status, helpful_votes, downvote_votes, vote_score ON public.reports FOR EACH ROW EXECUTE FUNCTION private.after_report_changed();

--
-- Name: reports trg_reports_report_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reports_report_count AFTER INSERT OR DELETE OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.update_game_report_count();

--
-- Name: game_ingest_queue game_ingest_queue_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_ingest_queue
    ADD CONSTRAINT game_ingest_queue_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

--
-- Name: game_media game_media_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_media
    ADD CONSTRAINT game_media_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

--
-- Name: linked_accounts linked_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: report_images report_images_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

--
-- Name: report_votes report_votes_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_votes
    ADD CONSTRAINT report_votes_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;

--
-- Name: report_votes report_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_votes
    ADD CONSTRAINT report_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: reports reports_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

--
-- Name: reports reports_moderated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES auth.users(id);

--
-- Name: reports reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: user_rigs user_rigs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_rigs
    ADD CONSTRAINT user_rigs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: reports Approved reports are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Approved reports are publicly readable" ON public.reports FOR SELECT USING ((status = 'approved'::public.report_status));

--
-- Name: game_media Game media are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Game media are publicly readable" ON public.game_media FOR SELECT USING (true);

--
-- Name: games Games are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Games are publicly readable" ON public.games FOR SELECT USING (true);

--
-- Name: hardware_aliases Hardware aliases are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Hardware aliases are publicly readable" ON public.hardware_aliases FOR SELECT USING (true);

--
-- Name: hardware_catalog Hardware catalog is publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Hardware catalog is publicly readable" ON public.hardware_catalog FOR SELECT USING (true);

--
-- Name: hardware_aliases Moderators and admins can delete hardware aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can delete hardware aliases" ON public.hardware_aliases FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: hardware_catalog Moderators and admins can delete hardware catalog entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can delete hardware catalog entries" ON public.hardware_catalog FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: hardware_aliases Moderators and admins can insert hardware aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can insert hardware aliases" ON public.hardware_aliases FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: hardware_catalog Moderators and admins can insert hardware catalog entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can insert hardware catalog entries" ON public.hardware_catalog FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: hardware_aliases Moderators and admins can update hardware aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can update hardware aliases" ON public.hardware_aliases FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: hardware_catalog Moderators and admins can update hardware catalog entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Moderators and admins can update hardware catalog entries" ON public.hardware_catalog FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['moderator'::text, 'admin'::text]))))));

--
-- Name: linked_accounts Public can see linked Steam for verification badges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can see linked Steam for verification badges" ON public.linked_accounts FOR SELECT USING ((provider = 'steam'::text));

--
-- Name: profiles Public can view basic profile info for report authors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view basic profile info for report authors" ON public.profiles FOR SELECT USING (true);

--
-- Name: report_votes Users can delete own report votes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own report votes" ON public.report_votes FOR DELETE USING ((user_id = auth.uid()));

--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (((auth.uid() = id) AND (role = 'user'::text)));

--
-- Name: report_images Users can manage images on their reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage images on their reports" ON public.report_images USING ((EXISTS ( SELECT 1
   FROM public.reports
  WHERE ((reports.id = report_images.report_id) AND (reports.user_id = auth.uid())))));

--
-- Name: linked_accounts Users can manage own linked accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own linked accounts" ON public.linked_accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: user_rigs Users can manage their own rig; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own rig" ON public.user_rigs USING ((user_id = auth.uid()));

--
-- Name: reports Users can read their own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own reports" ON public.reports FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: report_votes Users can see their own votes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can see their own votes" ON public.report_votes FOR SELECT USING ((user_id = auth.uid()));

--
-- Name: reports Users can update own pending reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own pending reports" ON public.reports FOR UPDATE USING (((user_id = auth.uid()) AND (status = 'pending'::public.report_status)));

--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

--
-- Name: report_votes Users can update own report votes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own report votes" ON public.report_votes FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND (vote = ANY (ARRAY['-1'::integer, 1]))));

--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));

--
-- Name: report_votes Users can vote on reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can vote on reports" ON public.report_votes FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (vote = ANY (ARRAY['-1'::integer, 1]))));

--
-- Name: game_ingest_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_ingest_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: game_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_media ENABLE ROW LEVEL SECURITY;

--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: hardware_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hardware_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: hardware_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hardware_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: linked_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: report_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_images ENABLE ROW LEVEL SECURITY;

--
-- Name: report_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: user_rigs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_rigs ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

--
-- Name: FUNCTION handle_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_updated_at() TO anon;
GRANT ALL ON FUNCTION public.handle_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.handle_updated_at() TO service_role;

--
-- Name: FUNCTION is_username_taken(p_username text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_username_taken(p_username text) TO anon;
GRANT ALL ON FUNCTION public.is_username_taken(p_username text) TO authenticated;
GRANT ALL ON FUNCTION public.is_username_taken(p_username text) TO service_role;

--
-- Name: FUNCTION prevent_client_profile_role_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_client_profile_role_change() TO anon;
GRANT ALL ON FUNCTION public.prevent_client_profile_role_change() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_client_profile_role_change() TO service_role;

--
-- Name: FUNCTION update_game_report_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_game_report_count() TO anon;
GRANT ALL ON FUNCTION public.update_game_report_count() TO authenticated;
GRANT ALL ON FUNCTION public.update_game_report_count() TO service_role;

--
-- Name: FUNCTION update_helpful_votes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_helpful_votes() TO anon;
GRANT ALL ON FUNCTION public.update_helpful_votes() TO authenticated;
GRANT ALL ON FUNCTION public.update_helpful_votes() TO service_role;

--
-- Name: TABLE game_ingest_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_ingest_queue TO anon;
GRANT ALL ON TABLE public.game_ingest_queue TO authenticated;
GRANT ALL ON TABLE public.game_ingest_queue TO service_role;

--
-- Name: TABLE game_media; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_media TO anon;
GRANT ALL ON TABLE public.game_media TO authenticated;
GRANT ALL ON TABLE public.game_media TO service_role;

--
-- Name: TABLE games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.games TO anon;
GRANT ALL ON TABLE public.games TO authenticated;
GRANT ALL ON TABLE public.games TO service_role;

--
-- Name: TABLE hardware_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hardware_aliases TO anon;
GRANT ALL ON TABLE public.hardware_aliases TO authenticated;
GRANT ALL ON TABLE public.hardware_aliases TO service_role;

--
-- Name: TABLE hardware_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hardware_catalog TO anon;
GRANT ALL ON TABLE public.hardware_catalog TO authenticated;
GRANT ALL ON TABLE public.hardware_catalog TO service_role;

--
-- Name: TABLE linked_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.linked_accounts TO anon;
GRANT ALL ON TABLE public.linked_accounts TO authenticated;
GRANT ALL ON TABLE public.linked_accounts TO service_role;

--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

--
-- Name: TABLE report_images; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.report_images TO anon;
GRANT ALL ON TABLE public.report_images TO authenticated;
GRANT ALL ON TABLE public.report_images TO service_role;

--
-- Name: TABLE report_votes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.report_votes TO anon;
GRANT ALL ON TABLE public.report_votes TO authenticated;
GRANT ALL ON TABLE public.report_votes TO service_role;

--
-- Name: TABLE reports; Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON TABLE public.reports FROM anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.reports TO anon;
REVOKE ALL ON TABLE public.reports FROM authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;

--
-- Name: TABLE user_rigs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_rigs TO anon;
GRANT ALL ON TABLE public.user_rigs TO authenticated;
GRANT ALL ON TABLE public.user_rigs TO service_role;

--
-- PostgreSQL database dump complete
--

--
-- Auth hook: create a profile row for every new auth user.
--

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
