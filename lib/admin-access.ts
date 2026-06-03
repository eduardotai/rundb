import { createClient } from '@/lib/supabase/server'

export type StaffRole = 'user' | 'moderator' | 'admin'

export type StaffAccess = {
  user: { id: string; email?: string; username?: string } | null
  role: StaffRole
  isAdmin: boolean
  canModerate: boolean
}

function parseAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Resolve staff privileges for the current session.
 * Admin access is granted when profiles.role === 'admin' OR the user's email
 * is listed in ADMIN_EMAILS (comma-separated, server-only env var).
 */
export async function getStaffAccess(): Promise<StaffAccess> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, role: 'user', isAdmin: false, canModerate: false }
  }

  const email = user.email?.toLowerCase()
  const allowlisted = email ? parseAdminEmails().has(email) : false

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, username')
    .eq('id', user.id)
    .maybeSingle()

  const dbRole = (profile?.role as StaffRole | undefined) ?? 'user'
  const isAdmin = allowlisted || dbRole === 'admin'
  const canModerate = isAdmin || dbRole === 'moderator'

  return {
    user: { id: user.id, email: user.email, username: profile?.username ?? undefined },
    role: isAdmin ? 'admin' : dbRole,
    isAdmin,
    canModerate,
  }
}
