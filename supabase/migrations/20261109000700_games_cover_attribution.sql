-- games.attribution: credit line for the game's cover art.
--
-- The admin bulk import (lib/server/admin-moderation.ts bulkImportGames) writes and
-- returns games.attribution, and the game mapper (lib/data.ts) shows it under the hero
-- cover on /games/[slug]. Production never had the column, so every bulk import failed
-- with "column attribution does not exist". Cover art comes from third parties (Steam CDN,
-- IGDB) whose terms/copyright expect a credit line, so the data is kept, not dropped.
--
-- Backward compatible: nullable column, no default rewrite, existing code that does not
-- select it is unaffected. Public read like the rest of games (anon SELECT).

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS attribution text;

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_attribution_length;
ALTER TABLE public.games
  ADD CONSTRAINT games_attribution_length CHECK (attribution IS NULL OR char_length(attribution) <= 300);

COMMENT ON COLUMN public.games.attribution IS 'Credit line for cover art (e.g. "© Valve Corporation. Steam CDN library art."). Shown on the game page.';
