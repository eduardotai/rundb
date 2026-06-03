import { NextResponse } from 'next/server';
import { getCommitDiff } from '@/lib/server/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /dashboard/diff?hash=<sha> — returns one commit's unified diff on demand.
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get('hash') ?? '';
  const result = await getCommitDiff(hash);
  if (!result) {
    return NextResponse.json({ error: 'diff unavailable' }, { status: 404 });
  }
  return NextResponse.json(result);
}
