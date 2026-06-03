import { FileText, Gamepad2, ShieldCheck, ThumbsUp } from 'lucide-react';
import type { ProfileStats } from '@/lib/server/profile';
import type { PerformanceTier } from '@/lib/types';
import { cn } from '@/lib/utils';

const TIER_ORDER: PerformanceTier[] = [
  'Excellent',
  'Good',
  'Playable',
  'Struggling',
  'Unplayable',
];

const TIER_BAR: Record<PerformanceTier, string> = {
  Excellent: 'bg-[var(--tier-excellent)]',
  Good: 'bg-[var(--tier-good)]',
  Playable: 'bg-[var(--tier-playable)]',
  Struggling: 'bg-[var(--tier-struggling)]',
  Unplayable: 'bg-[var(--tier-unplayable)]',
};

const TIER_DOT: Record<PerformanceTier, string> = TIER_BAR;

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
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ProfileStatsGrid({ stats }: { stats: ProfileStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={<FileText className="h-4 w-4" />}
        label="Reports"
        value={stats.totalReports}
        sub={
          stats.pendingReports > 0
            ? `${stats.approvedReports} live / ${stats.pendingReports} flagged`
            : `${stats.approvedReports} live`
        }
      />
      <StatCard
        icon={<ThumbsUp className="h-4 w-4" />}
        label="Vote score"
        value={stats.voteScore}
        sub={`${stats.helpfulVotes} up / ${stats.downvoteVotes} down`}
      />
      <StatCard
        icon={<Gamepad2 className="h-4 w-4" />}
        label="Games covered"
        value={stats.gamesCovered}
        sub="Unique titles benchmarked"
      />
      <StatCard
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Credibility"
        value={stats.credibilityBadge}
        sub={`${stats.reputationScore} rep / ${stats.votesCast} votes cast`}
      />
    </div>
  );
}

export function TierBreakdown({ stats }: { stats: ProfileStats }) {
  const total = TIER_ORDER.reduce((s, t) => s + stats.tierCounts[t], 0);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tier data yet. Submit a report to see your performance breakdown.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {TIER_ORDER.map((tier) => {
          const count = stats.tierCounts[tier];
          if (count === 0) return null;
          return (
            <div
              key={tier}
              className={cn('h-full', TIER_BAR[tier])}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${tier}: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {TIER_ORDER.filter((t) => stats.tierCounts[t] > 0).map((tier) => (
          <div key={tier} className="flex items-center gap-1.5 text-xs">
            <span className={cn('h-2.5 w-2.5 rounded-full', TIER_DOT[tier])} />
            <span className="text-muted-foreground">{tier}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {stats.tierCounts[tier]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
