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
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(new URL('/auth/auth-code-error', url.origin))
}
