'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

const links: { href: string; label: string }[] = [
  { href: '/games', label: 'Games' },
  { href: '/reports', label: 'Reports' },
  { href: '/compatibility', label: 'Will It Run?' },
];

type SiteNavProps = {
  isAdmin: boolean;
  /** horizontal is the only product chrome; other variants kept for API compat */
  variant?: 'horizontal' | 'vertical' | 'dock' | 'ribbon';
  className?: string;
  includeHome?: boolean;
};

export function SiteNav({
  isAdmin,
  className,
}: SiteNavProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      className={cn(
        'flex max-w-[min(100%,28rem)] items-center gap-0.5 overflow-x-auto text-sm scrollbar-none',
        className
      )}
      aria-label="Primary"
    >
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'theme-nav-link shrink-0 transition',
            !isActive(href) && 'hover:text-foreground'
          )}
        >
          {label}
        </Link>
      ))}
      {isAdmin && (
        <>
          <Link
            href="/admin"
            className="theme-nav-link shrink-0 font-medium text-amber-400 transition hover:text-amber-300"
            aria-current={isActive('/admin') ? 'page' : undefined}
          >
            Admin
          </Link>
          <Link
            href="/dashboard"
            className="theme-nav-link hidden shrink-0 font-medium text-amber-400 transition hover:text-amber-300 sm:inline-flex"
            aria-current={isActive('/dashboard') ? 'page' : undefined}
          >
            <span className="inline-flex items-center gap-1">
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
              Dashboard
            </span>
          </Link>
        </>
      )}
    </nav>
  );
}

