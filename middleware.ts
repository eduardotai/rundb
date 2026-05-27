import { NextResponse, type NextRequest } from 'next/server'
import { getUserWithTimeout } from '@/lib/supabase/auth-timeout'

/**
 * Middleware with the same defensive logic as lib/supabase/server.ts.
 * This was the main source of "app won't load at all" when a stale .env.local
 * pointed at a dead or unreachable Supabase project.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // No Supabase configured → pure local mode, no auth work, instant response.
    return supabaseResponse
  }

  // Only create the real client when we actually have valid config.
  const { createServerClient } = await import('@supabase/ssr')
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        } catch {}
      },
    },
  })

  // Never block navigation on a slow/dead Supabase project (stale .env.local).
  await getUserWithTimeout(() => supabase.auth.getUser())

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
