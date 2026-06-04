import { NextResponse } from 'next/server';
import { getCommitDiff } from '@/lib/server/dashboard';
import { getStaffAccess } from '@/lib/admin-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /dashboard/diff?hash=<sha> — returns one commit's unified diff on demand.
// Protected: only admins (same as /dashboard page).
export async function GET(request: Request) {
  const { isAdmin } = await getStaffAccess()
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const hash = new URL(request.url).searchParams.get('hash') ?? '';
  const result = await getCommitDiff(hash);
  if (!result) {
    return NextResponse.json({ error: 'diff unavailable' }, { status: 404 });
  }
  return NextResponse.json(result);
}
