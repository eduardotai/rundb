'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/game-card';
import { CompatibilityChecker } from '@/components/compatibility-checker';
import { getAllGames, getAllReportsAsync, computeGameStatsFromReports } from '@/lib/data';
import { ArrowRight, BarChart3, Users, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import type { GameStats } from '@/lib/types';

// Phase 3: Home now uses real-data adapters (getAllGames + getAllReportsAsync) + React Query.
// When NEXT_PUBLIC_USE_REAL_DATA=true: trending + aggregates driven by Supabase data.
// Client-side derivation for trending (by report count) kept minimal (pure, after real fetch).
// No direct mock-data calls or computeGameStats in this page. Full backward compat (flag=false uses mocks instantly).
// Enhanced with graceful Skeleton loading states, error notices, and real stats passed to GameCards (via computeGameStatsFromReports).
// Uses root QueryClientProvider from app/providers.tsx (no per-page client creation).
export default function Home() {
  // Real adapter calls via RQ (replaces previous top-level sync mock imports + client computes).
  const gamesQuery = useQuery({
    queryKey: ['all-games'],
    queryFn: () => getAllGames(),
  });

  const reportsQuery = useQuery({
    queryKey: ['all-reports'],
    queryFn: () => getAllReportsAsync(),
  });

  const games = gamesQuery.data || [];
  const allReports = reportsQuery.data || [];

  // Derive trending using same logic as before, but from real adapter data (when flag true).
  // (Avoids needing a dedicated getTrendingGamesAsync while still using real sources for counts.)
  const trending = useMemo(() => {
    if (games.length === 0 || allReports.length === 0) return [];
    return [...games]
      .sort((a, b) => {
        const aReports = allReports.filter((r) => r.gameId === a.id).length;
        const bReports = allReports.filter((r) => r.gameId === b.id).length;
        return bReports - aReports;
      })
      .slice(0, 6);
  }, [games, allReports]);

  // Phase 3: Derive real stats (using pure helper + adapter-fetched reports) for trending GameCards.
  // Ensures badges, report counts, avg FPS in cards reflect real data (not mock) when flag=true.
  // Falls back gracefully (map empty -> cards use their internal fallback).
  const gameStatsMap = useMemo(() => {
    const map: Record<string, GameStats> = {};
    if (games.length === 0 || allReports.length === 0) return map;
    games.forEach((g) => {
      const greports = allReports.filter((r) => r.gameId === g.id);
      map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [games, allReports]);

  const totalReports = allReports.length;
  const totalGames = games.length;
  const avgReportsPerGame = totalGames > 0 ? Math.round(totalReports / totalGames) : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20">
      {/* Hero */}
      <div className="pt-16 pb-12 text-center md:pt-20 md:pb-16">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium tracking-[0.5px] text-muted-foreground mb-6">
            COMMUNITY HARDWARE DATABASE
          </div>

          <h1 className="text-5xl md:text-6xl font-semibold tracking-tighter text-balance leading-[1.05]">
            Can your PC run it?<br />What settings actually work?
          </h1>

          <p className="mt-4 text-xl text-muted-foreground max-w-2xl mx-auto">
            Real reports from real players with real hardware. The ProtonDB for actual PC performance.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto text-base px-8 bg-white text-black font-medium hover:bg-white/90 shadow-sm">
              <Link href="/games">Browse Games</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 border-white/40 text-white hover:bg-white/10 hover:text-white">
              <Link href="/compatibility">Check My PC</Link>
            </Button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> {totalReports.toLocaleString()} reports
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" /> {totalGames} games
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" /> {avgReportsPerGame} reports / game
            </div>
          </div>
        </div>
      </div>

      {/* Compatibility Checker — front and center */}
      <div className="mb-16">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Check your rig</h2>
            <p className="text-muted-foreground">See predicted performance across popular titles instantly.</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex hover:bg-accent hover:text-accent-foreground">
            <Link href="/compatibility">Full checker <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        <CompatibilityChecker embedded />
      </div>

      {/* Trending Games — now sourced from real adapters + RQ when flag true */}
      <div className="mb-16">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Trending right now</h2>
          <Link href="/games" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            Browse all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {(gamesQuery.isLoading || reportsQuery.isLoading) && trending.length === 0 ? (
            // Graceful loading skeletons for trending cards (Phase 3)
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
                <Skeleton className="aspect-[2/3] w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))
          ) : (
            trending.map((game, index) => (
              <GameCard
                key={game.id}
                game={game}
                stats={gameStatsMap[game.id]}
                // Rollout of full gameMediaLoader + Next Image pattern to home: priority on first trending cover (visible game image on landing)
                priority={index === 0}
                // Tailored sizes for 6-col trending grid on home for optimal real cover loading
                imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 16vw, 180px"
              />
            ))
          )}
        </div>
        {(gamesQuery.isLoading || reportsQuery.isLoading) && trending.length > 0 && (
          <div className="text-center text-sm text-muted-foreground mt-2">Refreshing trending…</div>
        )}
        {(gamesQuery.isError || reportsQuery.isError) && (
          <div className="text-center text-sm text-amber-500 mt-2">Some live data unavailable — showing available results.</div>
        )}
      </div>

      {/* Trust bar */}
      <div className="mt-12 rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Every report is submitted by real players. Filter by your exact GPU series, resolution, and FPS targets.
          Submit your own in under a minute.
        </p>
      </div>
    </div>
  );
}
