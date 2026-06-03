'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Pencil,
  Check,
  X,
  Shield,
  ShieldCheck,
  CalendarDays,
  Cpu,
  MonitorPlay,
  MemoryStick,
  Monitor,
  Copy,
  ExternalLink,
  LogOut,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileAvatar } from '@/components/profile/profile-avatar';
import { ProfileStatsGrid, TierBreakdown } from '@/components/profile/profile-stats';
import { ProfileReportsList } from '@/components/profile/profile-reports-list';
import { ProfileRigEditor } from '@/components/profile-rig-editor';
import { createClient } from '@/lib/supabase/client';
import { sanitizeFullName } from '@/lib/sanitize';
import { showUserError, showUserSuccess } from '@/lib/toast';
import type { ProfileData } from '@/lib/server/profile';
import { cn } from '@/lib/utils';

export interface ProfileViewUser {
  id: string;
  email?: string;
  username?: string;
  fullName?: string;
  avatarUrl?: string;
  provider?: string;
  isAnonymous: boolean;
  createdAt?: string;
}

interface ProfileViewProps {
  user: ProfileViewUser;
  data: ProfileData;
  steamLinked?: boolean;
}

function formatJoinDate(iso?: string | null): string {
  if (!iso) return 'recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'recently';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function isStoredProfileAvatar(url?: string | null): boolean {
  return Boolean(url && url.includes('/storage/v1/object/public/profile-avatars/'));
}

function RoleBadge({ role }: { role: 'user' | 'moderator' | 'admin' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
        <ShieldCheck className="h-3 w-3" /> Admin
      </span>
    );
  }
  if (role === 'moderator') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-400">
        <Shield className="h-3 w-3" /> Moderator
      </span>
    );
  }
  return null;
}

