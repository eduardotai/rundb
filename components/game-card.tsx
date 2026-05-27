'use client';

import Link from 'next/link';
import { useState } from 'react';
import Image from 'next/image';
import { Game, GameStats } from '@/lib/types';
import { getReportsForGame, computeGameStats } from '@/lib/data';
import { PerformanceBadge } from './performance-badge';
import { cn, gameMediaLoader } from '@/lib/utils';

// Phase 3: GameCard now supports optional precomputed `stats` (from adapter + computeGameStatsFromReports in parent RQ data).
// When provided (e.g. home trending, games list after wiring): uses real data for badges/counts/FPS.
// When omitted: falls back to sync compute (via data adapter for flag compat + warnings).
// Enables full real-data UI without N+1 calls or breaking existing call sites.

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
}

export function GameCard({ game, className, stats: providedStats, priority = false, imageSizes }: GameCardProps) {
  // Phase 3: prefer provided real stats (from parent RQ + adapter reports), else fallback (compat).
  const stats = providedStats || computeGameStats(game.id);
  const reportCount = stats.totalReports;

  // Dominant tier for quick visual
  const dominantTier = (Object.entries(stats.tierDistribution) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0] as any;

  const avgFps1440 = stats.avgFpsByResolution['2560x1440'] || stats.avgFpsByResolution['1920x1080'];

  // Error state for real covers (IGDB/Steam/Supabase etc can transiently fail; graceful fallback, no layout shift)
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/games/${game.slug}`}
      className={cn(
        'group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-lg',
        className
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
        {!imgError ? (
          /* Phase 1/3 image strategy: Next Image + gameMediaLoader for real covers.
             Improved responsive sizes + priority control per surface. onError for robustness. */
          <Image
            loader={gameMediaLoader}
            src={game.coverImage}
            alt={game.name}
            fill
            className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
            sizes={imageSizes || "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 280px"}
            priority={priority}
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

        {/* Optional attribution polish (subtle, only when provided by real cover source; non-breaking) */}
        {game.coverAttribution && !imgError && (
          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-px text-[8px] leading-none text-white/70 backdrop-blur-sm pointer-events-none">
            {game.coverAttribution.length > 28 ? game.coverAttribution.slice(0, 25) + '…' : game.coverAttribution}
          </div>
        )}

        {dominantTier && (
          <div className="absolute bottom-3 left-3">
            <PerformanceBadge tier={dominantTier} size="sm" />
          </div>
        )}

        {/* Premium zero-report treatment (from Workstream D integration):
            Elegant "New" pill inside the existing cover gradient. No layout shift.
            Makes newly imported Steam games feel inviting instead of empty. */}
        {reportCount === 0 && (
          <div className="absolute bottom-3 right-3 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold tracking-[0.25px] text-white backdrop-blur-sm shadow-sm">
            New · Be the first to report
          </div>
        )}

        {reportCount > 0 && (
          <div className="absolute bottom-3 right-3 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            {reportCount} reports
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold leading-tight text-foreground group-hover:text-primary transition-colors">
              {game.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {game.releaseYear} • {game.developer}
            </p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {game.genres.slice(0, 3).map((genre) => (
            <span
              key={genre}
              className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
            >
              {genre}
            </span>
          ))}
        </div>

        {avgFps1440 && (
          <div className="mt-3 text-sm">
            <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {avgFps1440}
            </span>
            <span className="ml-1 text-muted-foreground">avg FPS @ 1440p</span>
          </div>
        )}

        {stats.mostCommonPreset && (
          <div className="mt-1 text-xs text-muted-foreground">
            Most common: <span className="font-medium text-foreground">{stats.mostCommonPreset}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
