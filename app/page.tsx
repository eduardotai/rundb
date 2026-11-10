'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/game-card';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { GlobalSearch } from '@/components/global-search';
import { PerformanceBadge } from '@/components/performance-badge';
import { TierDistributionBar } from '@/components/charts/tier-distribution-bar';
import { FpsResolutionBars } from '@/components/charts/fps-resolution-bars';
import { CountUp } from '@/components/motion/count-up';
import { Reveal } from '@/components/motion/reveal';
import {
  getTrendingGamesAsync,
  getReportsForGamesAsync,
  getGlobalCountsAsync,
  computeGameStatsFromReports,
  getDominantTier,
} from '@/lib/data';
import { hasRecentActivity, recentReportsBadge, trendingHeading } from '@/lib/trending';
import { ArrowRight, Cpu, Gauge, PlusCircle, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import type { Game, GameStats } from '@/lib/types';

/**
 * Real counts only: approved reports, games that have at least one, and the catalog size.
 * (A "reports per game" average rounds to 0 on a 10k-game catalog, so it is not shown.)
 */
function StatStrip({
  totalReports,
  gamesWithReports,
  totalGames,
  loading,
  error,
}: {
  totalReports: number;
  gamesWithReports: number;
  totalGames: number;
  loading: boolean;
  error: boolean;
}) {
  const items = [
    { value: totalReports, label: totalReports === 1 ? 'performance report' : 'performance reports' },
    { value: gamesWithReports, label: gamesWithReports === 1 ? 'game with reports' : 'games with reports' },
    { value: totalGames, label: 'games in the catalog' },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-card shadow-xs">
      {items.map((item) => (
        <div key={item.label} className="px-3 py-4 text-center sm:px-6 sm:py-5 sm:text-left">
          <dd className="theme-kpi-value">
            {loading ? (
              <Skeleton className="mx-auto h-7 w-12 sm:mx-0" />
            ) : error ? (
              <span aria-label="unavailable">—</span>
            ) : (
              <CountUp value={item.value} duration={900} />
            )}
          </dd>
          <dt className="theme-kpi-label">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Real data only: the #1 game of the trending list and its community numbers. */
function SnapshotCard({
  game,
  stats,
  loading,
  eyebrow,
}: {
  game?: Game;
  stats?: GameStats;
  loading: boolean;
  eyebrow: string;
}) {
  if (loading || !game) {
    return (
      <div className="surface p-5">
        <div className="flex gap-4">
          <Skeleton className="h-28 w-20 rounded-lg" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="mt-6 h-4 w-full rounded-full" />
        <Skeleton className="mt-5 h-16 w-full" />
      </div>
    );
  }
  const tier = getDominantTier(stats);
  return (
    <Link
      href={`/games/${game.slug}`}
      className="theme-card group block p-5 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-4">
        <GameCoverFrame
          src={game.coverImage}
          alt={game.name}
          steamAppId={game.steamAppId}
          className="h-28 w-[4.75rem] shrink-0 rounded-lg shadow-sm"
          sizes="80px"
          priority
          blurBackdrop={false}
        />
        <div className="min-w-0 flex-1">
          <div className="eyebrow flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden /> {eyebrow}
          </div>
          <div className="mt-1.5 text-xl font-semibold leading-tight tracking-tight">{game.name}</div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {[game.developer, game.releaseYear].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tier && <PerformanceBadge tier={tier} size="sm" />}
            {stats && (
              <span className="text-xs text-muted-foreground">
                {stats.totalReports} {stats.totalReports === 1 ? 'report' : 'reports'}
              </span>
            )}
          </div>
        </div>
      </div>
      {stats && stats.totalReports > 0 ? (
        <div className="mt-5 space-y-5">
          <TierDistributionBar distribution={stats.tierDistribution} total={stats.totalReports} />
          <div className="border-t border-border pt-4">
            <div className="eyebrow mb-2.5">Average FPS by resolution</div>
            <FpsResolutionBars avgFpsByResolution={stats.avgFpsByResolution} />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No reports yet — be the first to share yours.</p>
      )}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm font-medium">
        <span>See every report</span>
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
      </div>
    </Link>
  );
}

function TrendingGrid({
  trending,
  gameStatsMap,
  recentCounts,
  loading,
  error,
}: {
  trending: Game[];
  gameStatsMap: Record<string, GameStats>;
  recentCounts: Record<string, number>;
  loading: boolean;
  error: boolean;
}) {
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="font-medium">Couldn&apos;t load games right now</p>
        <p className="mt-1 text-sm text-muted-foreground">Please refresh in a moment, or browse the catalog.</p>
        <div className="mt-5 flex justify-center">
          <Button asChild variant="outline" size="sm">
            <Link href="/games">Browse games</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (loading && trending.length === 0) {
    return (
      <div className="theme-home-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="surface overflow-hidden">
            <Skeleton className="aspect-[2/3] w-full rounded-none" />
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
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="font-medium">No community reports yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Browse the catalog or be the first to submit a report.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/games">Browse games</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/submit">Submit report</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="theme-home-grid motion-grid-stagger">
      {trending.map((game, index) => {
        const badge = recentReportsBadge(recentCounts, game.id);
        return (
          <div key={game.id} className="relative">
            <GameCard
              game={game}
              stats={gameStatsMap[game.id]}
              priority={index === 0}
              variant="compact"
              imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
            />
            {badge && (
              <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-success px-2 py-0.5 text-[0.6875rem] font-semibold text-white shadow-sm">
                {badge}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const STEPS = [
  {
    icon: Cpu,
    title: 'Save your rig once',
    desc: 'Enter or auto-detect your CPU, GPU and RAM. It stays with your account.',
  },
  {
    icon: Gauge,
    title: 'Compare with real players',
    desc: 'See FPS, 1% lows and the settings that worked on hardware like yours.',
  },
  {
    icon: PlusCircle,
    title: 'Give back in a minute',
    desc: 'Share your own numbers so the next player can decide with confidence.',
  },
];

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
  const gamesWithReports = countsQuery.data?.gamesWithReports ?? 0;
  const recentCounts = useMemo(() => trendingQuery.data?.recentCounts ?? {}, [trendingQuery.data]);
  // Honest copy: "Trending this week" only when there were reports in the last 7 days.
  const heading = trendingHeading(recentCounts);
  const recent = hasRecentActivity(recentCounts);
  const loading = trendingQuery.isLoading;
  const featured = trending[0];

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="hero-backdrop pointer-events-none absolute inset-0" />
        <div className="theme-home-hero relative mx-auto grid max-w-7xl items-center gap-12 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
          <div className="min-w-0">
            <div className="theme-badge-pill animate-rise inline-flex items-center gap-2 px-3 py-1">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="motion-badge-dot absolute inline-flex h-full w-full rounded-full bg-success/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Community hardware database
            </div>
            <h1 className="theme-home-title animate-rise rise-delay-1 mt-6 text-balance">
              Can your PC run it?
              <span className="block text-muted-foreground">See what actually works.</span>
            </h1>
            <p className="animate-rise rise-delay-2 mt-5 max-w-xl text-pretty text-lg text-muted-foreground">
              Real FPS from real rigs. Find your game, match your hardware and skip the marketing numbers.
            </p>
            <div className="animate-rise rise-delay-3 mt-8 max-w-xl">
              <GlobalSearch variant="hero" />
              {trending.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Popular:</span>
                  {trending.slice(0, 4).map((g) => (
                    <Link
                      key={g.id}
                      href={`/games/${g.slug}`}
                      className="rounded-full border border-border bg-card px-3 py-1 text-[0.8125rem] font-medium shadow-xs transition-colors hover:border-foreground/20 hover:bg-muted"
                    >
                      {g.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="animate-rise rise-delay-4 mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/compatibility">
                  <Gauge className="h-4 w-4" aria-hidden />
                  Check my PC
                </Link>
              </Button>
              <Link
                href="/submit"
                className="motion-link-arrow inline-flex items-center gap-1.5 font-medium text-foreground hover:text-brand"
              >
                Share your FPS <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>

          <div className="animate-rise rise-delay-2 relative mx-auto w-full max-w-md lg:max-w-none">
            {!trendingQuery.isError && (
              <SnapshotCard
                game={featured}
                stats={featured ? gameStatsMap[featured.id] : undefined}
                loading={loading || statsQuery.isLoading}
                eyebrow={recent ? '#1 trending this week' : '#1 most reported'}
              />
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="-mt-px py-10">
          <StatStrip
            totalReports={totalReports}
            gamesWithReports={gamesWithReports}
            totalGames={totalGames}
            loading={countsQuery.isLoading}
            error={countsQuery.isError}
          />
        </div>

        <Reveal className="pb-16" as="section">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <h2 className="theme-section-title text-xl">{heading}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {recent
                  ? 'Games with the most new community reports in the last 7 days.'
                  : 'No new reports this week, so these are the games with the most community reports.'}
              </p>
            </div>
            <Link
              href="/games"
              className="motion-link-arrow inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <TrendingGrid
            trending={trending}
            gameStatsMap={gameStatsMap}
            recentCounts={recentCounts}
            loading={loading}
            error={trendingQuery.isError}
          />
        </Reveal>

        <section className="pb-16" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="theme-section-title text-xl">
            How RunDB works
          </h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="surface relative p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="pb-20">
          <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-12 dark:border dark:border-border dark:bg-card dark:text-foreground">
            <div className="relative z-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 text-sm opacity-80">
                  <Users className="h-4 w-4" aria-hidden /> Built by players, for players
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  Played something recently? Share your FPS.
                </h2>
                <p className="mt-2 opacity-80">It takes about a minute and helps everyone with a similar rig.</p>
              </div>
              <Button asChild size="lg" variant="secondary" className="rounded-full bg-primary-foreground text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90">
                <Link href="/submit">
                  Submit a report <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
