'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PerformanceBadge } from '@/components/performance-badge';
import { ReportCard } from '@/components/report-card';
import { SubmitReportDialog } from '@/components/submit-report-dialog';
import { CompatibilityChecker } from '@/components/compatibility-checker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Sparkles, X } from 'lucide-react';
import {
  loadMyRigAsync,
  voteReport,
  getReportsForGameAsync,
  computeGameStatsAsync,
  useGame,
} from '@/lib/data';
import { Report, ReportFilters, PerformanceTier, Game, UserPC } from '@/lib/types';
import { cn, gameMediaLoader } from '@/lib/utils';
import { upgradeCoverImageSrc } from '@/lib/cover-image-url';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  // Agent 2 fix: use RQ + useGame (which calls getGameBySlugAsync + full enrichment via resolver/game_media).
  // Replaces dangerous top-level sync getGameBySlug (which ignored real data + always picsum fallback).
  // Shows loading skeleton for LCP hero area; not-found only after resolution.
  const { game, isLoading, error } = useGame(slug);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="h-[320px] w-full rounded-2xl bg-muted animate-pulse mb-8" />
        <div className="space-y-4">
          <div className="h-8 w-2/3 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!game || error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">Game not found</h1>
        <p className="mt-2 text-muted-foreground">The game you’re looking for doesn’t exist in our database yet.</p>
        <Button asChild className="mt-6">
          <Link href="/games">Back to Browse</Link>
        </Button>
      </div>
    );
  }

  // Phase 3 + Agent 2: game now carries real coverImage (resolver guarantees non-picsum for known titles)
  // even in !USE_REAL. Inner continues to use RQ for reports/stats.
  // Root QueryClientProvider in app/providers.tsx + layout.
  return <GameDetailInner game={game} />;
}

