import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getProfileData } from '@/lib/server/profile';
import { MyReportsView } from '@/components/my-reports/my-reports-view';

export const metadata: Metadata = {
  title: 'RunDB · My Reports',
  description: 'Track, filter, and edit the performance reports you have submitted to RunDB.',
};

// Always render fresh — a user's own reports (and their statuses) change as they submit/edit.
export const dynamic = 'force-dynamic';

export default async function MyReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent('/my-reports')}`);
  }

  const { reports, stats } = await getProfileData(user.id);

  return <MyReportsView reports={reports} stats={stats} />;
}
