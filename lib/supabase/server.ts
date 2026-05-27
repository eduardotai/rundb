import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { withAuthTimeouts } from '@/lib/supabase/auth-timeout'

/**
 * Defensive Supabase server client (see client.ts for full rationale).
 * Prevents middleware + server components from hanging or erroring when
 * no valid Supabase project is configured (the documented "zero-config" mode).
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // No-op stub for fully local operation
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    } as any
  }

  const cookieStore = await cookies()

  return withAuthTimeouts(
    createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
          }
        },
      },
    })
  )
}
