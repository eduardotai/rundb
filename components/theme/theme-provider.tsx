'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** Light/dark via a `.dark` class on <html>; follows the OS until the user picks one. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
