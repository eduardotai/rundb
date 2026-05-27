'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Centralized React Query setup for Next.js App Router (RunDB Phase 3).
// Single QueryClient instance for the entire app ensures proper caching,
// deduping, and no unnecessary refetches across pages and navigations.
// Matches the defaults previously duplicated per-page (staleTime 5m, gcTime 30m).
// Standard pattern per TanStack + Next.js docs: 'use client' wrapper component.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes — community data good for caching
            gcTime: 1000 * 60 * 30,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
