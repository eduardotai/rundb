import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AuthButton } from '@/components/auth-button';
import { MyRigIndicator } from '@/components/my-rig-indicator';
import { getStaffAccess } from '@/lib/admin-access';

export async function SiteHeader() {
  const { user, isAdmin } = await getStaffAccess();

  // My Rig indicator is a separate client component (full DB persistence via user_rigs/profiles for logged-in,
  // localStorage guest fallback only; see my-rig-indicator.tsx + data.ts adapter per Master Plan).
  // Auth state comes from Supabase via server client + middleware. (Some reloads on sign in/out for server parts.)

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="text-primary">Run</span>DB
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex">
            <Link href="/games" className="text-muted-foreground hover:text-foreground transition">Browse Games</Link>
            <Link href="/reports" className="text-muted-foreground hover:text-foreground transition">Reports</Link>
            <Link href="/compatibility" className="text-muted-foreground hover:text-foreground transition">Compatibility</Link>
            {isAdmin && (
              <>
                <Link href="/admin" className="text-amber-400 hover:text-amber-300 transition font-medium">Admin</Link>
                <Link href="/dashboard" className="text-amber-400 hover:text-amber-300 transition font-medium">Dashboard</Link>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <MyRigIndicator />

          <AuthButton user={user} />

          {!user && (
            <Button asChild size="sm" className="hidden md:inline-flex bg-white text-black font-medium hover:bg-white/90">
              <Link href="/auth/sign-up">Sign up</Link>
            </Button>
          )}

          <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
            <Link href="/submit">Submit Report</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
