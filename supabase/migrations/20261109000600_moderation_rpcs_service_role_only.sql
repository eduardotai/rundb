-- Moderation RPCs: service role only.
--
-- Every caller is server-side: lib/server/admin-moderation.ts is only invoked from
-- app/actions/admin.ts and app/actions/reports.ts with createServiceClient(), after
-- getStaffAccess() verified the session (which also honours the ADMIN_EMAILS allowlist).
-- No browser code calls these RPCs (tests/moderation-rpc-callers.test.ts guards that).
-- Removing EXECUTE from `authenticated` closes the direct PostgREST path for moderator
-- sessions, so the server action is the single entry point (validation, friendly errors,
-- one audit trail shape).
--
-- Backward compatible: the deployed app already calls these with the service role.
-- The functions keep their internal authenticated-caller branch (now unreachable); no
-- function body changes.

REVOKE EXECUTE ON FUNCTION public.moderate_reports(uuid[], public.report_status, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_reports(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.moderate_report_images(uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_report_images(uuid[], uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.moderate_reports(uuid[], public.report_status, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_reports(uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.moderate_report_images(uuid[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_report_images(uuid[], uuid) TO service_role;
