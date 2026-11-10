'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

/**
 * Icon swap is pure CSS (`dark:` variant), so server and client markup match and
 * there is no hydration flash. The click reads the resolved theme at event time.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
    >
      <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-transform duration-200 dark:-rotate-90 dark:scale-0" aria-hidden />
      <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-transform duration-200 dark:rotate-0 dark:scale-100" aria-hidden />
    </button>
  );
}
