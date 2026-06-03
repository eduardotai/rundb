-- RunDB security hardening for existing Supabase projects.
-- Safe to re-run: replaces vulnerable client-writable role/report policies.

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

DROP TRIGGER IF EXISTS profiles_prevent_client_role_change ON public.profiles;
CREATE TRIGGER profiles_prevent_client_role_change
BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_profile_role_change();

DROP POLICY IF EXISTS "Users can view and update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND role = 'user');

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Authenticated users can insert reports" ON public.reports;

CREATE POLICY "Authenticated users can insert reports" ON public.reports
  FOR INSERT WITH CHECK (
    status = 'pending'
    AND helpful_votes = 0
    AND moderated_by IS NULL
    AND moderated_at IS NULL
    AND moderator_notes IS NULL
    AND ((user_id IS NULL) OR (user_id = auth.uid()))
  );

-- Owners can read their own reports (any status). Without this, insert().select()
-- in submitReportAction is denied by RLS on the RETURNING row (error 42501
-- "new row violates row-level security policy for table reports") because the
-- only other SELECT policy restricts reads to status = 'approved'. This also lets
-- the rate-limit / duplicate-detection count queries see the user's own pending rows.
DROP POLICY IF EXISTS "Users can read their own reports" ON public.reports;

CREATE POLICY "Users can read their own reports" ON public.reports
  FOR SELECT USING (user_id = auth.uid());
