import Link from 'next/link';
import { Button } from '@/components/ui/button';

const REASON_COPY: Record<string, { title: string; body: string }> = {
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
  db_error: {
    title: 'Could not save Steam link',
    body: 'Steam verified successfully, but saving the link failed (usually a missing database table or RLS policy). An admin needs to apply supabase/incremental-steam-linked-accounts.sql, then try again.',
  },
};

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const reason = typeof sp.reason === 'string' ? sp.reason : '';
  const known = reason ? REASON_COPY[reason] : undefined;

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {known?.title ?? 'Authentication Error'}
      </h1>
      <p className="mt-4 text-muted-foreground">
        {known?.body ??
          "Sorry, we couldn't complete the sign-in or account-link process. This can happen if the link expired or there was a configuration issue."}
      </p>
      {reason && (
        <p className="mt-3 font-mono text-xs text-muted-foreground/80">
          reason: {reason}
        </p>
      )}
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href="/profile">Back to Profile</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
