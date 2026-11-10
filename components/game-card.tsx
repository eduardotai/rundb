'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Game, GameStats, PerformanceTier } from '@/lib/types';
import { PerformanceBadge } from './performance-badge';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';
import { Gamepad2, Sparkles } from 'lucide-react';

const EMPTY_STATS: GameStats = {
  totalReports: 0,
  tierDistribution: { Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0 },
  avgFpsByResolution: {},
  mostCommonPreset: null,
  avgFpsOverall: 0,
};

const tierAccentClass: Record<PerformanceTier, string> = {
  Excellent: 'tier-accent-excellent',
  Good: 'tier-accent-good',
  Playable: 'tier-accent-playable',
  Struggling: 'tier-accent-struggling',
  Unplayable: 'tier-accent-unplayable',
};

interface GameCardProps {
  game: Game;
  className?: string;
  /** Optional precomputed stats from real adapter data (Phase 3). Falls back to empty if omitted. */
  stats?: GameStats;
  /**
   * Use priority for LCP/featured game cover (e.g. first trending on home page).
   * Default false for list/grid cards (Next default lazy + no preload).
   */
  priority?: boolean;
  /** Optional override for the Next.js Image sizes attribute (responsive breakpoints). */
  imageSizes?: string;
  /** Compact layout for dense browse grids — tighter body, no FPS block. */
  variant?: 'default' | 'compact';
}

export function GameCard({
  game,
  className,
  stats: providedStats,
  priority = false,
  imageSizes,
  variant = 'default',
}: GameCardProps) {
  const isCompact = variant === 'compact';
  const stats = providedStats || EMPTY_STATS;
  // Live tallied stats for tier; denormalized games.report_count only for the count badge.
  const liveReportCount = stats.totalReports;
  const reportCount = liveReportCount > 0 ? liveReportCount : (game.reportCount ?? 0);

  const dominantTier: PerformanceTier | null =
    liveReportCount > 0
      ? ((Object.entries(stats.tierDistribution) as [PerformanceTier, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
      : null;

  const avgFps1440 = stats.avgFpsByResolution['2560x1440'] || stats.avgFpsByResolution['1920x1080'];

  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/games/${game.slug}`}
      className={cn(
        'theme-card group flex flex-col overflow-hidden',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        dominantTier && 'tier-accent',
        dominantTier && tierAccentClass[dominantTier],
        className
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
        {!imgError ? (
          <GameCoverFrame
            src={game.coverImage}
            alt={game.name}
            steamAppId={game.steamAppId}
            className="h-full w-full"
            sizes={imageSizes || "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 360px"}
            quality={90}
            priority={priority}
            hoverZoom
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-4 text-center">
            <Gamepad2 className="h-6 w-6 text-muted-foreground/70" aria-hidden />
            <div className="line-clamp-3 text-sm font-semibold leading-tight text-foreground/80">
              {game.name}
            </div>
          </div>
        )}

        {reportCount === 0 && (
          <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur">
            <Sparkles className="h-3 w-3 text-brand" aria-hidden />
            Needs first report
          </div>
        )}
      </div>

      <div className={cn('flex flex-1 flex-col', isCompact ? 'p-3' : 'p-4')}>
        <h3
          className={cn(
            'font-semibold leading-snug tracking-tight text-foreground',
            isCompact ? 'line-clamp-1 text-sm' : 'text-base'
          )}
          title={game.name}
        >
          {game.name}
        </h3>
        <p className={cn('mt-0.5 truncate text-muted-foreground', isCompact ? 'text-xs' : 'text-sm')}>
          {[game.releaseYear, game.developer].filter(Boolean).join(' · ')}
        </p>

        {!isCompact && (
          <div className="mt-2 flex flex-wrap gap-1">
            {game.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {!isCompact && avgFps1440 ? (
          <div className="mt-3 text-sm">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{avgFps1440}</span>
            <span className="ml-1 text-muted-foreground">avg FPS @ 1440p</span>
          </div>
        ) : null}

        {!isCompact && stats.mostCommonPreset ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Most common: <span className="font-medium text-foreground">{stats.mostCommonPreset}</span>
          </div>
        ) : null}

        <div className={cn('mt-auto flex items-center justify-between gap-2', isCompact ? 'pt-2.5' : 'pt-3')}>
          {dominantTier ? (
            <PerformanceBadge tier={dominantTier} size="sm" className="shrink-0" />
          ) : (
            <span className="text-xs text-muted-foreground">No tier yet</span>
          )}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {reportCount} {reportCount === 1 ? 'report' : 'reports'}
          </span>
        </div>
      </div>
    </Link>
  );
}
