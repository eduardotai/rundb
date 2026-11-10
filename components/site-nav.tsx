'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PRIMARY_LINKS: { href: string; label: string }[] = [
  { href: '/games', label: 'Games' },
  { href: '/reports', label: 'Reports' },
  { href: '/compatibility', label: 'Will it run?' },
];

export function useIsActive() {
  const pathname = usePathname();
  return (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };
}

type SiteNavProps = {
  isAdmin: boolean;
  /** horizontal is the only product chrome; other variants kept for API compat */
  variant?: 'horizontal' | 'vertical' | 'dock' | 'ribbon';
  className?: string;
  includeHome?: boolean;
};

export function SiteNav({ isAdmin, className }: SiteNavProps) {
  const isActive = useIsActive();

  return (
    <nav className={cn('items-center gap-1 text-sm', className)} aria-label="Primary">
      {PRIMARY_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? 'page' : undefined}
          className="theme-nav-link shrink-0"
        >
          {label}
        </Link>
      ))}
      {isAdmin && (
        <>
          <Link
            href="/admin"
            className="theme-nav-link shrink-0 text-brand"
            aria-current={isActive('/admin') ? 'page' : undefined}
          >
            Admin
          </Link>
          {process.env.NODE_ENV === 'development' && (
            <Link
              href="/dashboard"
              className="theme-nav-link hidden shrink-0 text-brand xl:inline-flex"
              aria-current={isActive('/dashboard') ? 'page' : undefined}
            >
              <span className="inline-flex items-center gap-1">
                <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
                Dashboard
              </span>
            </Link>
          )}
        </>
      )}
    </nav>
  );
}
