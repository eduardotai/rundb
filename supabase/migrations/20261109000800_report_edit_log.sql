-- report_edits: one row per successful report edit, used to rate-limit edits.
--
-- updateReportAction (lib/server/report-write.ts) counts the caller's rows in the last
-- hour before editing and inserts a row after a successful edit. Server-only: the app
-- reads/writes it with the service role; clients get no privileges (RLS on, no policies).
--
-- Backward compatible: new table only; the currently deployed app does not use it.

CREATE TABLE IF NOT EXISTS public.report_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  edited_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.report_edits IS 'Audit of report edits by their owners; rate limit for updateReportAction. Service role only.';

CREATE INDEX IF NOT EXISTS idx_report_edits_user_edited_at ON public.report_edits (user_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_edits_report_id ON public.report_edits (report_id);

ALTER TABLE public.report_edits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.report_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.report_edits TO service_role;
