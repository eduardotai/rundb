'use client';

import { GPU_SERIES_FILTER_OPTIONS } from '@/lib/gpu-series';
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TierDistributionBar } from '@/components/charts/tier-distribution-bar';
import { FpsResolutionBars } from '@/components/charts/fps-resolution-bars';
import { ReportCard } from '@/components/report-card';
import { SubmitReportDialog } from '@/components/submit-report-dialog';
import { CompatibilityChecker } from '@/components/compatibility-checker';
import { OfficialSpecCheck } from '@/components/official-spec-check';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Plus, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { PerformanceBadge } from '@/components/performance-badge';
import {
  loadMyRigAsync,
  voteReport,
  getReportsForGameAsync,
  computeGameStatsAsync,
  usePrediction,
  useGame,
  getDominantTier,
} from '@/lib/data';
import { Report, ReportFilters, Game, UserPC } from '@/lib/types';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { ensureGameOfficialRequirementsAction } from '@/app/actions/steam-requirements';

export default function GameDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  // Agent 2 fix: use RQ + useGame (which calls getGameBySlugAsync + full enrichment via resolver/game_media).
  // Replaces dangerous top-level sync getGameBySlug (which ignored real data + always picsum fallback).
  // Shows loading skeleton for LCP hero area; not-found only after resolution.
  const { game, isLoading, error } = useGame(slug);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <div className="mt-6 flex items-end gap-6">
          <Skeleton className="aspect-[2/3] w-32 rounded-xl sm:w-44" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-40 rounded-full" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="mt-8 h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (!game || error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted text-2xl" aria-hidden>?</div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Game not found</h1>
        <p className="mt-2 text-muted-foreground">The game you’re looking for doesn’t exist in our database yet.</p>
        <Button asChild className="mt-6 rounded-full">
          <Link href="/games">Browse all games</Link>
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

  // Rig prediction for the "your rig lands here" marker on the tier bar.
  // Canonical hook (lib/data.ts): keyed by the rig object, gated on a complete rig,
  // and shared with any other surface that predicts for the same rig+game.
  const predictionQuery = usePrediction((myRig ?? undefined) as UserPC, game.id);

  const queryClient = useQueryClient();

  // Lazy Steam official min/rec whenever both sides are empty.
  // Always call the server action (by slug) — server decides using DB steam_app_id + TTLs.
  // Do NOT gate on community reports; this path is publisher-spec only.
  const hasUsableMin =
    Boolean(game.officialMinReqs) &&
    !!(
      (typeof game.officialMinReqs?.cpu === 'string' && game.officialMinReqs.cpu.trim()) ||
      (typeof game.officialMinReqs?.gpu === 'string' && game.officialMinReqs.gpu.trim()) ||
      (typeof game.officialMinReqs?.ram === 'number' && game.officialMinReqs.ram > 0)
    );
  const hasUsableRec =
    Boolean(game.officialRecReqs) &&
    !!(
      (typeof game.officialRecReqs?.cpu === 'string' && game.officialRecReqs.cpu.trim()) ||
      (typeof game.officialRecReqs?.gpu === 'string' && game.officialRecReqs.gpu.trim()) ||
      (typeof game.officialRecReqs?.ram === 'number' && game.officialRecReqs.ram > 0)
    );
  const needsOfficialReqsEnsure = Boolean(
    game.slug &&
      !hasUsableMin &&
      !hasUsableRec &&
      game.officialReqsStatus !== 'ready' &&
      // After a confirmed empty Steam response, server TTL applies; still hit once per
      // session only via staleTime — server will skip if within negative-cache window.
      true
  );

  const officialReqsEnsureQuery = useQuery({
    queryKey: ['game-official-reqs-ensure', game.slug],
    queryFn: () => ensureGameOfficialRequirementsAction(game.slug),
    enabled: needsOfficialReqsEnsure,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Patch the game cache when ensure returns new min/rec (or status).
  useEffect(() => {
    const r = officialReqsEnsureQuery.data;
    if (!r) return;
    if (
      r.officialMinReqs ||
      r.officialRecReqs ||
      r.status === 'empty' ||
      r.status === 'ready' ||
      r.status === 'skipped' ||
      r.status === 'rate_limited' ||
      r.status === 'error' ||
      r.status === 'misconfigured'
    ) {
      queryClient.setQueryData<Game | null>(['game', game.slug], (old) => {
        if (!old) return old;
        const nextStatus: Game['officialReqsStatus'] =
          r.status === 'ready' || r.status === 'empty'
            ? r.status
            : r.status === 'rate_limited' || r.status === 'error'
              ? r.status
              : r.status === 'skipped' && r.reason === 'no_steam_id'
                ? old.officialReqsStatus
                : (r.status as Game['officialReqsStatus']) ?? old.officialReqsStatus;
        return {
          ...old,
          officialMinReqs: r.officialMinReqs ?? old.officialMinReqs,
          officialRecReqs: r.officialRecReqs ?? old.officialRecReqs,
          officialReqsStatus: nextStatus ?? old.officialReqsStatus,
        };
      });
    }
  }, [officialReqsEnsureQuery.data, game.slug, queryClient]);

  const isLoadingOfficialReqs =
    needsOfficialReqsEnsure &&
    (officialReqsEnsureQuery.isLoading || officialReqsEnsureQuery.isFetching);

  const officialReqsLoadError = (() => {
    const r = officialReqsEnsureQuery.data;
    if (!r) return null;
    if (r.status === 'empty') {
      return 'Steam does not list parseable PC minimum/recommended requirements for this title.';
    }
    if (r.status === 'skipped' && (r.reason === 'no_steam_id' || r.message)) {
      if (r.reason === 'no_steam_id' || r.message?.includes('Steam App ID')) {
        return (
          r.message ||
          'This game is not linked to a Steam App ID, so publisher min/recommended specs cannot be loaded automatically.'
        );
      }
    }
    if (r.status === 'skipped' && r.reason === 'negative_cache') {
      return 'Steam does not list parseable PC minimum/recommended requirements for this title.';
    }
    if (r.ok && (r.officialMinReqs || r.officialRecReqs)) return null;
    if (r.status === 'rate_limited') {
      return 'Couldn’t load publisher specs right now (Steam rate limit). Try again later.';
    }
    if (r.status === 'misconfigured') {
      return 'Server is missing configuration needed to load Steam requirements (service role).';
    }
    if (r.status === 'error' || r.status === 'not_found') {
      return r.message || 'Couldn’t load publisher specs right now. Try again later.';
    }
    return null;
  })();

  // Prefer ensure result when cache not yet patched (first paint after fetch).
  const displayGame: Game = useMemo(() => {
    const r = officialReqsEnsureQuery.data;
    if (!r?.officialMinReqs && !r?.officialRecReqs) return game;
    return {
      ...game,
      officialMinReqs: r.officialMinReqs ?? game.officialMinReqs,
      officialRecReqs: r.officialRecReqs ?? game.officialRecReqs,
    };
  }, [game, officialReqsEnsureQuery.data]);

  const unfilteredReportsData = unfilteredReportsQuery.data;
  const allReports: Report[] = useMemo(() => unfilteredReportsData || [], [unfilteredReportsData]);
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

  // Only paint community tier marker when we actually have matching reports.
  // Empty-pool predictions used to claim "Playable" at low confidence — dishonest.
  const communityPredictedTier =
    predictionQuery.data &&
    predictionQuery.data.matchingReports.length > 0 &&
    predictionQuery.data.confidence > 0
      ? predictionQuery.data.predictedTier
      : null;
  const communityPredictionConfidence =
    communityPredictedTier != null ? predictionQuery.data?.confidence : undefined;

  const dominantTier = hasCommunityReports ? getDominantTier(stats) : null;
  const activeFilterCount = (filters.resolution ? 1 : 0) + (filters.gpuSeries ? 1 : 0);

  return (
    <div className="pb-16">
      {/* Hero band: blurred cover wash + cover + title + key numbers */}
      <section className="relative overflow-hidden border-b border-border">
        {!heroImgError && (
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.22] dark:opacity-[0.18]">
            <GameCoverFrame
              src={game.coverImage}
              alt=""
              steamAppId={game.steamAppId}
              className="h-full w-full scale-125 blur-3xl"
              sizes="200px"
              blurBackdrop={false}
            />
          </div>
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/75 to-background" />
        <div className="relative mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 md:pb-10 md:pt-8">
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            <Link href="/games" className="inline-flex items-center gap-1 hover:text-foreground">
              <ChevronLeft className="h-4 w-4" aria-hidden /> All games
            </Link>
          </nav>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-muted shadow-lg sm:w-40 md:w-44">
              <div className="relative aspect-[2/3] w-full">
                {!heroImgError ? (
                  <GameCoverFrame
                    src={game.coverImage}
                    alt={game.name}
                    steamAppId={game.steamAppId}
                    className="h-full w-full"
                    sizes="(max-width: 640px) 128px, 176px"
                    quality={92}
                    priority
                    blurBackdrop={false}
                    onError={() => setHeroImgError(true)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-3 text-center">
                    <div className="text-sm font-semibold leading-tight text-foreground/80">{game.name}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                    hasCommunityReports
                      ? 'border-border bg-card text-foreground'
                      : 'border-brand/30 bg-brand/10 text-brand'
                  )}
                >
                  {hasCommunityReports ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {statsQuery.isLoading
                    ? 'Checking reports'
                    : hasCommunityReports
                      ? `${stats.totalReports} community ${stats.totalReports === 1 ? 'report' : 'reports'}`
                      : 'Needs first report'}
                </Badge>
                {game.genres.slice(0, 3).map((g) => (
                  <span key={g} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {g}
                  </span>
                ))}
              </div>
              <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">{game.name}</h1>
              <div className="mt-2 text-muted-foreground">
                {[game.developer, game.releaseYear].filter(Boolean).join(' · ')}
              </div>
              {/* Credit for sourced cover art (e.g. Steam library art); hidden when the image failed. */}
              {game.coverAttribution && !heroImgError && (
                <p className="mt-2 text-xs text-muted-foreground/80" data-testid="cover-attribution">
                  {game.coverAttribution}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2 sm:pb-1">
              <Button size="lg" className="w-full rounded-full sm:w-auto" onClick={() => setShowSubmit(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Submit your report
              </Button>
            </div>
          </div>

          {/* KPI row */}
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-xs md:grid-cols-4">
            <div className="bg-card p-4 sm:p-5">
              <dt className="eyebrow">Average FPS</dt>
              <dd className="mt-2 flex items-baseline gap-1.5">
                {statsQuery.isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <>
                    <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
                      {hasCommunityReports ? Math.round(stats.avgFpsOverall) : '—'}
                    </span>
                    {hasCommunityReports && <span className="text-sm text-muted-foreground">all resolutions</span>}
                  </>
                )}
              </dd>
            </div>
            <div className="bg-card p-4 sm:p-5">
              <dt className="eyebrow">Most reports say</dt>
              <dd className="mt-2.5">
                {statsQuery.isLoading ? (
                  <Skeleton className="h-7 w-24 rounded-full" />
                ) : dominantTier ? (
                  <PerformanceBadge tier={dominantTier} size="lg" />
                ) : (
                  <span className="text-sm text-muted-foreground">Not enough data</span>
                )}
              </dd>
            </div>
            <div className="bg-card p-4 sm:p-5">
              <dt className="eyebrow">Reports</dt>
              <dd className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight">
                {statsQuery.isLoading ? <Skeleton className="h-8 w-10" /> : stats.totalReports}
              </dd>
            </div>
            <div className="bg-card p-4 sm:p-5">
              <dt className="eyebrow">Common preset</dt>
              <dd className="mt-2 text-2xl font-semibold tracking-tight">
                {statsQuery.isLoading ? <Skeleton className="h-8 w-20" /> : stats.mostCommonPreset ?? '—'}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="mx-auto mt-8 grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-12">
        {/* Main column — reports */}
        <div className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="theme-section-title text-xl">Community reports</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Real players, real hardware. {myRig ? 'Reports close to your saved rig are highlighted.' : 'Save your rig to highlight reports like yours.'}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-xs">
            <span className="flex items-center gap-1.5 px-2 text-sm font-medium text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filter
              {activeFilterCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </span>
            <Select
              value={filters.resolution || ANY_FILTER_VALUE}
              onValueChange={(v) => handleFilterChange({ resolution: v === ANY_FILTER_VALUE ? undefined : v })}
            >
              <SelectTrigger
                aria-label="Filter by resolution"
                className={cn('h-9 w-[170px] rounded-full', filters.resolution && 'border-foreground/40 bg-muted')}
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
                aria-label="Filter by GPU series"
                className={cn('h-9 w-[160px] rounded-full', filters.gpuSeries && 'border-foreground/40 bg-muted')}
              >
                <SelectValue placeholder="Any GPU series" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_FILTER_VALUE}>Any GPU series</SelectItem>
                {GPU_SERIES_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1.5 rounded-full">
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
            <span className="ml-auto hidden px-2 text-sm tabular-nums text-muted-foreground sm:inline" aria-live="polite">
              {filteredReportsQuery.isLoading ? 'Loading…' : `${filteredReports.length} shown`}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {filteredReportsQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="surface space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-3 w-4/5" />
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
              <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
                <p className="font-medium">
                  {activeFilterCount > 0 ? 'No reports match these filters' : 'No reports yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeFilterCount > 0
                    ? 'Try another resolution or GPU series.'
                    : `Be the first to share how ${game.name} runs on your PC.`}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  {activeFilterCount > 0 && (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                  <Button size="sm" className="rounded-full" onClick={() => setShowSubmit(true)}>
                    Submit a report
                  </Button>
                </div>
              </div>
            )}
          </div>

          {filteredReportsQuery.isError && (
            <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
              Error loading reports — showing available results.
            </div>
          )}

          {filteredReports.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSubmit(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-card hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add your own report for {game.name}
            </button>
          )}
        </div>

        {/* Sidebar — stats + official specs */}
        <aside className="space-y-4 lg:col-span-4" aria-label="Game performance summary">
          <div className="surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold tracking-tight">Community stats</h2>
              <span className="text-xs text-muted-foreground">
                {stats.totalReports} {stats.totalReports === 1 ? 'report' : 'reports'}
              </span>
            </div>

            {statsQuery.isError && (
              <div className="mt-2 text-xs text-warning">Live stats unavailable — showing partial data.</div>
            )}

            {statsQuery.isLoading ? (
              <div className="mt-4 space-y-4">
                <Skeleton className="h-4 w-full rounded-full" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-3.5 w-full" />
                  ))}
                </div>
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <TierDistributionBar
                    distribution={stats.tierDistribution}
                    total={stats.totalReports}
                    predictedTier={communityPredictedTier}
                    confidence={communityPredictionConfidence}
                  />
                </div>
                <div className="mt-5 border-t border-border pt-4">
                  <div className="eyebrow mb-3">Average FPS by resolution</div>
                  <FpsResolutionBars avgFpsByResolution={stats.avgFpsByResolution} />
                </div>
              </>
            )}
          </div>

          {myRig && (
            <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <span>Your saved rig is active. Reports matching your hardware are highlighted.</span>
            </div>
          )}

          {(displayGame.officialMinReqs || displayGame.officialRecReqs) && (
            <div className="surface p-5">
              <h2 className="font-semibold tracking-tight">Official requirements</h2>
              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {displayGame.officialMinReqs && (
                  <div className="rounded-xl bg-muted/60 p-3">
                    <div className="eyebrow mb-2">Minimum</div>
                    <dl className="space-y-1.5">
                      <div><dt className="text-xs text-muted-foreground">CPU</dt><dd className="font-medium leading-snug">{displayGame.officialMinReqs.cpu}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">GPU</dt><dd className="font-medium leading-snug">{displayGame.officialMinReqs.gpu}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">RAM</dt><dd className="font-medium">{displayGame.officialMinReqs.ram} GB</dd></div>
                    </dl>
                  </div>
                )}
                {displayGame.officialRecReqs && (
                  <div className="rounded-xl bg-muted/60 p-3">
                    <div className="eyebrow mb-2">Recommended</div>
                    <dl className="space-y-1.5">
                      <div><dt className="text-xs text-muted-foreground">CPU</dt><dd className="font-medium leading-snug">{displayGame.officialRecReqs.cpu}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">GPU</dt><dd className="font-medium leading-snug">{displayGame.officialRecReqs.gpu}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">RAM</dt><dd className="font-medium">{displayGame.officialRecReqs.ram} GB</dd></div>
                    </dl>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoadingOfficialReqs &&
            !displayGame.officialMinReqs &&
            !displayGame.officialRecReqs && (
              <div className="surface p-5">
                <h2 className="font-semibold tracking-tight">Official requirements</h2>
                <p className="mt-2 text-sm text-muted-foreground">Loading Steam minimum and recommended requirements…</p>
              </div>
            )}

          {/* Official hardware check — independent of community reports (single instance). */}
          {!statsQuery.isLoading && (
            <OfficialSpecCheck
              game={displayGame}
              myRig={myRig}
              hasCommunityReports={hasCommunityReports}
              isLoadingReqs={isLoadingOfficialReqs}
              reqsLoadError={officialReqsLoadError}
            />
          )}
        </aside>
      </div>

      {/* Compatibility section at bottom */}
      <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6" aria-labelledby="rig-check">
        <h2 id="rig-check" className="theme-section-title text-xl">How would your rig perform?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Save your hardware once and get a prediction from similar community reports.</p>
        <div className="mt-5">
          <CompatibilityChecker preselectedGameSlug={game.slug} embedded />
        </div>
      </section>

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
          // Home page surfaces: trending ranking + global hero counts pick up the new report on next query.
          queryClient.invalidateQueries({ queryKey: ['trending-games'] });
          queryClient.invalidateQueries({ queryKey: ['global-counts'] });
        }}
      />
    </div>
  );
}
