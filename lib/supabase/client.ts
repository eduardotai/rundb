import { createBrowserClient } from '@supabase/ssr'
import { withAuthTimeouts } from '@/lib/supabase/auth-timeout'
import { createQueryStub } from '@/lib/supabase/query-stub'

/**
 * Defensive Supabase browser client.
 * 
 * The app is documented as "zero config, works instantly with no env vars".
 * Many components (header, checker, auth flows, middleware) still touch auth.
 * 
 * If the required NEXT_PUBLIC_SUPABASE_* vars are missing (or the project is dead/unreachable),
 * we return a safe no-op stub instead of crashing or hanging on every getUser() / onAuthStateChange.
 * 
 * This fixes the "infinite loading even in private window" + mysterious Google telemetry errors
 * when a stale .env.local with dead Supabase credentials is present.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // Pure local/mock mode — no network, no auth, no Google OAuth side effects.
    // All auth methods resolve instantly to "no user".
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
        signOut: async () => ({ error: null }),
        signInWithOAuth: async () => ({ error: new Error('Supabase not configured') }),
        signInWithPassword: async () => ({ error: new Error('Supabase not configured') }),
      },
      from: () => createQueryStub(),
    } as any
  }

  return withAuthTimeouts(createBrowserClient(url, key))
}
