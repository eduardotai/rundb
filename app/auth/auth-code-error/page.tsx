import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AUTH_ERROR_COPY } from '@/lib/auth-error-copy';

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const reason = typeof sp.reason === 'string' ? sp.reason : '';
  const known = reason && Object.hasOwn(AUTH_ERROR_COPY, reason) ? AUTH_ERROR_COPY[reason] : undefined;

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
