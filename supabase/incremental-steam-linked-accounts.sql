-- Incremental migration: Steam account linking (linked_accounts + profile denorms)
-- Purpose: Enable "Link Steam" on profile/My Rig. Without this table the OpenID
--          callback succeeds against Steam but fails on upsert with:
--            PGRST205 Could not find the table 'public.linked_accounts'
--
-- Apply in Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Fully idempotent: safe to re-run on projects that already have some pieces.
--
-- Prerequisites: public.profiles must already exist (core auth schema).

-- ---------------------------------------------------------------------------
-- 1. linked_accounts table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.linked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('steam')),
  provider_user_id text NOT NULL, -- SteamID64 as string
  provider_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user ON public.linked_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_provider_id
  ON public.linked_accounts(provider, provider_user_id);

ALTER TABLE public.linked_accounts ENABLE ROW LEVEL SECURITY;

-- Users manage their own links (insert/update/delete/select own rows)
DROP POLICY IF EXISTS "Users can manage own linked accounts" ON public.linked_accounts;
CREATE POLICY "Users can manage own linked accounts" ON public.linked_accounts
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Public can see that a Steam link exists (for verification badges; no private data required)
DROP POLICY IF EXISTS "Public can see linked Steam for verification badges" ON public.linked_accounts;
CREATE POLICY "Public can see linked Steam for verification badges" ON public.linked_accounts
  FOR SELECT
  USING (provider = 'steam');

-- updated_at trigger (reuse handle_updated_at when present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS linked_accounts_updated_at ON public.linked_accounts;
    CREATE TRIGGER linked_accounts_updated_at
      BEFORE UPDATE ON public.linked_accounts
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Profile denorm columns (fast badge/display without join)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steam_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steam_persona text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steam_avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steam_linked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_steam_id ON public.profiles(steam_id)
  WHERE steam_id IS NOT NULL;

-- Notes:
-- - After applying, retry Profile → My Rig → Link Steam account.
-- - STEAM_WEB_API_KEY is optional (enriches persona/avatar); linking works without it.
-- - OpenID callback: /auth/steam/callback upserts linked_accounts then denorms profiles.
