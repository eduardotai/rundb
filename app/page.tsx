'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/game-card';
import { ValueLoopExplainer } from '@/components/value-loop-explainer';
import { HeroRigGraphic } from '@/components/hero-rig-graphic';
import { CountUp } from '@/components/motion/count-up';
import { Reveal } from '@/components/motion/reveal';
import {
  getTrendingGamesAsync,
  getReportsForGamesAsync,
  getGlobalCountsAsync,
  computeGameStatsFromReports,
} from '@/lib/data';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import type { Game, GameStats } from '@/lib/types';
import { cn } from '@/lib/utils';

function HeroKpis({
  totalReports,
  totalGames,
  avgReportsPerGame,
  className,
}: {
  totalReports: number;
  totalGames: number;
  avgReportsPerGame: number;
  className?: string;
}) {
  const items = [
    { value: totalReports, label: 'reports' },
    { value: totalGames, label: 'games' },
    { value: avgReportsPerGame, label: 'reports / game' },
  ];

  return (
    <div className={cn('grid grid-cols-3 gap-3 sm:gap-4', className)}>
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            'motion-kpi animate-rise rounded-[var(--radius)] border border-border bg-card/80 px-2.5 py-3 text-center sm:px-3 sm:py-4',
            i === 0 && 'rise-delay-2',
            i === 1 && 'rise-delay-3',
            i === 2 && 'rise-delay-4'
          )}
        >
          <div className="theme-kpi-value text-lg sm:text-2xl md:text-[1.75rem]">
            <CountUp value={item.value} duration={1000} />
          </div>
          <div className="theme-kpi-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function TrendingGrid({
  trending,
  gameStatsMap,
  loading,
}: {
  trending: Game[];
  gameStatsMap: Record<string, GameStats>;
  loading: boolean;
}) {
  if (loading && trending.length === 0) {
    return (
      <div className="theme-home-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="theme-card overflow-hidden border border-border bg-card">
            <Skeleton className="aspect-[2/3] w-full" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (trending.length === 0) {
    return (
      <div className="theme-card col-span-full border border-dashed border-border py-10 text-center text-muted-foreground">
        <p>No trending games yet. Browse the catalog or submit a report.</p>
        <div className="mt-3 flex justify-center gap-3 text-sm">
          <Link href="/games" className="text-primary hover:underline">
            Browse games
          </Link>
          <Link href="/submit" className="font-medium text-primary hover:underline">
            Submit report
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="theme-home-grid motion-grid-stagger">
      {trending.map((game, index) => (
        <GameCard
          key={game.id}
          game={game}
          stats={gameStatsMap[game.id]}
          priority={index === 0}
          variant="compact"
          className="theme-card"
          imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 180px"
        />
      ))}
    </div>
  );
}

export default function Home() {
  const trendingQuery = useQuery({
    queryKey: ['trending-games'],
    queryFn: () => getTrendingGamesAsync(6, 7),
  });

  const trending = useMemo(() => trendingQuery.data?.games ?? [], [trendingQuery.data]);
  const trendingIds = useMemo(() => trending.map((g) => g.id), [trending]);

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

  const countsQuery = useQuery({
    queryKey: ['global-counts'],
    queryFn: () => getGlobalCountsAsync(),
  });

  const totalReports = countsQuery.data?.totalReports ?? 0;
  const totalGames = countsQuery.data?.totalGames ?? 0;
  const avgReportsPerGame = totalGames > 0 ? Math.round(totalReports / totalGames) : 0;
  const loading = trendingQuery.isLoading;

  return (
    <>
      <section className="theme-home-hero relative overflow-hidden">
        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
          {/* Left: copy + CTAs */}
          <div className="min-w-0">
            <div className="theme-badge-pill animate-rise mb-5 inline-flex px-3 py-1">
              Community hardware database
            </div>
            <h1 className="theme-home-title animate-rise rise-delay-1 text-balance">
              Can your PC run it?
              <br />
              <span className="text-muted-foreground">What settings actually work?</span>
            </h1>
            <p className="animate-rise rise-delay-2 mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
              Real FPS reports from real rigs. Match your hardware, skip the marketing numbers.
            </p>
            <div className="animate-rise rise-delay-3 mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/submit">Submit report</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/games">Browse games</Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                <Link href="/compatibility">Check my PC</Link>
              </Button>
            </div>

            <HeroKpis
              totalReports={totalReports}
              totalGames={totalGames}
              avgReportsPerGame={avgReportsPerGame}
              className="mt-8 lg:hidden"
            />
          </div>

          {/* Right: stats + rig graphic */}
          <div className="animate-rise rise-delay-2 relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative">
              <HeroRigGraphic className="animate-float opacity-90" />
              <div className="absolute inset-x-0 bottom-0 sm:bottom-2">
                <HeroKpis
                  totalReports={totalReports}
                  totalGames={totalGames}
                  avgReportsPerGame={avgReportsPerGame}
                  className="hidden lg:grid"
                />
              </div>
            </div>
            <HeroKpis
              totalReports={totalReports}
              totalGames={totalGames}
              avgReportsPerGame={avgReportsPerGame}
              className="mt-4 hidden md:grid lg:hidden"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pb-16">
        <Reveal className="mb-8" as="section">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="theme-section-title">Trending right now</h2>
            <Link
              href="/games"
              className="motion-link-arrow inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <TrendingGrid trending={trending} gameStatsMap={gameStatsMap} loading={loading} />
        </Reveal>

        <div className="mb-4">
          <h2 className="theme-section-title mb-3">How RunDB works</h2>
          <ValueLoopExplainer variant="prominent" />
        </div>
      </div>
    </>
  );
}
