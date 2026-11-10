-- Catalog sync (scripts/catalog-sync.ts): Steam-driven cover/metadata refresh + new releases.
--
-- games.last_synced_at: when the sync last changed the row (NULL = never touched by the sync).
-- catalog_sync_runs: one row per applied sync run with its stats, for auditing and alerting.
--   Server-only: written with the service role; clients get no privileges (RLS on, no policies).
-- idx_games_steam_app_id: the sync looks rows up by Steam app id. Not UNIQUE on purpose:
--   production has 7 app ids shared by two rows each (e.g. hades-2 / hades-ii) that need a
--   manual merge first; the sync skips those rows and lists them in its report.
--
-- Backward compatible: one nullable column, one new table, one index. The deployed app does
-- not read any of them.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
COMMENT ON COLUMN public.games.last_synced_at IS 'When scripts/catalog-sync.ts last changed this row (NULL = never).';

CREATE INDEX IF NOT EXISTS idx_games_steam_app_id ON public.games (steam_app_id) WHERE steam_app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalog_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL CHECK (mode IN ('dry-run', 'apply')),
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

COMMENT ON TABLE public.catalog_sync_runs IS 'One row per applied catalog sync run (scripts/catalog-sync.ts). Service role only.';

CREATE INDEX IF NOT EXISTS idx_catalog_sync_runs_started_at ON public.catalog_sync_runs (started_at DESC);

ALTER TABLE public.catalog_sync_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.catalog_sync_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.catalog_sync_runs TO service_role;
