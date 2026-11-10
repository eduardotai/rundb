'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/auth-button';
import { MyRigIndicator } from '@/components/my-rig-indicator';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { GlobalSearch } from '@/components/global-search';
import { MobileMenu } from '@/components/mobile-menu';
import { ThemeToggle } from '@/components/theme/theme-toggle';
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

export function LogoMark({ className }: { className?: string }) {
  // Three rising bars: "frames getting faster" — reads at 16px.
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm',
        className
      )}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
        <rect x="1.5" y="9" width="3" height="5.5" rx="1" />
        <rect x="6.5" y="5.5" width="3" height="9" rx="1" />
        <rect x="11.5" y="1.5" width="3" height="13" rx="1" />
      </svg>
    </span>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn('theme-logo flex items-center gap-2 font-semibold tracking-tight', className)}
      aria-label="RunDB home"
    >
      <LogoMark />
      <span>
        <span className="text-foreground">Run</span>
        <span className="text-muted-foreground">DB</span>
      </span>
    </Link>
  );
}

export function ThemeShell({ user, isAdmin, children }: ThemeShellProps) {
  return (
    <div className="theme-shell flex min-h-full flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="theme-header sticky top-0 z-50 flex items-center">
        <div className="theme-header-inner mx-auto flex h-full w-full items-center gap-3 px-4 sm:px-6">
          <Logo className="mr-1 shrink-0 lg:mr-3" />
          <SiteNav isAdmin={isAdmin} variant="horizontal" className="hidden md:flex" />
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <GlobalSearch variant="header" hotkey className="hidden w-56 lg:flex xl:w-64" />
            <GlobalSearch variant="icon" className="lg:hidden" />
            <MyRigIndicator />
            <ThemeToggle />
            <span className="hidden md:block">
              <AuthButton user={user} />
            </span>
            <Button asChild size="sm" className="hidden rounded-full pl-3 md:inline-flex">
              <Link href="/submit">
                <Plus className="h-4 w-4" aria-hidden />
                Submit report
              </Link>
            </Button>
            <MobileMenu isAdmin={isAdmin} signedIn={Boolean(user)} />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
