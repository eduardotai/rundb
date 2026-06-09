'use client';

import { PerformanceTier } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PerformanceBadgeProps {
  tier: PerformanceTier;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const tierConfig: Record<PerformanceTier, { label: string; className: string }> = {
  Excellent: {
    label: 'Excellent',
    className: 'badge-excellent',
  },
  Good: {
    label: 'Good',
    className: 'badge-good',
  },
  Playable: {
    label: 'Playable',
    className: 'badge-playable',
  },
  Struggling: {
    label: 'Struggling',
    className: 'badge-struggling',
  },
  Unplayable: {
    label: 'Unplayable',
    className: 'badge-unplayable',
  },
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs font-semibold',
  lg: 'px-3 py-1.5 text-sm font-semibold',
};

export function PerformanceBadge({ tier, size = 'md', className }: PerformanceBadgeProps) {
  const config = tierConfig[tier];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium tracking-tight tabular-nums',
        config.className,
        sizeClasses[size],
        className
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {config.label}
    </span>
  );
}
