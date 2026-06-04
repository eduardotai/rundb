-- RunDB: prevent clients from self-assigning staff roles.
-- Run after the base schema on existing Supabase projects.

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

DROP TRIGGER IF EXISTS profiles_prevent_client_role_change ON profiles;
CREATE TRIGGER profiles_prevent_client_role_change
BEFORE UPDATE OF role ON profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_role_change();

DROP POLICY IF EXISTS "Users can view and update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile fields" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Public can view basic profile info for report authors" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND role = 'user');

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Public can view basic profile info for report authors" ON profiles
  FOR SELECT USING (true);
