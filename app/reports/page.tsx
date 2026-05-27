'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllGames, getFilteredGlobalReportsAsync } from '@/lib/data';
import { Report, PerformanceTier, Game } from '@/lib/types';
import { PerformanceBadge } from '@/components/performance-badge';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { gameMediaLoader } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';

// Phase 3: Reports browser (global filterable list) now uses real adapters (getAllGames + getFilteredGlobalReportsAsync) + React Query.
// Filters drive queryKey + async fn (Supabase when flag=true, with RLS + fallback).
// No direct mock-data. Full backward compat (instant mocks when flag=false).
// Graceful loading skeletons + error notices. Uses root QueryClientProvider from app/providers.tsx (no per-page client creation).

const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];

// Sentinel values for "All/Any" options in Radix Select (cannot use empty string)
const ALL_GAMES_VALUE = '__all__';
const ANY_TIER_VALUE = '__any__';

export default function ReportsBrowser() {
  const [gameSlug, setGameSlug] = useState('');
  const [gpuSeries, setGpuSeries] = useState('');
  const [minFps, setMinFps] = useState(0);
  const [selectedTier, setSelectedTier] = useState<PerformanceTier | ''>('');
  // Per-game banner error states for real covers (robust graceful degradation)
  const [bannerErrors, setBannerErrors] = useState<Record<string, boolean>>({});

  // Real adapter + RQ (Phase 3). Query key includes filters so changing them refetches via adapter.
  const gamesQuery = useQuery({
    queryKey: ['all-games'],
    queryFn: () => getAllGames(),
  });

  const reportsQuery = useQuery({
    queryKey: ['filtered-global-reports', gameSlug, gpuSeries, minFps || 0, selectedTier || ''],
    queryFn: () =>
      getFilteredGlobalReportsAsync({
        gameSlug: gameSlug || undefined,
        gpuSeries: gpuSeries || undefined,
        minFps: minFps || undefined,
        tier: selectedTier || undefined,
      }),
  });

  const games = gamesQuery.data || [];
  const reports: Report[] = reportsQuery.data || [];

  const isLoading = gamesQuery.isLoading || reportsQuery.isLoading;

  // Visual grouped view: aggregate filtered reports per game so we can show beautiful banner rows
  // (much more readable than the old dense per-report table)
  const gameReportGroups = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const r of reports) {
      if (!map.has(r.gameId)) map.set(r.gameId, []);
      map.get(r.gameId)!.push(r);
    }
    return map;
  }, [reports]);

  const gameRows = useMemo(() => {
    const rows: Array<{
      game: Game;
      reportCount: number;
      avgFps: number;
      dominantTier: PerformanceTier;
    }> = [];

    for (const g of games) {
      const greps = gameReportGroups.get(g.id);
      if (!greps || greps.length === 0) continue;

      const count = greps.length;
      const sumFps = greps.reduce((sum, r) => sum + r.avgFps, 0);
      const avgFps = Math.round(sumFps / count);

      // dominant tier among the reports matching current filters
      const tierCounts: Record<string, number> = {};
      greps.forEach((r) => {
        tierCounts[r.performanceTier] = (tierCounts[r.performanceTier] || 0) + 1;
      });
      const dominantTier = (Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        'Playable') as PerformanceTier;

      rows.push({ game: g, reportCount: count, avgFps, dominantTier });
    }

    // sort by most relevant (highest matching report count)
    rows.sort((a, b) => b.reportCount - a.reportCount);
    return rows;
  }, [games, gameReportGroups]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">All Reports Browser</h1>
      <p className="text-muted-foreground">Advanced filtering across every game and hardware configuration.</p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Select
          value={gameSlug || ALL_GAMES_VALUE}
          onValueChange={(v) => setGameSlug(v === ALL_GAMES_VALUE ? '' : v)}
          disabled={isLoading}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="All games" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GAMES_VALUE}>All games</SelectItem>
            {games.map((g) => (
              <SelectItem key={g.id} value={g.slug}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          type="text"
          placeholder="GPU series (RTX 40, RX 6000...)"
          value={gpuSeries}
          onChange={(e) => setGpuSeries(e.target.value)}
          className="h-9 w-52 rounded-md border border-input bg-background px-3 text-sm"
          disabled={isLoading}
        />

        <input
          type="number"
          placeholder="Min FPS"
          value={minFps || ''}
          onChange={(e) => setMinFps(Number(e.target.value) || 0)}
          className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
          disabled={isLoading}
        />

        <Select
          value={selectedTier || ANY_TIER_VALUE}
          onValueChange={(v) => setSelectedTier((v === ANY_TIER_VALUE ? '' : v) as any)}
          disabled={isLoading}
        >
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="Any tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TIER_VALUE}>Any tier</SelectItem>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setGameSlug('');
            setGpuSeries('');
            setMinFps(0);
            setSelectedTier('');
          }}
          disabled={isLoading}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/60 hover:text-destructive gap-1.5"
        >
          <X className="h-3.5 w-3.5" />
          Reset filters
        </Button>
      </div>

      <div className="mt-4 text-sm text-muted-foreground">
        {isLoading
          ? 'Loading reports…'
          : `${reports.length} reports across ${gameRows.length} ${gameRows.length === 1 ? 'game' : 'games'}`}
      </div>

      {/* Visual game rows with banners — far more readable than the old dense table.
          Each row shows the actual game banner + key aggregates for the current filter set. */}
      <div className="mt-5">
        {isLoading && gameRows.length === 0 ? (
          // Loading skeletons that mimic the final banner rows
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex overflow-hidden rounded-2xl border border-border bg-card">
                <Skeleton className="w-40 aspect-[2/3] flex-shrink-0" />
                <div className="flex-1 p-4 space-y-3">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
                <div className="flex items-center gap-8 pr-6">
                  <Skeleton className="h-9 w-14" />
                  <Skeleton className="h-7 w-24 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : gameRows.length > 0 ? (
          <div className="space-y-3">
            {gameRows.map(({ game, reportCount, avgFps, dominantTier }) => (
              <Link
                key={game.id}
                href={`/games/${game.slug}`}
                className="group flex overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                {/* Game banner — the key visual the user requested, matching the style of the reference screenshot.
                   Real covers: error state + improved sizes (responsive aware) + optional attribution polish. */}
                <div className="relative w-40 flex-shrink-0 overflow-hidden bg-muted aspect-[2/3]">
                  {!bannerErrors[game.id] ? (
                    <Image
                      loader={gameMediaLoader}
                      src={game.coverImage}
                      alt={game.name}
                      fill
                      className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.035]"
                      sizes="(max-width: 640px) 160px, 160px"
                      onError={() => setBannerErrors((prev) => ({ ...prev, [game.id]: true }))}
                    />
                  ) : (
                    /* Consistent fallback for reports banner rows */
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/70">
                      <div className="text-center px-2">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60">COVER</div>
                        <div className="text-[11px] font-semibold text-foreground/85 mt-0.5 leading-tight line-clamp-2">{game.name}</div>
                      </div>
                    </div>
                  )}
                  {/* Subtle gradient for depth, like Steam library rows */}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/25 to-transparent" />
                  {/* Small floating report count pill on the banner */}
                  <div className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-px text-[10px] font-medium text-white backdrop-blur">
                    {reportCount} {reportCount === 1 ? 'report' : 'reports'}
                  </div>
                  {/* Optional attribution polish (tiny, non-breaking on banner) */}
                  {game.coverAttribution && !bannerErrors[game.id] && (
                    <div className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[7px] leading-none text-white/65 backdrop-blur pointer-events-none">
                      {game.coverAttribution.slice(0, 18)}
                    </div>
                  )}
                </div>

                {/* Main info */}
                <div className="flex flex-1 flex-col justify-center px-5 py-3 min-w-0">
                  <div className="font-semibold text-[21px] leading-none tracking-[-0.3px] text-foreground group-hover:text-primary transition-colors">
                    {game.name}
                  </div>
                  <div className="mt-1.5 text-sm text-muted-foreground">
                    {game.developer} • {game.releaseYear}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground/80">
                    Matching your filters
                  </div>
                </div>

                {/* Right side metrics + action (inspired by the reference: big numbers + status badge) */}
                <div className="flex items-center gap-7 pr-5 text-right">
                  <div>
                    <div className="font-mono text-4xl font-semibold tabular-nums tracking-tighter text-foreground">
                      {avgFps}
                    </div>
                    <div className="text-[10px] font-medium text-muted-foreground -mt-1">AVG FPS</div>
                  </div>

                  <div>
                    <PerformanceBadge tier={dominantTier} size="md" className="px-3.5 py-1 text-sm" />
                  </div>

                  <div className="pl-1 text-sm text-muted-foreground group-hover:text-foreground transition flex items-center gap-1.5">
                    View reports
                    <span className="inline-block transition group-hover:translate-x-0.5">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <div className="text-lg text-muted-foreground">No games match your current filters.</div>
            <p className="mt-1 text-sm text-muted-foreground/80">Try widening the filters or resetting them.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setGameSlug('');
                setGpuSeries('');
                setMinFps(0);
                setSelectedTier('');
              }}
            >
              Reset all filters
            </Button>
          </div>
        )}
      </div>

      {reports.length > 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {gameRows.length} {gameRows.length === 1 ? 'game' : 'games'} • {reports.length} total matching reports
        </p>
      )}

      {(gamesQuery.isError || reportsQuery.isError) && (
        <div className="mt-2 text-center text-sm text-amber-500">Some live data unavailable — results may be partial.</div>
      )}
    </div>
  );
}
