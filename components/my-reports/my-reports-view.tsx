'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ProfileReportsList } from '@/components/profile/profile-reports-list';
import { EditReportDialog } from '@/components/my-reports/edit-report-dialog';
import type { ProfileReportLite, ProfileStats } from '@/lib/server/profile';
import type { PerformanceTier } from '@/lib/types';
import { Search, Plus, ThumbsUp, Gamepad2, Gauge, FileText, X } from 'lucide-react';

type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected' | 'flagged';
type SortKey = 'newest' | 'oldest' | 'fps' | 'votes';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'approved', label: 'Live' },
  { value: 'pending', label: 'Pending' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'rejected', label: 'Rejected' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'fps', label: 'Highest FPS' },
  { value: 'votes', label: 'Most votes' },
];

const TIER_ORDER: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];
const TIER_VAR: Record<PerformanceTier, string> = {
  Excellent: 'var(--tier-excellent)',
  Good: 'var(--tier-good)',
  Playable: 'var(--tier-playable)',
  Struggling: 'var(--tier-struggling)',
  Unplayable: 'var(--tier-unplayable)',
};

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TierBar({ tierCounts, total }: { tierCounts: Record<PerformanceTier, number>; total: number }) {
  const present = TIER_ORDER.filter((t) => tierCounts[t] > 0);
  if (total === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">Tier distribution</div>
      <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {present.map((t) => (
          <div
            key={t}
            style={{ width: `${(tierCounts[t] / total) * 100}%`, backgroundColor: TIER_VAR[t] }}
            title={`${t}: ${tierCounts[t]}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {present.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TIER_VAR[t] }} />
            {t} <span className="font-mono tabular-nums text-foreground">{tierCounts[t]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MyReportsView({
  reports,
  stats,
}: {
  reports: ProfileReportLite[];
  stats: ProfileStats;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [editing, setEditing] = useState<ProfileReportLite | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = reports.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!q) return true;
      return (
        r.gameName.toLowerCase().includes(q) ||
        r.gpu.toLowerCase().includes(q) ||
        r.cpu.toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'fps':
          return b.avgFps - a.avgFps;
        case 'votes':
          return (b.voteScore ?? b.helpfulVotes) - (a.voteScore ?? a.helpfulVotes);
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return list;
  }, [reports, query, status, sort]);

  const hasFilters = query.trim() !== '' || status !== 'all';
  const openEdit = (r: ProfileReportLite) => {
    setEditing(r);
    setEditOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My Reports</h1>
          <p className="mt-1 text-muted-foreground">
            Track, filter, and edit the performance reports you&apos;ve submitted.
          </p>
        </div>
        <Link href="/submit">
          <Button className="gap-1.5 bg-white font-medium text-black hover:bg-white/90">
            <Plus className="h-4 w-4" />
            Submit a report
          </Button>
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="mt-8">
          <ProfileReportsList
            reports={[]}
            emptyMessage="You haven't submitted any reports yet. Reports publish immediately and appear here."
          />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<FileText className="h-3.5 w-3.5" />}
              label="Reports"
              value={stats.totalReports}
              sub={`${stats.approvedReports} live · ${stats.pendingReports} pending`}
            />
            <StatCard
              icon={<ThumbsUp className="h-3.5 w-3.5" />}
              label="Vote score"
              value={stats.voteScore}
              sub={`${stats.helpfulVotes} up · ${stats.downvoteVotes} down`}
            />
            <StatCard
              icon={<Gamepad2 className="h-3.5 w-3.5" />}
              label="Games covered"
              value={stats.gamesCovered}
              sub={stats.topGpu ? `Top GPU: ${stats.topGpu}` : undefined}
            />
            <StatCard
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Avg FPS"
              value={stats.avgFps ?? '—'}
              sub={`${stats.credibilityBadge} reporter`}
            />
          </div>

          <div className="mt-3">
            <TierBar tierCounts={stats.tierCounts} total={stats.totalReports} />
          </div>

          {/* Toolbar */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search game, GPU, or CPU…"
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              />
            </div>

            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort</span>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing {filtered.length} of {reports.length}{' '}
              {reports.length === 1 ? 'report' : 'reports'}
            </span>
            {hasFilters && (
              <button
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                }}
                className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
              >
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>

          {/* List */}
          <div className="mt-4">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No reports match your filters.
              </div>
            ) : (
              <ProfileReportsList reports={filtered} onEdit={openEdit} />
            )}
          </div>
        </>
      )}

      <EditReportDialog
        report={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
