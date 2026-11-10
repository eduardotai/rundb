'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, Menu, PlusCircle, X } from 'lucide-react';
import { PRIMARY_LINKS, useIsActive } from '@/components/site-nav';
import { cn } from '@/lib/utils';

/** Small-screen navigation sheet (focus-trapped Radix dialog sliding from the top). */
export function MobileMenu({ isAdmin, signedIn }: { isAdmin: boolean; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const isActive = useIsActive();
  const links = [
    ...PRIMARY_LINKS,
    ...(signedIn
      ? [
          { href: '/profile', label: 'Profile & my rig' },
          { href: '/my-reports', label: 'My reports' },
        ]
      : []),
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="grid h-9 w-9 place-items-center rounded-full text-foreground transition-colors hover:bg-muted md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(20_19_17/0.35)] backdrop-blur-[2px] dark:bg-black/60" />
        <DialogPrimitive.Content
          className="fixed inset-x-2 top-2 z-[61] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <DialogPrimitive.Title className="text-sm font-semibold">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Mobile" className="grid gap-0.5">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex h-12 items-center justify-between rounded-xl px-3 text-[0.9375rem] font-medium transition-colors hover:bg-muted',
                  isActive(href) && 'bg-muted'
                )}
              >
                {label}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </nav>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border p-2 pt-3">
            {!signedIn && (
              <Link
                href="/auth/sign-in"
                onClick={() => setOpen(false)}
                className="flex h-11 items-center justify-center rounded-xl border border-input bg-card text-sm font-medium"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/submit"
              onClick={() => setOpen(false)}
              className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground',
                signedIn && 'col-span-2'
              )}
            >
              <PlusCircle className="h-4 w-4" aria-hidden />
              Submit report
            </Link>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
