import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function EmailConfirmedPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl">Email confirmed</CardTitle>
          <CardDescription className="pt-2 text-base">
            Your email address has been verified and your account is now active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;re all set. Welcome to RunDB!
          </p>
          <div className="pt-2">
            <Button asChild className="w-full">
              <Link href="/">Continue to RunDB</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
