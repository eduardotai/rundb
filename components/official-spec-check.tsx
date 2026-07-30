'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type {
  ComponentCheck,
  OfficialSpecCheckResult,
  OfficialSpecVerdict,
  SpecTierCheck,
  UserPC,
} from '@/lib/types';
import { checkOfficialSpecsForRig } from '@/lib/data';
import type { Game } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, CircleHelp, Minus, X } from 'lucide-react';
import { useMemo } from 'react';

const VERDICT_COPY: Record<
  OfficialSpecVerdict,
  { title: string; className: string }
> = {
  exceeds_recommended: {
    title: 'Above recommended',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  },
  meets_recommended: {
    title: 'Meets recommended',
    className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
  },
  between_min_and_rec: {
    title: 'Between min & recommended',
    className: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
  },
  meets_minimum: {
    title: 'Meets minimum',
    className: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  },
  below_minimum: {
    title: 'Below minimum',
    className: 'border-destructive/40 bg-destructive/10 text-red-200',
  },
  unknown: {
    title: 'Can’t evaluate yet',
    className: 'border-border bg-muted/40 text-muted-foreground',
  },
};

const CHECK_LABEL: Record<ComponentCheck, string> = {
  pass: 'Pass',
  borderline: 'Borderline',
  fail: 'Fail',
  unknown: 'Unknown',
};

function CheckIcon({ status }: { status: ComponentCheck }) {
  if (status === 'pass') return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (status === 'borderline') return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
  if (status === 'fail') return <X className="h-3.5 w-3.5" aria-hidden />;
  return <CircleHelp className="h-3.5 w-3.5" aria-hidden />;
}

function statusClass(status: ComponentCheck): string {
  if (status === 'pass') return 'text-emerald-400';
  if (status === 'borderline') return 'text-amber-400';
  if (status === 'fail') return 'text-red-400';
  return 'text-muted-foreground';
}

function ComponentRow({
  label,
  min,
  rec,
}: {
  label: string;
  min?: ComponentCheck;
  rec?: ComponentCheck;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('flex items-center gap-1.5', min ? statusClass(min) : 'text-muted-foreground/50')}>
        {min ? (
          <>
            <CheckIcon status={min} />
            <span>{CHECK_LABEL[min]}</span>
          </>
        ) : (
          <>
            <Minus className="h-3.5 w-3.5" aria-hidden />
            <span>—</span>
          </>
        )}
      </div>
      <div className={cn('flex items-center gap-1.5', rec ? statusClass(rec) : 'text-muted-foreground/50')}>
        {rec ? (
          <>
            <CheckIcon status={rec} />
            <span>{CHECK_LABEL[rec]}</span>
          </>
        ) : (
          <>
            <Minus className="h-3.5 w-3.5" aria-hidden />
            <span>—</span>
          </>
        )}
      </div>
    </div>
  );
}

function TierTable({ min, rec }: { min?: SpecTierCheck; rec?: SpecTierCheck }) {
  if (!min && !rec) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border/80 bg-background/40 p-3">
      <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground">
        <div />
        <div className="text-amber-400">Minimum</div>
        <div className="text-emerald-400">Recommended</div>
      </div>
      <ComponentRow label="CPU" min={min?.cpu} rec={rec?.cpu} />
      <ComponentRow label="GPU" min={min?.gpu} rec={rec?.gpu} />
      <ComponentRow label="RAM" min={min?.ram} rec={rec?.ram} />
    </div>
  );
}

export interface OfficialSpecCheckProps {
  game: Pick<Game, 'officialMinReqs' | 'officialRecReqs' | 'name'>;
  myRig: UserPC | null;
  hasCommunityReports: boolean;
  compact?: boolean;
  onSubmitReport?: () => void;
  className?: string;
}

/**
 * Quick check: compare saved rig to publisher min/recommended specs.
 * Never invents FPS; never uses PerformanceTier badges.
 */
export function OfficialSpecCheck({
  game,
  myRig,
  hasCommunityReports,
  compact = false,
  onSubmitReport,
  className,
}: OfficialSpecCheckProps) {
  const hasReqs = Boolean(game.officialMinReqs || game.officialRecReqs);

  const result: OfficialSpecCheckResult | null = useMemo(() => {
    if (!myRig || !hasReqs) return null;
    return checkOfficialSpecsForRig(myRig, game);
  }, [myRig, game, hasReqs]);

  // No official requirements on file
  if (!hasReqs) {
    if (hasCommunityReports) return null;
    return (
      <div className={cn('rounded-2xl border border-border bg-card p-4 text-sm', className)}>
        <div className="text-sm font-medium text-muted-foreground mb-1">QUICK CHECK</div>
        <p className="text-muted-foreground">
          No official min/recommended specs on file for this game yet.
          {!hasCommunityReports && ' Be the first to submit a community report.'}
        </p>
        {onSubmitReport && !hasCommunityReports && (
          <Button size="sm" className="mt-3" onClick={onSubmitReport}>
            Submit a report
          </Button>
        )}
      </div>
    );
  }

  // No saved rig
  if (!myRig) {
    return (
      <div className={cn('rounded-2xl border border-border bg-card p-4 text-sm', className)}>
        <div className="text-sm font-medium text-muted-foreground mb-1">QUICK CHECK</div>
        <p className="text-foreground/90 mb-2">
          Save your rig to compare it against this game’s official minimum and recommended specs.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/compatibility">Set up my rig</Link>
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const copy = VERDICT_COPY[result.verdict];
  const isPrimary = !hasCommunityReports;

  if (compact && hasCommunityReports) {
    return (
      <div className={cn('rounded-xl border border-border/80 bg-card/60 px-3 py-2 text-xs', className)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Official specs:</span>
          <Badge variant="outline" className={cn('font-medium', copy.className)}>
            {copy.title}
          </Badge>
          <span className="text-muted-foreground/80">publisher list · not community FPS</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-5 space-y-3',
        isPrimary ? 'border-primary/25' : 'border-border',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-1">
            {isPrimary ? 'QUICK CHECK — OFFICIAL SPECS' : 'OFFICIAL SPECS (SECONDARY)'}
          </div>
          <Badge variant="outline" className={cn('text-sm font-semibold', copy.className)}>
            {copy.title}
          </Badge>
        </div>
        {result.confidence > 0 && (
          <div className="text-[11px] text-muted-foreground tabular-nums">
            Parse confidence {Math.round(result.confidence * 100)}%
          </div>
        )}
      </div>

      <p className="text-sm text-foreground/90">{result.explanation}</p>

      <TierTable min={result.min} rec={result.rec} />

      <ul className="space-y-1 text-[11px] leading-snug text-muted-foreground">
        {result.limitations.slice(0, 3).map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>

      {isPrimary && onSubmitReport && (
        <div className="pt-1">
          <Button size="sm" onClick={onSubmitReport}>
            Submit a real report
          </Button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Community FPS reports beat publisher lists once they exist.
          </p>
        </div>
      )}
    </div>
  );
}
