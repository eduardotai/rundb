import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AuthCodeErrorPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Authentication Error</h1>
      <p className="mt-4 text-muted-foreground">
        Sorry, we couldn&apos;t complete the sign-in process. This can happen if the link expired or there was a configuration issue.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    </div>
  );
}
