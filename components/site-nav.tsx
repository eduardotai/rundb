'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const links = [
  { href: '/games', label: 'Browse Games' },
  { href: '/reports', label: 'Reports' },
  { href: '/compatibility', label: 'Will It Run?' },
];

// Desktop nav with active-route indication. Kept as a small client island so
// SiteHeader can stay a server component (it does the auth/role lookups).
export function SiteNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="hidden items-center gap-1 text-sm md:flex">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'relative rounded-md px-2.5 py-1.5 transition',
            isActive(href)
              ? 'text-foreground bg-muted/60 after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-px after:bg-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          )}
        >
          {label}
        </Link>
      ))}
      {isAdmin && (
        <>
          <Link href="/admin" className="rounded-md px-2.5 py-1.5 font-medium text-amber-400 transition hover:bg-muted/40 hover:text-amber-300">Admin</Link>
          <Link href="/dashboard" className="rounded-md px-2.5 py-1.5 font-medium text-amber-400 transition hover:bg-muted/40 hover:text-amber-300">Dashboard</Link>
        </>
      )}
    </nav>
  );
}
