-- Incremental migration: Username uniqueness enforcement + availability RPC
-- Purpose: Prevent registering duplicate usernames (case-insensitive) and provide
--          a safe RPC for the signup form to check availability before creating the auth user.
--
-- Apply this to local Supabase (SQL Editor in Studio at http://localhost:54323)
-- or include it in your migration / reset process.
--
-- The main schema.sql already contains these definitions for fresh setups.

-- 1. Case-insensitive unique index on username (the proper way to enforce
--    uniqueness on an expression like lower(username) in Postgres).
--    This prevents duplicate usernames (case-insensitive) at the DB level.
--    Multiple NULLs are allowed (for guests etc.).
DROP INDEX IF EXISTS profiles_username_unique;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique 
  ON public.profiles (lower(username));

-- 2. RPC for pre-registration check (SECURITY DEFINER so anon can call it safely).
--    Returns true if the (trimmed) username is already used by someone else.
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

-- Allow the signup page (anon key) and authenticated users to call the check.
GRANT EXECUTE ON FUNCTION public.is_username_taken(text) TO anon, authenticated;

-- Notes:
-- - The public read policy for basic profile fields ("Public can view basic profile info for report authors")
--   added in incremental-security-rls.sql provides a fallback for direct .from('profiles') queries.
-- - If you have existing duplicate usernames (different casing), this CREATE UNIQUE INDEX will fail.
--   Deduplicate first (e.g. UPDATE or DELETE rows so lower(username) values are unique) then retry.
-- - After applying, test by trying to sign up with an existing email and an existing username.
-- - This file + the matching block in schema.sql use the correct Postgres syntax (unique index on expression).
