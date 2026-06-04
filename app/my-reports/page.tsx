import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function MyReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent('/my-reports')}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">My Reports</h1>
      <p className="mt-2 text-muted-foreground">
        Your submitted reports will appear here.
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        <p>You haven&apos;t submitted any reports yet. Real submissions (Phase 2) are stored in Supabase and will appear here after full read migration + My Reports query impl.</p>
        <p className="mt-2 text-xs">Reports publish immediately; community votes and automatic flags drive credibility.</p>
      </div>
    </div>
  );
}
