-- Incremental: negative cache for lazy Steam official requirements fetch.
-- Apply in Supabase SQL Editor before deploying the lazy ensure feature.
--
-- Status values (app-enforced text, not a DB enum):
--   null          = never attempted (legacy rows)
--   'pending'     = claim in flight (stampede guard)
--   'ready'       = at least one of official_min_reqs / official_rec_reqs stored
--   'empty'       = Steam OK but no parseable PC min/rec
--   'error'       = hard failure (app missing / network after retries)
--   'rate_limited'= stopped due to 429; eligible for retry after cooldown

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS official_reqs_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS official_reqs_status text;

COMMENT ON COLUMN games.official_reqs_checked_at IS
  'When we last attempted to load Steam pc_requirements for this game.';
COMMENT ON COLUMN games.official_reqs_status IS
  'pending | ready | empty | error | rate_limited — see incremental-game-official-reqs-cache.sql';

-- Speeds optional backfill of unchecked titles with a Steam AppID.
CREATE INDEX IF NOT EXISTS idx_games_official_reqs_unchecked
  ON games (steam_app_id)
  WHERE official_reqs_checked_at IS NULL
    AND steam_app_id IS NOT NULL;
