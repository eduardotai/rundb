'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Game, GameStats, PerformanceTier } from '@/lib/types';
import { PerformanceBadge } from './performance-badge';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

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
        'theme-card group block overflow-hidden border border-border bg-card',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        dominantTier && 'tier-accent',
        dominantTier && tierAccentClass[dominantTier],
        className
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden">
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-muted via-muted to-muted/60 p-3 text-center">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground/70">
              COVER
            </div>
            <div className="line-clamp-2 text-sm font-semibold leading-tight text-foreground/90">
              {game.name}
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 to-transparent" />

        {reportCount === 0 ? (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent',
              isCompact ? 'px-2 pb-2 pt-8' : 'px-3 pb-3 pt-10'
            )}
          >
            <div
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/10 font-semibold text-foreground',
                isCompact ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
              )}
            >
              <Sparkles className={cn('shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
              <span className="text-center leading-tight">
                <span className="font-bold">New</span>
                <span className="font-medium opacity-90"> · First report</span>
              </span>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/95 via-black/65 to-transparent',
              isCompact ? 'px-2 pb-2 pt-7' : 'px-3 pb-3 pt-10'
            )}
          >
            {dominantTier && (
              <PerformanceBadge
                tier={dominantTier}
                size={isCompact ? 'sm' : 'md'}
                className="shrink-0 shadow-sm"
              />
            )}
            <div
              className={cn(
                'ml-auto shrink-0 rounded-md border border-white/10 bg-black/70 font-semibold tabular-nums text-white',
                isCompact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
              )}
            >
              {reportCount} {reportCount === 1 ? 'report' : 'reports'}
            </div>
          </div>
        )}
      </div>

      <div className={isCompact ? 'p-2.5' : 'p-3.5'}>
        <h3
          className={cn(
            'font-semibold leading-tight text-foreground transition-colors group-hover:text-primary',
            isCompact ? 'line-clamp-2 text-sm' : 'text-base'
          )}
        >
          {game.name}
        </h3>
        <p className={cn('mt-0.5 truncate text-muted-foreground', isCompact ? 'text-[11px]' : 'text-xs')}>
          {game.releaseYear ? `${game.releaseYear} · ` : ''}{game.developer}
        </p>

        <div className={cn('flex flex-wrap gap-1', isCompact ? 'mt-1.5' : 'mt-2')}>
          {game.genres.slice(0, isCompact ? 2 : 3).map((genre) => (
            <span
              key={genre}
              className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
            >
              {genre}
            </span>
          ))}
        </div>

        {!isCompact && avgFps1440 ? (
          <div className="mt-2.5 text-sm">
            <span className="font-mono text-lg font-semibold tabular-nums text-[var(--highlight)]">
              {avgFps1440}
            </span>
            <span className="ml-1 text-muted-foreground">avg FPS @ 1440p</span>
          </div>
        ) : null}

        {!isCompact && stats.mostCommonPreset ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Most common: <span className="font-medium text-foreground">{stats.mostCommonPreset}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
