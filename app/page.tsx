'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/game-card';
import { CompatibilityChecker } from '@/components/compatibility-checker';
import { ValueLoopExplainer } from '@/components/value-loop-explainer';
import { getAllGames, getAllReportsAsync, computeGameStatsFromReports, USE_REAL } from '@/lib/data';
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

  // Resilience for aggressive privacy tools / adblockers (the play.google.com/log + Supabase blocks some users see).
  // If queries are still pending after a short time (common when blockers tarpit or drop requests),
  // we still render with whatever we have + a clear notice instead of infinite skeletons.
  const [showLoadingNotice, setShowLoadingNotice] = useState(false);
  useMemo(() => {
    const t = setTimeout(() => {
      if ((gamesQuery.isLoading || reportsQuery.isLoading) && trending.length === 0) {
        setShowLoadingNotice(true);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, [gamesQuery.isLoading, reportsQuery.isLoading, trending.length]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20">
      {/* Hero */}
      <div className="relative pt-16 pb-12 md:pt-20 md:pb-16 overflow-hidden">
        {/* Left: spiral concentric circles — only right half visible (left side fully clipped/hidden).
           Positioned so the visible portion is flush against the far left edge (no left margin/gap). */}
        <div
          className="absolute left-[-200px] top-1/2 -translate-y-[47%] pointer-events-none select-none hidden xl:block z-0"
          style={{ clipPath: 'inset(0 0 0 52%)' }}
          aria-hidden="true"
        >
          <svg width="385" height="385" viewBox="0 0 385 385" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Spiral-offset concentric rings — each with distinct opacity to create shade/vortex effect */}
            <circle cx="142" cy="190" r="34" stroke="#67e8f9" strokeWidth="2.5" strokeOpacity="0.29" />
            <circle cx="145" cy="192" r="50" stroke="#67e8f9" strokeWidth="2.3" strokeOpacity="0.27" />
            <circle cx="149" cy="194" r="66" stroke="#67e8f9" strokeWidth="2.15" strokeOpacity="0.25" />
            <circle cx="152" cy="196" r="82" stroke="#67e8f9" strokeWidth="2.05" strokeOpacity="0.225" />
            <circle cx="156" cy="198" r="98" stroke="#67e8f9" strokeWidth="1.95" strokeOpacity="0.20" />
            <circle cx="160" cy="200" r="114" stroke="#67e8f9" strokeWidth="1.85" strokeOpacity="0.175" />
            <circle cx="164" cy="202" r="130" stroke="#67e8f9" strokeWidth="1.75" strokeOpacity="0.145" />
            <circle cx="169" cy="204" r="146" stroke="#67e8f9" strokeWidth="1.7" strokeOpacity="0.115" />
            <circle cx="174" cy="206" r="162" stroke="#67e8f9" strokeWidth="1.6" strokeOpacity="0.09" />
            <circle cx="180" cy="208" r="178" stroke="#67e8f9" strokeWidth="1.5" strokeOpacity="0.07" />
            <circle cx="186" cy="210" r="194" stroke="#67e8f9" strokeWidth="1.45" strokeOpacity="0.05" />
            {/* Extra outer rings for softer falloff */}
            <circle cx="193" cy="213" r="210" stroke="#67e8f9" strokeWidth="1.35" strokeOpacity="0.035" />
          </svg>
        </div>

        {/* Right: PC tower line art — 2 distinct colors, low but visible opacity */}
        <div
          className="absolute -right-8 top-1/2 -translate-y-[49%] pointer-events-none select-none hidden xl:block z-0"
          style={{ opacity: 0.26 }}
          aria-hidden="true"
        >
          <svg width="208" height="410" viewBox="0 0 208 410" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Main tower body */}
            <rect x="23" y="20" width="158" height="358" rx="10" stroke="#67e8f9" strokeWidth="2.4" />
            {/* Inner side panel / window line */}
            <rect x="34" y="34" width="105" height="292" rx="6" stroke="#67e8f9" strokeWidth="1.35" strokeOpacity="0.7" />
            {/* RGB accent strip (2nd distinct color) */}
            <line x1="30" y1="38" x2="30" y2="358" stroke="#c084fc" strokeWidth="4" strokeOpacity="0.95" />
            {/* Top I/O bezel */}
            <rect x="40" y="30" width="78" height="16" rx="2" stroke="#67e8f9" strokeWidth="1.2" />
            {/* USB / audio ports */}
            <line x1="48" y1="37" x2="55" y2="37" stroke="#67e8f9" strokeWidth="1.3" />
            <line x1="60" y1="37" x2="67" y2="37" stroke="#67e8f9" strokeWidth="1.3" />
            <line x1="72" y1="37" x2="79" y2="37" stroke="#67e8f9" strokeWidth="1.3" />
            {/* Top vents */}
            <line x1="128" y1="39" x2="168" y2="39" stroke="#67e8f9" strokeWidth="1.1" />
            <line x1="128" y1="43" x2="168" y2="43" stroke="#67e8f9" strokeWidth="1.1" />
            {/* Fan 1 (top) */}
            <g>
              <circle cx="100" cy="95" r="26" stroke="#67e8f9" strokeWidth="1.7" />
              <circle cx="100" cy="95" r="18.5" stroke="#67e8f9" strokeWidth="1.35" />
              <circle cx="100" cy="95" r="6" stroke="#c084fc" strokeWidth="1.9" />
              <line x1="100" y1="95" x2="100" y2="74" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="95" x2="100" y2="116" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="95" x2="81" y2="95" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="95" x2="119" y2="95" stroke="#c084fc" strokeWidth="1.15" />
            </g>
            {/* Fan 2 (middle) */}
            <g>
              <circle cx="100" cy="180" r="26" stroke="#67e8f9" strokeWidth="1.7" />
              <circle cx="100" cy="180" r="18.5" stroke="#67e8f9" strokeWidth="1.35" />
              <circle cx="100" cy="180" r="6" stroke="#c084fc" strokeWidth="1.9" />
              <line x1="100" y1="180" x2="100" y2="159" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="180" x2="100" y2="201" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="180" x2="81" y2="180" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="180" x2="119" y2="180" stroke="#c084fc" strokeWidth="1.15" />
            </g>
            {/* Fan 3 (bottom) */}
            <g>
              <circle cx="100" cy="265" r="26" stroke="#67e8f9" strokeWidth="1.7" />
              <circle cx="100" cy="265" r="18.5" stroke="#67e8f9" strokeWidth="1.35" />
              <circle cx="100" cy="265" r="6" stroke="#c084fc" strokeWidth="1.9" />
              <line x1="100" y1="265" x2="100" y2="244" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="265" x2="100" y2="286" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="265" x2="81" y2="265" stroke="#c084fc" strokeWidth="1.15" />
              <line x1="100" y1="265" x2="119" y2="265" stroke="#c084fc" strokeWidth="1.15" />
            </g>
            {/* Lower PSU shroud */}
            <rect x="40" y="308" width="123" height="52" rx="5" stroke="#67e8f9" strokeWidth="1.4" />
            {/* PSU vent lines */}
            <line x1="46" y1="321" x2="156" y2="321" stroke="#67e8f9" strokeWidth="0.95" />
            <line x1="46" y1="327" x2="156" y2="327" stroke="#67e8f9" strokeWidth="0.95" />
            <line x1="46" y1="333" x2="156" y2="333" stroke="#67e8f9" strokeWidth="0.95" />
            <line x1="46" y1="339" x2="156" y2="339" stroke="#67e8f9" strokeWidth="0.95" />
            {/* Power button / LED (accent color) */}
            <circle cx="157" cy="58" r="5.5" stroke="#c084fc" strokeWidth="1.9" />
            <circle cx="157" cy="58" r="2.8" fill="#c084fc" fillOpacity="0.65" />
            {/* Case feet */}
            <rect x="44" y="382" width="20" height="7" rx="1.5" stroke="#67e8f9" strokeWidth="1.1" />
            <rect x="140" y="382" width="20" height="7" rx="1.5" stroke="#67e8f9" strokeWidth="1.1" />
          </svg>
        </div>

        {/* Hero content */}
        <div className="mx-auto max-w-3xl relative z-10 text-center">
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
          ) : trending.length > 0 ? (
            trending.map((game, index) => (
              <GameCard
                key={game.id}
                game={game}
                stats={gameStatsMap[game.id]}
                priority={index === 0}
                imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 16vw, 180px"
              />
            ))
          ) : games.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-border py-10 text-center">
              <p className="text-muted-foreground">No games in the database yet — the database grows through community reports and the ingest pipeline.</p>
              {USE_REAL && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Run{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run seed:games</code> to populate
                  Supabase, then restart the dev server.
                </p>
              )}
            </div>
          ) : (
            <div className="col-span-full rounded-2xl border border-dashed border-border py-10 text-center text-muted-foreground">
              <p>Community reports will rank titles here. Save a rig, browse games, or submit a few reports to see activity.</p>
              <Link
                href="/games"
                className="mt-2 inline-block text-sm text-primary hover:underline"
              >
                Browse all games
              </Link>
            </div>
          )}
        </div>

        {/* Privacy tools / adblocker resilience notice — directly addresses the play.google.com/log ERR_BLOCKED_BY_CLIENT + stuck loading some users hit */}
        {(showLoadingNotice || (gamesQuery.isLoading || reportsQuery.isLoading)) && trending.length === 0 && (
          <div className="mt-3 text-center text-xs text-amber-400/90">
            Still loading live data… If you use a strict ad blocker or Brave Shields, some requests (including Google telemetry during auth) get blocked.
            The app works fine — try disabling the blocker for this site or use the mock data path.
          </div>
        )}

        {(gamesQuery.isLoading || reportsQuery.isLoading) && trending.length > 0 && (
          <div className="text-center text-sm text-muted-foreground mt-2">Refreshing trending…</div>
        )}
        {(gamesQuery.isError || reportsQuery.isError) && (
          <div className="text-center text-sm text-amber-500 mt-2">Some live data unavailable — showing available results.</div>
        )}
      </div>

      {/* How RunDB works — educational value loop (replaces previous trust bar) */}
      <div className="mb-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">How RunDB works</h2>
        </div>
        <ValueLoopExplainer variant="prominent" />
      </div>
    </div>
  );
}
