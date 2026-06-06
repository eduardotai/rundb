'use client';

import type { PerformanceTier } from '@/lib/types';
import { tierSegments } from '@/lib/chart-helpers';
import { cn } from '@/lib/utils';

interface TierDistributionBarProps {
  distribution: Record<PerformanceTier, number>;
  total: number;
  predictedTier?: PerformanceTier | null;
  confidence?: number; // 0-1
}

// Reuse the same palette as PerformanceBadge via the CSS variables in globals.css.
const tierVar: Record<PerformanceTier, string> = {
  Excellent: 'var(--tier-excellent)',
  Good: 'var(--tier-good)',
  Playable: 'var(--tier-playable)',
  Struggling: 'var(--tier-struggling)',
  Unplayable: 'var(--tier-unplayable)',
};

export function TierDistributionBar({
  distribution,
  total,
  predictedTier,
  confidence,
}: TierDistributionBarProps) {
  if (total <= 0) {
    return (
      <div className="rounded-full border border-dashed border-border bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
        No reports yet
      </div>
    );
  }

  const segments = tierSegments(distribution, total);
  const summary = segments
    .filter((s) => s.count > 0)
    .map((s) => `${s.pct}% ${s.tier}`)
    .join(', ');

  const lowConfidence = typeof confidence === 'number' && confidence < 0.34;
  const confidenceLabel =
    typeof confidence === 'number' && !lowConfidence
      ? `~${Math.round(confidence * 100)}% confidence`
      : 'estimate';

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`Tier distribution: ${summary}`}
        className="flex h-4 w-full overflow-hidden rounded-full border border-border bg-muted"
      >
        {segments
          .filter((s) => s.rawPct > 0)
          .map((s) => (
            <div
              key={s.tier}
              className="h-full"
              style={{ width: `${s.rawPct}%`, backgroundColor: tierVar[s.tier] }}
              title={`${s.tier}: ${s.pct}%`}
            />
          ))}
      </div>

      {predictedTier && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-xs',
            lowConfidence ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span
            className="inline-block h-2 w-2 rotate-45 rounded-[1px]"
            style={{ backgroundColor: tierVar[predictedTier] }}
            aria-hidden
          />
          <span>
            Your rig: <span className="font-medium">{predictedTier}</span>{' '}
            <span className="text-muted-foreground">({confidenceLabel})</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {segments.map((seg) => (
          <div
            key={seg.tier}
            className={cn(
              'flex items-center justify-between gap-2 text-xs',
              seg.count === 0 && 'opacity-40',
            )}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: tierVar[seg.tier] }}
                aria-hidden
              />
              <span className="text-muted-foreground">{seg.tier}</span>
            </span>
            <span className="font-mono tabular-nums text-foreground">{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
