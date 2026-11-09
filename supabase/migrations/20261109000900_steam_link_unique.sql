-- One Steam account can be linked to at most one RunDB user (owner decision).
--
-- linked_accounts already has UNIQUE (provider, provider_user_id) from the prod baseline
-- (linked_accounts_provider_provider_user_id_key); this migration asserts it (fails loudly if a
-- reset ever lost it) and makes the mirrored profiles.steam_id unique as well, replacing the
-- plain partial index with a unique one on the same column/predicate.
--
-- Backward compatible: prod had no duplicate links or duplicate profiles.steam_id when this was
-- written (read-only check before apply), and the only writer of profiles.steam_id is the Steam
-- OpenID callback, which writes it after the link itself succeeded.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.linked_accounts'::regclass
      AND conname = 'linked_accounts_provider_provider_user_id_key'
      AND contype = 'u'
  ) THEN
    ALTER TABLE public.linked_accounts
      ADD CONSTRAINT linked_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT linked_accounts_provider_provider_user_id_key ON public.linked_accounts IS
  'One external account (e.g. a Steam id) per RunDB user. The Steam callback maps violations (23505) to reason=steam_already_linked.';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_steam_id_key
  ON public.profiles USING btree (steam_id)
  WHERE steam_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_profiles_steam_id;
