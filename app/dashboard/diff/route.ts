import { NextResponse } from 'next/server';
import { getStaffAccess } from '@/lib/admin-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /dashboard/diff?hash=<sha> — returns one commit's unified diff on demand.
// Development-only (needs a git checkout) and protected: only admins (same as /dashboard page).
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'development') {
    const { isAdmin } = await getStaffAccess()
    if (!isAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const hash = new URL(request.url).searchParams.get('hash') ?? '';
    const { getCommitDiff } = await import('@/lib/server/dashboard');
    const result = await getCommitDiff(hash);
    if (!result) {
      return NextResponse.json({ error: 'diff unavailable' }, { status: 404 });
    }
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}
