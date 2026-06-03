'use client';

import Link from 'next/link';
import { ThumbsUp, Clock, CheckCircle2, XCircle, Flag } from 'lucide-react';
import { PerformanceBadge } from '@/components/performance-badge';
import type { ProfileReportLite } from '@/lib/server/profile';
import { cn } from '@/lib/utils';

function StatusPill({ status }: { status: ProfileReportLite['status'] }) {
  const map = {
    approved: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: 'Live',
      cls: 'text-[var(--tier-excellent)] border-[#14532d] bg-[var(--tier-excellent-bg)]',
    },
    pending: {
      icon: <Clock className="h-3 w-3" />,
      label: 'Pending',
      cls: 'text-[var(--tier-playable)] border-[#713f12] bg-[var(--tier-playable-bg)]',
    },
    rejected: {
      icon: <XCircle className="h-3 w-3" />,
      label: 'Rejected',
      cls: 'text-[var(--tier-unplayable)] border-[#991b1b] bg-[var(--tier-unplayable-bg)]',
    },
    flagged: {
      icon: <Flag className="h-3 w-3" />,
      label: 'Flagged',
      cls: 'text-[var(--tier-struggling)] border-[#7c2d12] bg-[var(--tier-struggling-bg)]',
    },
  }[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        map.cls
      )}
    >
      {map.icon}
      {map.label}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ProfileReportsList({
  reports,
  emptyMessage = 'No reports yet.',
  limit,
}: {
  reports: ProfileReportLite[];
  emptyMessage?: string;
  limit?: number;
}) {
  const shown = limit ? reports.slice(0, limit) : reports;

  if (shown.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        <Link
          href="/submit"
          className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
        >
          Submit your first report →
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {shown.map((r) => (
        <li
          key={r.id}
          className="report-card flex items-center gap-4 px-4 py-3 hover:bg-muted/30"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {r.gameName}
              </span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {[r.gpu, r.resolution, r.settingsPreset].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <ThumbsUp className="h-3.5 w-3.5" />
            <span className="font-mono tabular-nums">{r.voteScore ?? r.helpfulVotes}</span>
          </div>

          <div className="text-right">
            <div className="font-mono text-xl font-semibold tabular-nums leading-none text-foreground">
              {Math.round(r.avgFps)}
            </div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              fps
            </div>
          </div>

          <PerformanceBadge tier={r.performanceTier} size="sm" />

          <div className="hidden w-20 text-right text-[11px] text-muted-foreground md:block">
            {formatDate(r.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}
