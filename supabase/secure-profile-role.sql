-- RunDB: prevent clients from self-assigning staff roles.
-- Run after the base schema on existing Supabase projects.

DROP POLICY IF EXISTS "Users can view and update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile fields" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND role = 'user');

CREATE POLICY "Users can update own profile fields" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

REVOKE INSERT, UPDATE ON profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON profiles TO anon, authenticated;
GRANT INSERT (id, username, avatar_url, main_cpu, main_gpu, main_ram, preferred_resolution)
  ON profiles TO authenticated;
GRANT UPDATE (id, username, avatar_url, main_cpu, main_gpu, main_ram, preferred_resolution)
  ON profiles TO authenticated;
GRANT ALL ON profiles TO service_role;
