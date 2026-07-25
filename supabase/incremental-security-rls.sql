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

DROP POLICY IF EXISTS "Anyone can insert reports (self or anonymous)" ON public.reports;
DROP POLICY IF EXISTS "Authenticated users can insert reports" ON public.reports;

-- Client-side INSERT is closed: anon/authenticated must not write reports via PostgREST.
-- submitReportAction validates, rate-limits, and inserts with createServiceClient()
-- (service_role bypasses RLS) — same pattern as updateReportAction / moderateReportAction.
REVOKE INSERT ON public.reports FROM anon, authenticated;

-- Owners can read their own reports (any status). Lets rate-limit / duplicate-detection
-- count queries in submitReportAction see the user's own rows (including non-approved).
-- Public SELECT of status='approved' remains via the separate public-read policy.
DROP POLICY IF EXISTS "Users can read their own reports" ON public.reports;

CREATE POLICY "Users can read their own reports" ON public.reports
  FOR SELECT USING (user_id = auth.uid());

-- Public read of basic profile fields for report attribution + badges (see matching policy in schema.sql).
DROP POLICY IF EXISTS "Public can view basic profile info for report authors" ON public.profiles;
CREATE POLICY "Public can view basic profile info for report authors" ON public.profiles
  FOR SELECT USING (true);