// Inner component rendered under the RQ provider so useQuery / useQueryClient are valid.
function GameDetailInner({ game }: { game: Game }) {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [showSubmit, setShowSubmit] = useState(false);
  const [myRig, setMyRig] = useState<UserPC | null>(null);
  const [canVote, setCanVote] = useState(false);
  // Error state for real hero cover (robustness for external real banner URLs)
  const [heroImgError, setHeroImgError] = useState(false);
  const heroCoverSrc = upgradeCoverImageSrc(game.coverImage, game.steamAppId);

  const supabase = useMemo(() => createClient(), []);

  // Phase 2 full DB rig persistence (Master Plan): load from user_rigs/profiles when logged in,
  // localStorage guest fallback only. Listener keeps teaser + ReportCard similarity highlights in sync
  // on sign in/out (without page reload). The embedded CompatibilityChecker manages its own rig state.
  useEffect(() => {
    let mounted = true;

    function userCanVote(user: User | null | undefined) {
      return Boolean(user?.id && user.email && !(user as { is_anonymous?: boolean }).is_anonymous);
    }

    async function loadRig() {
      try {
        const saved = await loadMyRigAsync();
        if (mounted) setMyRig(saved);
      } catch (e) {
        console.warn('[GameDetail] loadMyRigAsync error', e);
      }
    }

    loadRig();
    supabase.auth.getUser()
      .then((result: { data: { user: User | null } }) => {
        if (mounted) setCanVote(userCanVote(result.data.user));
      })
      .catch(() => {
        if (mounted) setCanVote(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (mounted) {
        setCanVote(userCanVote(session?.user));
        loadMyRigAsync()
          .then((saved) => {
            if (mounted) setMyRig(saved);
          })
          .catch(() => {});
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [supabase]);

  // Phase 3 real-data paths via adapter (when NEXT_PUBLIC_USE_REAL_DATA=true):
  // - Reports list (filtered): getReportsForGameAsync(gameId, filters) — Supabase + RLS-approved + map + pure filterReports inside adapter
  // - Unfiltered for filter dropdown options (resolutions etc.)
  // - Stats: computeGameStatsAsync (Supabase reports query + pure aggregation)
  // Heavy client filterReports logic removed from page — now delegated to adapter + RQ (caches per filter set).
  // Caching + background refetch + optimistic via React Query. Full backward compat (flag false = instant mock).
  const unfilteredReportsQuery = useQuery({
    queryKey: ['game-reports', game.id, 'unfiltered'],
    queryFn: () => getReportsForGameAsync(game.id),
  });

  const filteredReportsQuery = useQuery({
    queryKey: ['game-reports', game.id, 'filtered', filters.resolution || '', filters.gpuSeries || ''],
    queryFn: () => getReportsForGameAsync(game.id, filters),
  });

  const statsQuery = useQuery({
    queryKey: ['game-stats', game.id],
    queryFn: () => computeGameStatsAsync(game.id),
  });

  const queryClient = useQueryClient();

  const allReports: Report[] = unfilteredReportsQuery.data || [];
  const stats = statsQuery.data || {
    totalReports: 0,
    tierDistribution: { Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0 },
    avgFpsByResolution: {} as Record<string, number>,
    mostCommonPreset: null as any,
    avgFpsOverall: 0,
  };

  const filteredReports: Report[] = filteredReportsQuery.data || [];

  const resolutions = useMemo(
    () => Array.from(new Set(allReports.map((r) => r.resolution))).slice(0, 6),
    [allReports]
  );
  const gpuSeriesOptions = ['RTX 40', 'RTX 30', 'RTX 20', 'RX 6000', 'RX 7000'];

  // Sentinel value for "Any" options in Radix Select (empty string is forbidden)
  const ANY_FILTER_VALUE = '__any__';

  const handleFilterChange = (partial: Partial<ReportFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const clearFilters = () => setFilters({});

  // Signed-vote handler. ReportCard owns the optimistic display (and undo); here we
  // just persist the vote (value 0 = remove) and invalidate so DB-recomputed counters
  // (score/reputation/badges) are pulled back in as the authoritative source of truth.
  //
  // We MUST await the refetch before resolving: ReportCard keeps its buttons locked
  // (`voting`) until this promise settles. If we returned before the authoritative data
  // landed, a rapid second click would race an in-flight refetch — the stale refetch
  // resets the optimistic offset against an out-of-date base, corrupting the count.
  // Awaiting serializes clicks so the displayed score stays consistent. Errors propagate
  // so ReportCard can revert its optimistic state (it catches + logs).
  const handleVoteOptimistic = async (reportId: string, value: 1 | -1 | 0) => {
    await voteReport(reportId, value);
    await queryClient.invalidateQueries({ queryKey: ['game-reports', game.id] });
  };

  const hasCommunityReports = stats.totalReports > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/games" className="text-sm text-muted-foreground hover:text-foreground">← All games</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tighter">{game.name}</h1>
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
                hasCommunityReports
                  ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200'
                  : 'border-amber-400/40 bg-amber-500/10 text-amber-200'
              )}
            >
              {hasCommunityReports ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {statsQuery.isLoading
                ? 'Checking reports'
                : hasCommunityReports
                  ? `${stats.totalReports} community ${stats.totalReports === 1 ? 'report' : 'reports'}`
                  : 'Needs first report'}
            </Badge>
          </div>
          <div className="mt-1 text-muted-foreground">
            {game.developer} • {game.releaseYear} • {game.genres.join(', ')}
          </div>
        </div>
        <Button size="lg" onClick={() => setShowSubmit(true)}>
          Submit Your Report
        </Button>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-12">
        {/* Left column — Info + Stats */}
        <div className="lg:col-span-5 space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border">
            {/* Phase 1/3: Next Image + gameMediaLoader for real covers (IGDB/Steam/Supabase).
               Priority for LCP. Error state + improved sizes + optional attribution polish.
               Now uses portrait aspect-[2/3] to match actual cover sources (library_600x900 etc) for consistent fit with GameCard + report sections. */}
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
              {!heroImgError ? (
                <Image
                  loader={gameMediaLoader}
                  src={heroCoverSrc}
                  alt={game.name}
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 60vw, 720px"
                  quality={92}
                  priority
                  onError={() => setHeroImgError(true)}
                />
              ) : (
                /* Consistent beautiful error fallback for hero (preserves layout + visual weight) */
                <div className="absolute inset-0 bg-gradient-to-br from-muted/80 via-muted to-card flex items-center justify-center">
                  <div className="text-center px-6">
                    <div className="text-xs tracking-[3px] uppercase text-muted-foreground/60 mb-2">GAME COVER</div>
                    <div className="text-xl md:text-2xl font-semibold tracking-tighter text-foreground/90">{game.name}</div>
                  </div>
                </div>
              )}
            </div>
            {/* Optional attribution polish — subtle footer on hero for real sourced covers (no visual impact when absent) */}
            {game.coverAttribution && !heroImgError && (
              <div className="px-3 py-1 text-[10px] text-muted-foreground/70 bg-card border-t border-border rounded-b-2xl">
                {game.coverAttribution}
              </div>
            )}
          </div>

          {/* Official Requirements */}
          {(game.officialMinReqs || game.officialRecReqs) && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-sm font-medium text-muted-foreground mb-3">OFFICIAL REQUIREMENTS</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {game.officialMinReqs && (
                  <div>
                    <div className="font-medium mb-1 text-amber-400">Minimum</div>
                    <div className="space-y-0.5 text-muted-foreground">
                      <div>CPU: {game.officialMinReqs.cpu}</div>
                      <div>GPU: {game.officialMinReqs.gpu}</div>
                      <div>RAM: {game.officialMinReqs.ram} GB</div>
                    </div>
                  </div>
                )}
                {game.officialRecReqs && (
                  <div>
                    <div className="font-medium mb-1 text-emerald-400">Recommended</div>
                    <div className="space-y-0.5 text-muted-foreground">
                      <div>CPU: {game.officialRecReqs.cpu}</div>
                      <div>GPU: {game.officialRecReqs.gpu}</div>
                      <div>RAM: {game.officialRecReqs.ram} GB</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Community Stats (now powered by RQ + real adapter when flag on) */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground mb-3">
              COMMUNITY STATS — {stats.totalReports} REPORTS
              {statsQuery.isLoading && ' (loading…)'}
            </div>

            {statsQuery.isError && (
              <div className="text-xs text-amber-500 mb-2">Live stats unavailable — showing partial data.</div>
            )}

            {statsQuery.isLoading ? (
              // Dense ProtonDB-style loading skeletons for stats (Phase 3 polish)
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-4 w-8" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-border pt-4 text-sm">
                  <div className="font-medium mb-1">Average FPS by Resolution</div>
                  <div className="space-y-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex justify-between tabular-nums">
                        <Skeleton className="h-3.5 w-16" />
                        <Skeleton className="h-3.5 w-12" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {Object.entries(stats.tierDistribution).map(([tier, count]) => {
                    const pct = stats.totalReports ? Math.round((count / stats.totalReports) * 100) : 0;
                    return (
                      <div key={tier} className="flex items-center justify-between text-sm">
                        <PerformanceBadge tier={tier as PerformanceTier} size="sm" />
                        <span className="tabular-nums font-mono text-muted-foreground">{pct}%</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 border-t border-border pt-4 text-sm">
                  <div className="font-medium mb-1">Average FPS by Resolution</div>
                  {Object.keys(stats.avgFpsByResolution).length > 0 ? (
                    <div className="space-y-1 text-muted-foreground">
                      {Object.entries(stats.avgFpsByResolution).map(([res, fps]) => (
                        <div key={res} className="flex justify-between tabular-nums">
                          <span>{res}</span>
                          <span className="font-medium text-foreground">{fps} FPS</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Not enough data yet.</div>
                  )}
                </div>

                {stats.mostCommonPreset && (
                  <div className="mt-4 text-sm">
                    Most common working preset: <span className="font-semibold">{stats.mostCommonPreset}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Quick compatibility teaser */}
          {myRig && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              Your saved rig is active. Reports matching your hardware are highlighted below.
            </div>
          )}
        </div>

        {/* Right column — Filters + Reports */}
        <div className="lg:col-span-7">
          {/* Report Filters */}
          <div className="mb-4 space-y-2">
            <div className="text-xs text-muted-foreground mb-2">
              These reports from real players power the community stats, tier distributions, and similarity highlights on the left.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-muted-foreground mr-1">Filter reports:</div>

              <Select
                value={filters.resolution || ANY_FILTER_VALUE}
                onValueChange={(v) => handleFilterChange({ resolution: v === ANY_FILTER_VALUE ? undefined : v })}
              >
                <SelectTrigger
                  className={cn(
                    "h-9 w-[180px]",
                    filters.resolution && "border-primary/70 bg-primary/5 ring-1 ring-inset ring-primary/25"
                  )}
                >
                  <SelectValue placeholder="Any resolution" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_FILTER_VALUE}>Any resolution</SelectItem>
                  {resolutions.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.gpuSeries || ANY_FILTER_VALUE}
                onValueChange={(v) => handleFilterChange({ gpuSeries: v === ANY_FILTER_VALUE ? undefined : v })}
              >
                <SelectTrigger
                  className={cn(
                    "h-9 w-[160px]",
                    filters.gpuSeries && "border-primary/70 bg-primary/5 ring-1 ring-inset ring-primary/25"
                  )}
                >
                  <SelectValue placeholder="Any GPU series" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_FILTER_VALUE}>Any GPU series</SelectItem>
                  {gpuSeriesOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(filters.resolution || filters.gpuSeries) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                  className="ml-0.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/60 hover:text-destructive gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear filters
                </Button>
              )}
            </div>

            {/* Visual active filter indicators — chips make current selection obvious + easy to clear individually */}
            {(filters.resolution || filters.gpuSeries) && (
              <div className="flex flex-wrap items-center gap-2 pl-1">
                <span className="text-[10px] font-medium uppercase tracking-[1px] text-muted-foreground/70">Active filters:</span>
                {filters.resolution && (
                  <Badge
                    variant="outline"
                    className="h-6 gap-1.5 border-primary/50 bg-primary/5 pl-2.5 pr-1 text-xs text-primary hover:bg-primary/10 cursor-pointer active:bg-primary/15"
                    onClick={() => handleFilterChange({ resolution: undefined })}
                  >
                    {filters.resolution}
                    <X className="h-3 w-3 opacity-70" />
                  </Badge>
                )}
                {filters.gpuSeries && (
                  <Badge
                    variant="outline"
                    className="h-6 gap-1.5 border-primary/50 bg-primary/5 pl-2.5 pr-1 text-xs text-primary hover:bg-primary/10 cursor-pointer active:bg-primary/15"
                    onClick={() => handleFilterChange({ gpuSeries: undefined })}
                  >
                    {filters.gpuSeries}
                    <X className="h-3 w-3 opacity-70" />
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Reports list — now from RQ cached real (or mock) adapter path with server filter when flag true */}
          <div className="space-y-3">
            {filteredReportsQuery.isLoading ? (
              // ProtonDB-dense style loading skeletons for report cards (Phase 3)
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="report-card rounded-2xl border border-border bg-card p-4 md:p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-3 w-4/5" />
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                </div>
              ))
            ) : filteredReports.length > 0 ? (
              filteredReports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  userRig={myRig}
                  onVote={handleVoteOptimistic}
                  canVote={canVote}
                />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                No reports match these filters.
              </div>
            )}
          </div>

          {filteredReportsQuery.isError && (
            <div className="mt-2 text-center text-sm text-amber-500">
              Error loading reports — showing available results.
            </div>
          )}

          <div className="mt-4 text-center">
            <Button onClick={() => setShowSubmit(true)} variant="outline" className="w-full md:w-auto">
              + Submit your own report for {game.name}
            </Button>
          </div>
        </div>
      </div>

      {/* Compatibility section at bottom */}
      <div className="mt-12">
        <h3 className="mb-3 text-lg font-semibold tracking-tight">See how your rig would perform</h3>
        <CompatibilityChecker preselectedGameSlug={game.slug} />
      </div>

      <SubmitReportDialog
        open={showSubmit}
        onOpenChange={setShowSubmit}
        game={game}
        onSuccess={() => {
          // Phase 3 (per checklist): after successful addUserReport, invalidate reports for the game + stats.
          // Also invalidate global reports key so home trending/recent/stats sections (and /reports, /games list)
          // benefit from fresh data on next query (works within this page's QueryClient; minimal cross-nav wiring).
          queryClient.invalidateQueries({ queryKey: ['game-reports', game.id] });
          queryClient.invalidateQueries({ queryKey: ['game-stats', game.id] });
          queryClient.invalidateQueries({ queryKey: ['all-reports'] });
        }}
      />
    </div>
  );
}
