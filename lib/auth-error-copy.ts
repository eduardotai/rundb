/**
 * Copy for /auth/auth-code-error?reason=<reason> (Steam linking and auth callbacks).
 * Every failure reason a callback can redirect with must have an entry here
 * (tests/steam-link.test.ts checks the Steam link reasons).
 */
export const AUTH_ERROR_COPY: Record<string, { title: string; body: string }> = {
  missing_state: {
    title: 'Steam link expired',
    body: 'The linking session was missing a security token. Start again from Profile → My Rig → Link Steam account.',
  },
  state_mismatch: {
    title: 'Steam link blocked',
    body: 'The browser session that started linking did not match the return from Steam. Use the same browser tab and try again.',
  },
  invalid_state: {
    title: 'Steam link invalid',
    body: 'The security token from Steam was malformed. Start the link again from your profile.',
  },
  state_expired: {
    title: 'Steam link timed out',
    body: 'Steam linking tokens expire after about 10 minutes. Start again from Profile → My Rig → Link Steam account.',
  },
  steam_verify_failed: {
    title: 'Steam could not verify the login',
    body: 'Steam rejected or we could not verify the OpenID response. Try again; if it keeps failing, check that you approved the Steam sign-in prompt.',
  },
  session_mismatch: {
    title: 'Still signed in to RunDB?',
    body: 'You must stay logged in to RunDB while Steam redirects back. Sign in again, then retry Link Steam from your profile.',
  },
  steam_already_linked: {
    title: 'Steam account already linked',
    body: 'This Steam account is already linked to another RunDB user. Each Steam account can only be linked to one RunDB account. Sign in to that account to use it, or unlink it there first.',
  },
  db_error: {
    title: 'Could not save Steam link',
    body: 'Steam verified successfully, but saving the link failed (usually a missing database table or RLS policy). An admin needs to apply the database migrations in supabase/migrations, then try again.',
  },
};
