import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSafeAuthRedirectPath } from '@/lib/auth-redirect'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const { searchParams } = url
  const code = searchParams.get('code')
  const next = getSafeAuthRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Sync nickname from auth metadata → public profiles so report cards can show "by Nick".
      // Sign-up stores username only in user_metadata; ReportCard enrichment reads profiles.
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const metaUsername =
          typeof user?.user_metadata?.username === 'string'
            ? String(user.user_metadata.username).trim()
            : ''
        if (user?.id && metaUsername) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .maybeSingle()
          const existing =
            typeof prof?.username === 'string' ? prof.username.trim() : ''
          if (!existing) {
            await supabase.from('profiles').upsert({
              id: user.id,
              username: metaUsername,
            })
          }
        }
      } catch (syncErr) {
        console.warn('[auth/callback] profile username sync failed (non-fatal):', syncErr)
      }
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(new URL('/auth/auth-code-error', url.origin))
}
