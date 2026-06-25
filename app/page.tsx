'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/game-card';
import { ValueLoopExplainer } from '@/components/value-loop-explainer';
import { getTrendingGamesAsync, getReportsForGamesAsync, getGlobalCountsAsync, computeGameStatsFromReports } from '@/lib/data';
import { ArrowRight, BarChart3, Users, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import type { GameStats } from '@/lib/types';

// Home page. The "Trending right now" section ranks games by recent report
// activity via getTrendingGamesAsync (last 7 days, with all-time top-up). Per-card
// stats come from a batched getReportsForGamesAsync over just the visible games,
// and hero counts from the lightweight getGlobalCountsAsync. All data access goes
// through the lib/data adapters (React Query), which handle their own fallbacks.
export default function Home() {
  // Trending = games with the most new reports in the last 7 days (adapter handles
  // ranking + all-time top-up + fallbacks). Replaces the old all-games/all-reports derive.
  const trendingQuery = useQuery({
    queryKey: ['trending-games'],
    queryFn: () => getTrendingGamesAsync(6, 7),
  });

  const trending = useMemo(() => trendingQuery.data?.games ?? [], [trendingQuery.data]);
  const trendingIds = useMemo(() => trending.map((g) => g.id), [trending]);

  // Per-card stats for ONLY the visible trending games (batched single query).
  const statsQuery = useQuery({
    queryKey: ['trending-game-stats', trendingIds],
    queryFn: () => getReportsForGamesAsync(trendingIds),
    enabled: trendingIds.length > 0,
  });

  const gameStatsMap = useMemo(() => {
    const map: Record<string, GameStats> = {};
    const byGame = statsQuery.data;
    if (!byGame) return map;
    trending.forEach((g) => {
      const greports = byGame.get(g.id) ?? [];
      if (greports.length > 0) map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [statsQuery.data, trending]);

  // Lightweight global counts (head:true count queries — no row payloads).
  const countsQuery = useQuery({
    queryKey: ['global-counts'],
    queryFn: () => getGlobalCountsAsync(),
  });

  const totalReports = countsQuery.data?.totalReports ?? 0;
  const totalGames = countsQuery.data?.totalGames ?? 0;
  const avgReportsPerGame = totalGames > 0 ? Math.round(totalReports / totalGames) : 0;

  // Resilience for aggressive privacy tools / adblockers (the play.google.com/log + Supabase blocks some users see).
  // If queries are still pending after a short time (common when blockers tarpit or drop requests),
  // we still render with whatever we have + a clear notice instead of infinite skeletons.
  const [showLoadingNotice, setShowLoadingNotice] = useState(false);
  useMemo(() => {
    const t = setTimeout(() => {
      if (trendingQuery.isLoading && trending.length === 0) {
        setShowLoadingNotice(true);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, [trendingQuery.isLoading, trending.length]);

  return (
    <>
      {/* Hero — full viewport width so line arts can sit flush at screen edges on any resolution (1920x1080, 2560x1440, 3840x2160, etc).
         Content inside remains constrained to max-w-7xl. Decorations are xl+ only. */}
      <div className="relative pt-16 pb-12 md:pt-20 md:pb-16 overflow-hidden">
        {/* Left: spiral concentric circles — only right half visible (left side fully clipped/hidden).
           left-[-200px] + clip 52% places the visible edge exactly at viewport left=0. */}
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

        {/* Right: PC tower line art — 2 distinct colors, low but visible opacity.
           right-0 places the art's right edge flush against the viewport right edge. */}
        <div
          className="absolute right-0 top-1/2 -translate-y-[49%] pointer-events-none select-none hidden xl:block z-0"
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

        {/* Hero content (constrained) */}
        <div className="mx-auto max-w-7xl px-4">
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
      </div>

      {/* Page content below hero — constrained like the rest of the site */}
      <div className="mx-auto max-w-7xl px-4 pb-20">
        {/* Trending Games — ranked by recent report activity (getTrendingGamesAsync) */}
        <div className="mb-16">
          <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Trending right now</h2>
          <Link href="/games" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            Browse all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {trendingQuery.isLoading && trending.length === 0 ? (
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
          ) : (
            // trending is empty (no games to rank, even after the all-time top-up + starter fallback).
            <div className="col-span-full rounded-2xl border border-dashed border-border py-10 text-center text-muted-foreground">
              <p>No trending games yet — community reports rank titles here as they come in. Browse the catalog or submit a report to get things moving.</p>
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
        {(showLoadingNotice || trendingQuery.isLoading) && trending.length === 0 && (
          <div className="mt-3 text-center text-xs text-amber-400/90">
            Still loading live data… If you use a strict ad blocker or Brave Shields, some requests (including Google telemetry during auth) get blocked.
            The app works fine — try disabling the blocker for this site or check the Supabase connection.
          </div>
        )}

        {trendingQuery.isFetching && trending.length > 0 && (
          <div className="text-center text-sm text-muted-foreground mt-2">Refreshing trending…</div>
        )}
        {trendingQuery.isError && (
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
    </>
  );
}
