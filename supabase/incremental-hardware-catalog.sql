-- Incremental / migration for hardware_catalog + hardware_aliases (Phase 6+ large catalog)
-- Idempotent and safe to re-run on any project (fresh or existing).
--
-- This adds the full hardware catalog table (with 2015-16+ columns: architecture, threads, tdp_w etc.)
-- plus RLS policies and the hardware_aliases table (for normalization mappings).
--
-- =============================================================================
-- HOW TO USE IN SUPABASE SQL EDITOR (IMPORTANT - AVOID COPY-PASTE ERRORS)
-- =============================================================================
-- 1. In PowerShell (this project root), run ONE of these to get CLEAN SQL only:
--      npm run copy:sql:hardware     # <--- easiest! copies to clipboard automatically
--      # or manually:
--      Get-Content supabase\incremental-hardware-catalog.sql | Set-Clipboard
-- 2. Go to https://supabase.com/dashboard/project/YOUR_REF/sql/new
-- 3. Paste (Ctrl+V). The first line must start with "-- Incremental" (a comment), NOT with ">" or "grokbuild@".
--    If you see ">" or npm output at the top, you copied the wrong thing (terminal prompt).
--    Delete everything and re-copy using the Get-Content command above.
-- 4. Click "Run" (or Ctrl+Enter).
-- 5. After it succeeds, come back here and run: npm run seed:hardware
--
-- Alternative (easiest if you have the token):
--   npm run setup:supabase   (requires SUPABASE_ACCESS_TOKEN or DATABASE_URL in .env.local)
--
-- For brand new projects: you can also just run the full supabase/schema.sql instead.
-- =============================================================================

-- 1. Hardware catalog table (full v2-large definition)
CREATE TABLE IF NOT EXISTS hardware_catalog (
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

-- Indexes for fast lookup in combobox + similarity + admin
CREATE INDEX IF NOT EXISTS idx_hardware_catalog_vendor ON hardware_catalog (vendor);
CREATE INDEX IF NOT EXISTS idx_hardware_catalog_series ON hardware_catalog (series);
CREATE INDEX IF NOT EXISTS idx_hardware_catalog_type ON hardware_catalog (component_type);
CREATE INDEX IF NOT EXISTS idx_hardware_catalog_perf ON hardware_catalog (perf_index DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_hardware_catalog_canonical_lower ON hardware_catalog (lower(canonical));

-- Enable RLS (safe if already enabled)
ALTER TABLE hardware_catalog ENABLE ROW LEVEL SECURITY;

-- Public read policy (safe create)
DO $$
BEGIN
  CREATE POLICY "Hardware catalog is publicly readable"
    ON hardware_catalog FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Moderator/admin write policies (INSERT/UPDATE/DELETE)
DO $$
BEGIN
  CREATE POLICY "Moderators and admins can insert hardware catalog entries"
    ON hardware_catalog FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Moderators and admins can update hardware catalog entries"
    ON hardware_catalog FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Moderators and admins can delete hardware catalog entries"
    ON hardware_catalog FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Safe additive columns (for projects that had an older hardware_catalog without the full v2026.06 fields)
ALTER TABLE hardware_catalog
  ADD COLUMN IF NOT EXISTS architecture text,
  ADD COLUMN IF NOT EXISTS threads integer,
  ADD COLUMN IF NOT EXISTS tdp_w integer;

-- =============================================================================
-- 2. Hardware aliases table (for raw->canonical normalization, community curated)
-- =============================================================================
CREATE TABLE IF NOT EXISTS hardware_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_string text UNIQUE NOT NULL,
  canonical text NOT NULL,
  vendor text,
  series text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes (expression + plain). The lower() one is critical for case-insensitive matching.
CREATE INDEX IF NOT EXISTS idx_hardware_aliases_raw ON hardware_aliases (lower(raw_string));
CREATE INDEX IF NOT EXISTS idx_hardware_aliases_canonical ON hardware_aliases (canonical);

ALTER TABLE hardware_aliases ENABLE ROW LEVEL SECURITY;

-- Public read for normalization / combobox fallback
DO $$
BEGIN
  CREATE POLICY "Hardware aliases are publicly readable"
    ON hardware_aliases FOR SELECT USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Moderator/admin management policies
DO $$
BEGIN
  CREATE POLICY "Moderators and admins can insert hardware aliases"
    ON hardware_aliases FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Moderators and admins can update hardware aliases"
    ON hardware_aliases FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Moderators and admins can delete hardware aliases"
    ON hardware_aliases FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('moderator', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- After applying:
--   npm run seed:hardware
--   (or use the admin UI seed button once logged in as admin)
--
-- This makes the live catalog (101+ entries) override/augment the static one when
-- NEXT_PUBLIC_USE_REAL_DATA=true. The static catalog (lib/hardware-catalog.ts) is
-- always the offline + seed source of truth.
-- =============================================================================
