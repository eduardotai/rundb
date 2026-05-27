import { createClient } from '@/lib/supabase/server';
import { ProfileRigEditor } from '@/components/profile-rig-editor';

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-2 text-muted-foreground">
        Manage your account and &quot;My Rig&quot; hardware profile. Saved to the Supabase <code>profiles</code> table.
      </p>

      {!user ? (
        <div className="mt-8 rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-lg font-medium">Sign in to manage your profile and My Rig.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the &quot;Sign in&quot; or &quot;Sign up&quot; buttons in the header. We support Google, Discord, email &amp; password, or continue as Guest.
            Guest accounts work fully for saving rigs locally.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <a href="/auth/sign-in" className="text-sm text-primary hover:underline">Sign in →</a>
            <a href="/auth/sign-up" className="text-sm text-primary hover:underline">Create account →</a>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <ProfileRigEditor user={user} />
        </div>
      )}

      <div className="mt-10 text-xs text-muted-foreground">
        Phase 0 real-data foundation: Auth (anonymous + OAuth) + profiles table persistence live.
        My Rig data here takes precedence over localStorage for future features.
      </div>
    </div>
  );
}
