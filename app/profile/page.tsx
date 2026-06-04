import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getProfileData } from '@/lib/server/profile';
import { ProfileView, type ProfileViewUser } from '@/components/profile/profile-view';

export const metadata: Metadata = {
  title: 'RunDB · Your Profile',
  description: 'Your RunDB creator profile — rig, reports, credibility, and account.',
};

export default async function ProfilePage({ searchParams }: { searchParams?: Promise<{ steam_linked?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-2xl font-semibold text-white">
            ?
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Sign in to view your profile</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Track your submitted reports, credibility, and saved rig in one place. We support
            Google, Discord, email &amp; password, or continue as Guest — guest profiles work fully.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/auth/sign-in"
              className="inline-flex h-10 items-center rounded-md bg-white px-5 text-sm font-medium text-black hover:bg-white/90"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-up"
              className="inline-flex h-10 items-center rounded-md border border-input px-5 text-sm font-medium hover:bg-accent"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const sp = (await searchParams) || {};
  const steamLinked = sp.steam_linked === '1';
  const data = await getProfileData(user.id);

  const meta = (user.user_metadata ?? {}) as {
    username?: string;
    full_name?: string;
    avatar_url?: string;
  };
  const provider = (user.app_metadata as { provider?: string } | undefined)?.provider;
  const isAnonymous =
    Boolean((user as { is_anonymous?: boolean }).is_anonymous) ||
    provider === 'anonymous' ||
    !user.email;

  const viewUser: ProfileViewUser = {
    id: user.id,
    email: user.email ?? undefined,
    username: meta.username,
    fullName: meta.full_name,
    avatarUrl: meta.avatar_url,
    provider,
    isAnonymous,
    createdAt: user.created_at,
  };

  return <ProfileView user={viewUser} data={data} steamLinked={steamLinked} />;
}
