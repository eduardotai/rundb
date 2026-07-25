'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/auth-button';
import { MyRigIndicator } from '@/components/my-rig-indicator';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { cn } from '@/lib/utils';

type AuthUser = {
  id: string;
  email?: string;
  username?: string;
  avatarUrl?: string;
  user_metadata?: {
    username?: string;
    full_name?: string;
    avatar_url?: string;
  };
} | null;

type ThemeShellProps = {
  user: AuthUser;
  isAdmin: boolean;
  children: React.ReactNode;
};

function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn('theme-logo flex items-center gap-0.5 font-semibold tracking-tight', className)}
    >
      <span className="text-foreground">Run</span>
      <span className="text-muted-foreground">DB</span>
    </Link>
  );
}

export function ThemeShell({ user, isAdmin, children }: ThemeShellProps) {
  return (
    <div className="theme-shell flex min-h-full flex-col">
      <header className="theme-header sticky top-0 z-50 flex items-center">
        <div className="theme-header-inner mx-auto flex h-full w-full items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3 md:gap-5">
            <Logo className="shrink-0" />
            <SiteNav isAdmin={isAdmin} variant="horizontal" />
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <MyRigIndicator />
            <AuthButton user={user} />
            {!user && (
              <Button asChild size="sm" className="hidden md:inline-flex">
                <Link href="/auth/sign-up">Sign up</Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
              <Link href="/submit">Submit Report</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
