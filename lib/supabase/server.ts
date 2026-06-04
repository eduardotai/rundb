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
    // No-op stub for fully local operation. Supports common chains used by actions (submitReportAction)
    // and server components so we never get "xxx is not a function" crashes leading to 500s.
    // All ops return error results (or empty) instead of throwing, so callers see clean errors.
    const empty = async () => ({ data: null, error: { message: 'Supabase not configured', code: 'NOT_CONFIGURED' } })
    const emptyList = async () => ({ data: [], error: null, count: 0 })
    const emptyCount = async () => ({ data: null, error: null, count: 0 })
    const eqChain = () => ({
      maybeSingle: empty,
      single: empty,
      gte: () => emptyCount(),
      eq: () => eqChain(),
    })
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      from: () => ({
        select: (_: any, opts?: { head?: boolean; count?: string }) => {
          if (opts?.head && opts?.count === 'exact') {
            return {
              eq: () => eqChain(),
              gte: () => emptyCount(),
              // allow further chaining if needed
            }
          }
          return {
            eq: () => eqChain(),
            order: () => ({ limit: () => emptyList() }),
            limit: () => emptyList(),
          }
        },
        insert: () => ({ select: () => ({ single: empty }) }),
        update: () => ({ eq: () => empty }),
        delete: () => ({ eq: () => empty }),
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