export function ProfileView({ user, data, steamLinked }: ProfileViewProps) {
  const { profile, stats, reports } = data;

  // Identity state (lifted so the hero updates live after an edit).
  const [username, setUsername] = useState(
    profile?.username || user.username || user.fullName || ''
  );
  const [avatarUrl, setAvatarUrl] = useState(
    isStoredProfileAvatar(profile?.avatarUrl) ? profile?.avatarUrl || '' : ''
  );
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(username);
  const [draftAvatar, setDraftAvatar] = useState(avatarUrl);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('overview');

  const role = profile?.role ?? 'user';
  const displayName =
    username || user.email || (user.isAnonymous ? 'Anonymous Guest' : 'RunDB User');
  const joinDate = formatJoinDate(profile?.createdAt || user.createdAt);

  const accountType = user.isAnonymous
    ? 'Guest session'
    : user.provider && user.provider !== 'email'
      ? `${user.provider[0].toUpperCase()}${user.provider.slice(1)} account`
      : 'Email account';

  const startEdit = () => {
    setDraftName(username);
    setSelectedAvatarFile(null);
    setAvatarPreview('');
    setRemoveAvatar(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setSelectedAvatarFile(null);
    setAvatarPreview('');
    setRemoveAvatar(false);
    setEditing(false);
  };

  const handleAvatarSelection = (file: File | null) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);

    if (!file) {
      setSelectedAvatarFile(null);
      setAvatarPreview('');
      return;
    }

    setSelectedAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const saveIdentity = async () => {
    const safeName = sanitizeFullName(draftName).slice(0, 32);

    setSaving(true);
    try {
      const formData = new FormData();
      formData.set('username', safeName);
      if (selectedAvatarFile) formData.set('avatar', selectedAvatarFile);
      if (removeAvatar) formData.set('removeAvatar', 'true');

      const response = await fetch('/api/profile/identity', {
        method: 'POST',
        body: formData,
      });
      const result = (await response.json().catch(() => ({}))) as {
        username?: string;
        avatarUrl?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || 'Could not update your profile. Please try again.');
      }

      setUsername(result.username ?? safeName);
      setAvatarUrl(result.avatarUrl ?? avatarUrl);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setSelectedAvatarFile(null);
      setAvatarPreview('');
      setRemoveAvatar(false);
      setEditing(false);
      showUserSuccess('Profile updated!');
    } catch (error) {
      showUserError(error instanceof Error ? error.message : 'Could not update your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch {
      showUserError('Failed to sign out. Please try again.');
    }
  };

  const hasRig = Boolean(profile?.mainCpu || profile?.mainGpu);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* ===== Hero ===== */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        {/* Banner */}
        <div className="h-28 bg-gradient-to-r from-primary/25 via-accent/15 to-transparent sm:h-32">
          <div
            className="h-full w-full opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 30%, rgba(103,232,249,0.25), transparent 40%), radial-gradient(circle at 80% 10%, rgba(34,211,238,0.18), transparent 45%)',
            }}
          />
        </div>

        <div className="px-5 pb-5 sm:px-7 sm:pb-6">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <ProfileAvatar
                name={displayName}
                avatarUrl={editing ? (removeAvatar ? '' : avatarPreview || avatarUrl) : avatarUrl}
                size={104}
                className="shadow-lg"
              />
              {!editing && (
                <div className="pb-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                      {displayName}
                    </h1>
                    <RoleBadge role={role} />
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="h-3 w-3" /> {stats.credibilityBadge}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> Joined {joinDate}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> {accountType}
                    </span>
                    {stats.topGpu && (
                      <span className="inline-flex items-center gap-1">
                        <MonitorPlay className="h-3.5 w-3.5" /> Mostly {stats.topGpu}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!editing && (
              <Button variant="outline" size="sm" onClick={startEdit} className="self-start sm:self-auto">
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit profile
              </Button>
            )}
          </div>

          {/* Inline editor */}
          {editing && (
            <div className="mt-4 grid gap-3 rounded-xl border border-border bg-background/60 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <Label htmlFor="edit-username" className="text-xs text-muted-foreground">
                  Display name
                </Label>
                <Input
                  id="edit-username"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Your nickname (no real name)"
                  maxLength={32}
                  disabled={saving}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Label htmlFor="edit-avatar-file" className="text-xs text-muted-foreground">
                  Profile photo
                </Label>
                <Input
                  id="edit-avatar-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleAvatarSelection(e.target.files?.[0] ?? null)}
                  disabled={saving}
                  className="max-w-xs cursor-pointer text-sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button onClick={saveIdentity} disabled={saving} size="sm">
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                </Button>
                {avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleAvatarSelection(null);
                      setRemoveAvatar(true);
                    }}
                    disabled={saving || removeAvatar}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove photo
                  </Button>
                )}
                <p className="ml-auto text-[11px] text-muted-foreground">
                  <Upload className="mr-1 inline h-3 w-3" />
                  JPEG, PNG, or WebP. Stored as a sanitized 512px WebP.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== Stats ===== */}
      <div className="mt-5">
        <ProfileStatsGrid stats={stats} />
      </div>

      {/* ===== Tabs ===== */}
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rig">My Rig</TabsTrigger>
          <TabsTrigger value="reports">
            Reports{stats.totalReports > 0 ? ` (${stats.totalReports})` : ''}
          </TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        {/* --- Overview --- */}
        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Rig summary */}
            <div className="rounded-xl border border-border bg-card p-5 lg:col-span-1">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  My Rig
                </h2>
                {hasRig && (
                  <button
                    onClick={() => setTab('rig')}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>

              {hasRig ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <RigRow icon={<Cpu className="h-4 w-4" />} label="CPU" value={profile?.mainCpu} />
                  <RigRow
                    icon={<MonitorPlay className="h-4 w-4" />}
                    label="GPU"
                    value={profile?.mainGpu}
                  />
                  <RigRow
                    icon={<MemoryStick className="h-4 w-4" />}
                    label="RAM"
                    value={profile?.mainRam ? `${profile.mainRam} GB` : null}
                  />
                  <RigRow
                    icon={<Monitor className="h-4 w-4" />}
                    label="Resolution"
                    value={profile?.preferredResolution}
                  />
                </dl>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-border p-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    You haven&apos;t set up your rig yet.
                  </p>
                  <button
                    onClick={() => setTab('rig')}
                    className="mt-2 text-sm font-medium text-primary hover:underline"
                  >
                    Add your hardware →
                  </button>
                </div>
              )}
            </div>

            {/* Tier breakdown + recent */}
            <div className="space-y-5 lg:col-span-2">
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Performance breakdown
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  How your benchmarked games are distributed across performance tiers.
                </p>
                <div className="mt-4">
                  <TierBreakdown stats={stats} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent reports
                  </h2>
                  {reports.length > 5 && (
                    <button
                      onClick={() => setTab('reports')}
                      className="text-xs text-primary hover:underline"
                    >
                      View all
                    </button>
                  )}
                </div>
                <ProfileReportsList
                  reports={reports}
                  limit={5}
                  emptyMessage="You haven't submitted any reports yet."
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* --- My Rig --- */}
        <TabsContent value="rig" className="mt-5">
          <ProfileRigEditor user={user} />

          {steamLinked && (
            <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-400">
              Steam account linked successfully! You can now manage persistent devices/rigs and get verified badges on reports.
            </div>
          )}
        </TabsContent>

        {/* --- Reports --- */}
        <TabsContent value="reports" className="mt-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Every report you&apos;ve submitted, including ones still in moderation.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/submit">Submit new</Link>
            </Button>
          </div>
          <ProfileReportsList
            reports={reports}
            emptyMessage="You haven't submitted any reports yet."
          />
        </TabsContent>

        {/* --- Account --- */}
        <TabsContent value="account" className="mt-5">
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <AccountRow label="Display name" value={displayName} />
            {user.email && <AccountRow label="Email" value={user.email} />}
            <AccountRow label="Account type" value={accountType} />
            <AccountRow label="Role" value={role.charAt(0).toUpperCase() + role.slice(1)} />
            <AccountRow label="Member since" value={joinDate} />
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-sm text-muted-foreground">User ID</span>
              <button
                onClick={copyId}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:text-primary"
                title="Copy full ID"
              >
                <code className="rounded bg-muted px-1.5 py-0.5">{user.id.slice(0, 8)}…</code>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--tier-excellent)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5 opacity-60" />
                )}
              </button>
            </div>
          </div>

          {user.isAnonymous && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-amber-300">You&apos;re using a guest session</p>
              <p className="mt-1 text-muted-foreground">
                Create a permanent account to keep your rig, reports, and credibility across
                devices.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/auth/sign-up">
                  Create account <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
            <div>
              <p className="text-sm font-medium text-foreground">Sign out</p>
              <p className="text-xs text-muted-foreground">End your session on this device.</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RigRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd className={cn('truncate text-sm', value ? 'text-foreground' : 'text-muted-foreground')}>
          {value || '—'}
        </dd>
      </div>
    </div>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
