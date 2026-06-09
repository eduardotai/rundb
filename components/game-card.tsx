'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Game, GameStats, PerformanceTier } from '@/lib/types';
import { PerformanceBadge } from './performance-badge';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';
import { ShieldCheck, Sparkles } from 'lucide-react';

// Phase 3: GameCard now supports optional precomputed `stats` (from adapter + computeGameStatsFromReports in parent RQ data).
// When provided (e.g. home trending, games list after wiring): uses real data for badges/counts/FPS.
// When omitted: renders the empty-stats state (parents are expected to precompute via batched adapters).

const EMPTY_STATS: GameStats = {
  totalReports: 0,
  tierDistribution: { Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0 },
  avgFpsByResolution: {},
  mostCommonPreset: null,
  avgFpsOverall: 0,
};

interface GameCardProps {
  game: Game;
  className?: string;
  /** Optional precomputed stats from real adapter data (Phase 3). Falls back to sync if omitted. */
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
  // Phase 3: prefer provided real stats (from parent RQ + adapter reports), else empty-state.
  const stats = providedStats || EMPTY_STATS;
  const reportCount = stats.totalReports;

  // Dominant tier only when there are real reports (avoid "Excellent" on empty games)
  const dominantTier: PerformanceTier | null =
    reportCount > 0
      ? ((Object.entries(stats.tierDistribution) as [PerformanceTier, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
      : null;

  const avgFps1440 = stats.avgFpsByResolution['2560x1440'] || stats.avgFpsByResolution['1920x1080'];

  // Error state for real covers (IGDB/Steam/Supabase etc can transiently fail; graceful fallback, no layout shift)
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/games/${game.slug}`}
      className={cn(
        'group block overflow-hidden border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-lg',
        isCompact ? 'rounded-xl' : 'rounded-2xl',
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
          /* Beautiful consistent fallback for failed real cover loads (keeps visual weight identical) */
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-muted via-muted to-muted/60 text-center p-3">
            <div className="text-[10px] font-mono uppercase tracking-[2px] text-muted-foreground/70 mb-1">COVER</div>
            <div className="text-sm font-semibold text-foreground/90 leading-tight line-clamp-2">
              {game.name}
            </div>
          </div>
        )}

        {/* Subtle gradient always present for text legibility on real art or fallback */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />

        <div
          className={cn(
            'absolute left-2 top-2 z-20 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md',
            reportCount > 0
              ? 'border-cyan-300/25 bg-cyan-950/75'
              : 'border-amber-300/30 bg-amber-950/75'
          )}
        >
          {reportCount > 0 ? (
            <ShieldCheck className="h-3 w-3 shrink-0 text-cyan-200" />
          ) : (
            <Sparkles className="h-3 w-3 shrink-0 text-amber-200" />
          )}
          <span className="truncate">{reportCount > 0 ? (isCompact ? 'Tested' : 'Community tested') : 'Needs reports'}</span>
        </div>

        {/* Optional attribution polish (subtle, only when provided by real cover source; non-breaking) */}
        {game.coverAttribution && !imgError && (
          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-px text-[8px] leading-none text-white/70 backdrop-blur-sm pointer-events-none">
            {game.coverAttribution.length > 28 ? game.coverAttribution.slice(0, 25) + '…' : game.coverAttribution}
          </div>
        )}

        {/* Cover footer: tier badge + report CTA in one legible bar */}
        {reportCount === 0 ? (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent',
              isCompact ? 'px-2 pb-2 pt-8' : 'px-3 pb-3 pt-10'
            )}
          >
            <div
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-400/35 bg-emerald-500 font-semibold text-white shadow-lg transition-colors group-hover:border-emerald-300/50 group-hover:bg-emerald-400',
                isCompact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
              )}
            >
              <Sparkles className={cn('shrink-0', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
              <span className="text-center leading-tight">
                <span className="font-bold">New</span>
                <span className="font-medium opacity-90"> · Be the first to report</span>
              </span>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent',
              isCompact ? 'px-2 pb-2 pt-7' : 'px-3 pb-3 pt-10'
            )}
          >
            {dominantTier && (
              <PerformanceBadge
                tier={dominantTier}
                size={isCompact ? 'md' : 'lg'}
                className="shrink-0 shadow-md ring-1 ring-white/15"
              />
            )}

            <div
              className={cn(
                'ml-auto shrink-0 rounded-lg border border-white/10 bg-black/75 font-semibold text-white shadow-md backdrop-blur-sm',
                isCompact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              )}
            >
              {reportCount} {reportCount === 1 ? 'report' : 'reports'}
            </div>
          </div>
        )}
      </div>

      <div className={isCompact ? 'p-2.5' : 'p-4'}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              className={cn(
                'font-semibold leading-tight text-foreground transition-colors group-hover:text-primary',
                isCompact ? 'text-sm line-clamp-2' : 'text-base'
              )}
            >
              {game.name}
            </h3>
            <p className={cn('mt-0.5 text-muted-foreground truncate', isCompact ? 'text-[11px]' : 'text-xs')}>
              {game.releaseYear} • {game.developer}
            </p>
          </div>
        </div>

        <div className={cn('flex flex-wrap gap-1', isCompact ? 'mt-1.5' : 'mt-2')}>
          {game.genres.slice(0, isCompact ? 2 : 3).map((genre) => (
            <span
              key={genre}
              className={cn(
                'rounded bg-muted font-medium text-muted-foreground',
                isCompact ? 'px-1.5 py-px text-[10px]' : 'px-1.5 py-px text-[10px]'
              )}
            >
              {genre}
            </span>
          ))}
        </div>

        {!isCompact && avgFps1440 && (
          <div className="mt-3 text-sm">
            <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {avgFps1440}
            </span>
            <span className="ml-1 text-muted-foreground">avg FPS @ 1440p</span>
          </div>
        )}

        {!isCompact && stats.mostCommonPreset && (
          <div className="mt-1 text-xs text-muted-foreground">
            Most common: <span className="font-medium text-foreground">{stats.mostCommonPreset}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
