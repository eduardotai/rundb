'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  searchGames,
  getFilteredGlobalReportsAsync,
  getAllHardwareCatalogAsync,
  voteReport,
  GLOBAL_REPORTS_CAP,
} from '@/lib/data';
import { Report, PerformanceTier, Game } from '@/lib/types';
import { PerformanceBadge } from '@/components/performance-badge';
import { ReportCard } from '@/components/report-card';
import { FilterCombobox, FilterOption } from '@/components/reports/filter-combobox';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { createClient } from '@/lib/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GPU_SERIES_FILTER_OPTIONS } from '@/lib/gpu-series';
import { X, LayoutGrid, Rows3, Loader2, ChevronRight, SearchX } from 'lucide-react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

// /reports — global, browsable, filterable reports explorer.
// Filters are catalog-backed (GPU from the real hardware DB, games searchable) and never lose
// focus while data refetches (keepPreviousData + no disabling of inputs mid-type).
// Data via real adapters (getAllGames + getFilteredGlobalReportsAsync) + React Query (Supabase
// when flag=true with RLS + graceful mock fallback).

const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];
const ANY_TIER_VALUE = '__any__';
const MIN_FPS_PRESETS = [30, 60, 120, 144];

type SortKey = 'reports' | 'fps' | 'name';
type ViewMode = 'games' | 'reports';

const INITIAL_REPORTS_SHOWN = 24;

// Strip the vendor prefix so a catalog model becomes a substring that actually appears in
// user-entered GPU strings (filter is a case-insensitive `includes` on report.gpu).
function shortGpuModel(canonical: string): string {
  return canonical
    .replace(/^NVIDIA GeForce\s+/i, '')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/^AMD Radeon\s+/i, '')
    .replace(/^AMD\s+/i, '')
    .replace(/^Intel Arc\s+/i, '')
    .replace(/^Intel\s+/i, '')
    .trim();
}

const GAME_SEARCH_LIMIT = 20;

export default function ReportsBrowser() {
  const [gameSlug, setGameSlug] = useState('');
  // The picked game, remembered so the trigger/chip/link still show its name even though
  // the combobox only holds the latest search results (not the whole catalog).
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  // Search-as-you-type for the game filter — debounced so each keystroke doesn't hit the DB.
  const [gameSearch, setGameSearch] = useState('');
  const [debouncedGameSearch, setDebouncedGameSearch] = useState('');
  const [gpuSeries, setGpuSeries] = useState('');
  const [minFps, setMinFps] = useState(0);
  const [selectedTier, setSelectedTier] = useState<PerformanceTier | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('reports');
  const [view, setView] = useState<ViewMode>('games');
  const [reportsShown, setReportsShown] = useState(INITIAL_REPORTS_SHOWN);
  const [canVote, setCanVote] = useState(false);
  // Per-game banner error states for real covers (robust graceful degradation)
  const [bannerErrors, setBannerErrors] = useState<Record<string, boolean>>({});

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedGameSearch(gameSearch), 250);
    return () => clearTimeout(t);
  }, [gameSearch]);

  useEffect(() => {
    let mounted = true;
    const userCanVote = (user: User | null | undefined) =>
      Boolean(user?.id && user.email && !(user as { is_anonymous?: boolean }).is_anonymous);

    supabase.auth.getUser()
      .then((result: { data: { user: User | null } }) => {
        if (mounted) setCanVote(userCanVote(result.data.user));
      })
      .catch(() => {
        if (mounted) setCanVote(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (mounted) setCanVote(userCanVote(session?.user));
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [supabase]);

  // Server-side search-as-you-type for the game filter — only ~20 matches are fetched/rendered
  // at a time, so the page no longer loads (and the combobox no longer renders) the whole catalog.
  const gamesQuery = useQuery({
    queryKey: ['reports-game-search', debouncedGameSearch],
    queryFn: () => searchGames(debouncedGameSearch, GAME_SEARCH_LIMIT),
    placeholderData: keepPreviousData,
  });

  // Hardware catalog powers the GPU filter options (real DB merge when flag=true, static otherwise).
  const catalogQuery = useQuery({
    queryKey: ['hardware-catalog', process.env.NEXT_PUBLIC_USE_REAL_DATA],
    queryFn: () => getAllHardwareCatalogAsync(),
    staleTime: 1000 * 60 * 10,
  });

  // keepPreviousData = the list stays visible (and inputs keep focus) while a new filter refetches.
  const reportsQuery = useQuery({
    queryKey: ['filtered-global-reports', gameSlug, gpuSeries, minFps || 0, selectedTier || ''],
    queryFn: () =>
      getFilteredGlobalReportsAsync({
        gameSlug: gameSlug || undefined,
        gpuSeries: gpuSeries || undefined,
        minFps: minFps || undefined,
        tier: selectedTier || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // Latest game-search results — only powers the filter combobox options (not page metadata).
  const gameSearchResults = useMemo<Game[]>(() => gamesQuery.data || [], [gamesQuery.data]);
  const reports = useMemo<Report[]>(() => reportsQuery.data || [], [reportsQuery.data]);

  // Only a true first-load (no data yet) shows skeletons; refetches keep the list + focus.
  // The combobox's own search runs independently and must not blank the results below.
  const isInitialLoading = reportsQuery.isLoading && !reportsQuery.data;
  const isRefetching = reportsQuery.isFetching && !isInitialLoading;

  // Game metadata (cover/slug/dev/year) now rides along on each report via the embedded join,
  // so the "By game" banners render without ever fetching the full catalog.
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    for (const r of reports) if (r.game) m.set(r.gameId, r.game);
    return m;
  }, [reports]);

  // ---- Filter options ----------------------------------------------------
  const gameOptions: FilterOption[] = useMemo(
    () =>
      gameSearchResults.map((g) => ({
        value: g.slug,
        label: g.name,
        hint: g.releaseYear ? String(g.releaseYear) : undefined, // unknown year is stored as 0
      })),
    [gameSearchResults]
  );

  const gpuOptions: FilterOption[] = useMemo(() => {
    const gpus = (catalogQuery.data || []).filter((e) => e.componentType === 'gpu');

    // Series options (e.g. "RTX 40", "RX 9000"), ranked by their strongest member.
    const seriesBest = new Map<string, number>();
    for (const e of gpus) {
      if (!e.series) continue;
      const cur = seriesBest.get(e.series) ?? 0;
      if ((e.perfIndex ?? 0) > cur) seriesBest.set(e.series, e.perfIndex ?? 0);
    }
    const seriesOpts: FilterOption[] = Array.from(seriesBest.keys())
      .sort((a, b) => (seriesBest.get(b)! - seriesBest.get(a)!))
      .map((s) => ({
        value: s,
        // Friendly label for architecture names ("RDNA 3" -> "RX 7000 (RDNA 3)"), same as game pages.
        label: GPU_SERIES_FILTER_OPTIONS.find((o) => o.value === s)?.label ?? s,
        group: 'Series',
      }));

    // Model options — value is the vendor-stripped model so it matches real report.gpu strings.
    const modelOpts: FilterOption[] = [...gpus]
      .sort((a, b) => (b.perfIndex ?? 0) - (a.perfIndex ?? 0))
      .map((e) => ({
        value: shortGpuModel(e.canonical),
        label: e.canonical,
        hint: e.vramGB ? `${e.vramGB}GB` : undefined,
        group: 'Models',
      }));

    return [...seriesOpts, ...modelOpts];
  }, [catalogQuery.data]);

  // ---- Aggregations ------------------------------------------------------
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

    for (const [gameId, greps] of gameReportGroups) {
      const g = gameById.get(gameId);
      if (!g || greps.length === 0) continue;

      const count = greps.length;
      const avgFps = Math.round(greps.reduce((s, r) => s + r.avgFps, 0) / count);

      const tierCounts: Record<string, number> = {};
      greps.forEach((r) => {
        tierCounts[r.performanceTier] = (tierCounts[r.performanceTier] || 0) + 1;
      });
      const dominantTier = (Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        'Playable') as PerformanceTier;

      rows.push({ game: g, reportCount: count, avgFps, dominantTier });
    }

    rows.sort((a, b) => {
      if (sortKey === 'fps') return b.avgFps - a.avgFps;
      if (sortKey === 'name') return a.game.name.localeCompare(b.game.name);
      return b.reportCount - a.reportCount;
    });
    return rows;
  }, [gameById, gameReportGroups, sortKey]);

  const sortedReports = useMemo(() => {
    const list = [...reports];
    if (sortKey === 'fps') list.sort((a, b) => b.avgFps - a.avgFps);
    else if (sortKey === 'name') {
      list.sort((a, b) =>
        (gameById.get(a.gameId)?.name || '').localeCompare(gameById.get(b.gameId)?.name || '')
      );
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [reports, sortKey, gameById]);

  // ---- Active filters ----------------------------------------------------
  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (gameSlug) {
      const name = selectedGame?.name || gameById.get(selectedGame?.id || '')?.name || gameSlug;
      chips.push({ key: 'game', label: name, clear: () => clearGame() });
    }
    if (gpuSeries) chips.push({ key: 'gpu', label: gpuSeries, clear: () => setGpuSeries('') });
    if (minFps) chips.push({ key: 'fps', label: `≥ ${minFps} FPS`, clear: () => setMinFps(0) });
    if (selectedTier)
      chips.push({ key: 'tier', label: selectedTier, clear: () => setSelectedTier('') });
    return chips;
  }, [gameSlug, gpuSeries, minFps, selectedTier, selectedGame, gameById]);

  const hasActiveFilters = activeFilters.length > 0;

  // Picking from the combobox gives us a slug; capture the full game from the current search
  // results so the trigger/chip keep its name (the combobox no longer holds the whole catalog).
  const pickGame = (slug: string) => {
    if (!slug) return clearGame();
    setGameSlug(slug);
    setSelectedGame(gameSearchResults.find((g) => g.slug === slug) || null);
  };

  const clearGame = () => {
    setGameSlug('');
    setSelectedGame(null);
  };

  const resetFilters = () => {
    clearGame();
    setGpuSeries('');
    setMinFps(0);
    setSelectedTier('');
  };

  const handleReportVote = async (reportId: string, value: 1 | -1 | 0) => {
    await voteReport(reportId, value);
  };

  const maxRowFps = gameRows.reduce((m, r) => Math.max(m, r.avgFps), 0) || 1;
  const tierFillVar: Record<PerformanceTier, string> = {
    Excellent: 'var(--tier-excellent-fill)',
    Good: 'var(--tier-good-fill)',
    Playable: 'var(--tier-playable-fill)',
    Struggling: 'var(--tier-struggling-fill)',
    Unplayable: 'var(--tier-unplayable-fill)',
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="theme-page-title">Reports</h1>
          <p className="mt-1.5 text-muted-foreground">
            Approved community reports, filterable by game, GPU, FPS and tier.
          </p>
        </div>

        {/* View toggle (segmented control) */}
        <div className="inline-flex rounded-full border border-border bg-muted p-1" role="group" aria-label="View">
          <button
            onClick={() => setView('games')}
            aria-pressed={view === 'games'}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition ${
              view === 'games'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> By game
          </button>
          <button
            onClick={() => setView('reports')}
            aria-pressed={view === 'reports'}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition ${
              view === 'reports'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" /> All reports
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <FilterCombobox
            value={gameSlug}
            onChange={pickGame}
            options={gameOptions}
            placeholder="All games"
            searchPlaceholder="Search games…"
            triggerClassName="w-full sm:w-[200px]"
            onSearchChange={setGameSearch}
            loading={gamesQuery.isFetching}
            selectedLabel={selectedGame?.name}
          />

          <FilterCombobox
            value={gpuSeries}
            onChange={setGpuSeries}
            options={gpuOptions}
            placeholder="Any GPU"
            searchPlaceholder="Search GPU series or model…"
            allowCustom
            triggerClassName="w-full sm:w-[210px]"
          />

          <Select
            value={selectedTier || ANY_TIER_VALUE}
            onValueChange={(v) => setSelectedTier((v === ANY_TIER_VALUE ? '' : v) as PerformanceTier)}
          >
            <SelectTrigger className="h-10 w-[150px]" aria-label="Filter by tier">
              <SelectValue placeholder="Any tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TIER_VALUE}>Any tier</SelectItem>
              {TIERS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Min FPS — quick presets + free numeric, never disabled mid-type */}
          <div className="flex items-center gap-1 rounded-[calc(var(--radius)-2px)] border border-input bg-card p-1 shadow-xs" role="group" aria-label="Minimum FPS">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min FPS"
              aria-label="Minimum average FPS"
              value={minFps || ''}
              onChange={(e) => setMinFps(Number(e.target.value) || 0)}
              className="h-8 w-20 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            {MIN_FPS_PRESETS.map((f) => (
              <button
                key={f}
                onClick={() => setMinFps((cur) => (cur === f ? 0 : f))}
                aria-pressed={minFps === f}
                className={`h-8 rounded-md px-2.5 text-xs font-medium tabular-nums transition ${
                  minFps === f
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {f}+
              </button>
            ))}
          </div>

          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <span className="text-sm text-muted-foreground">Sort</span>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-10 flex-1 sm:w-[170px] sm:flex-none" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reports">{view === 'games' ? 'Most reports' : 'Newest'}</SelectItem>
                <SelectItem value="fps">Highest avg FPS</SelectItem>
                <SelectItem value="name">Game name (A–Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Active filter chips + reset (only when something is active) */}
        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={f.clear}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
              >
                {f.label}
                <X className="h-3 w-3 opacity-60" />
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 gap-1.5 rounded-full px-2.5 text-xs">
              <X className="h-3.5 w-3.5" />
              Reset all
            </Button>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {isInitialLoading ? (
          'Loading reports…'
        ) : (
          <>
            <span>
              <span className="font-medium text-foreground">{reports.length}</span> {reports.length === 1 ? 'report' : 'reports'} across{' '}
              <span className="font-medium text-foreground">{gameRows.length}</span> {gameRows.length === 1 ? 'game' : 'games'}
              {reports.length >= GLOBAL_REPORTS_CAP && ` (newest ${GLOBAL_REPORTS_CAP}; narrow the filters to see older ones)`}
            </span>
            {isRefetching && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" />}
          </>
        )}
      </div>

      {/* Results */}
      <div className="mt-3">
        {isInitialLoading ? (
          <div className="surface divide-y divide-border overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-14 w-10 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
                <Skeleton className="hidden h-6 w-24 sm:block" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : reportsQuery.isError && !reportsQuery.data ? (
          <div role="alert" className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <div className="mt-3 font-medium">Couldn&apos;t load reports right now</div>
            <p className="mt-1 text-sm text-muted-foreground">Please try again in a moment.</p>
            <Button variant="outline" size="sm" className="mt-5 rounded-full" onClick={() => void reportsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : gameRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <div className="mt-3 font-medium">No reports match your current filters</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Try widening the filters{hasActiveFilters ? ' or resetting them' : ''}.
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" className="mt-5 rounded-full" onClick={resetFilters}>
                Reset all filters
              </Button>
            )}
          </div>
        ) : view === 'games' ? (
          /* -------- Compact, scannable game rows -------- */
          <div className="surface overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_6rem_12rem_8rem_1.5rem] items-center gap-4 border-b border-border bg-surface-2 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
              <span>Game</span>
              <span className="text-right">Reports</span>
              <span>Average FPS</span>
              <span>Most reports</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              {gameRows.map(({ game, reportCount, avgFps, dominantTier }) => (
                <li key={game.id}>
                  <Link
                    href={`/games/${game.slug}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none md:grid-cols-[minmax(0,1fr)_6rem_12rem_8rem_1.5rem]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {!bannerErrors[game.id] ? (
                        <GameCoverFrame
                          src={game.coverImage}
                          alt=""
                          steamAppId={game.steamAppId}
                          className="h-14 w-10 shrink-0 rounded-md border border-border"
                          sizes="48px"
                          blurBackdrop={false}
                          onError={() => setBannerErrors((prev) => ({ ...prev, [game.id]: true }))}
                        />
                      ) : (
                        <div className="h-14 w-10 shrink-0 rounded-md border border-border bg-muted" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{game.name}</div>
                        <div className="truncate text-sm text-muted-foreground">
                          {[game.developer, game.releaseYear].filter(Boolean).join(' · ')}
                          <span className="md:hidden"> · {reportCount} {reportCount === 1 ? 'report' : 'reports'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">{reportCount}</div>
                    <div className="hidden items-center gap-3 md:flex">
                      <span className="w-10 font-mono text-lg font-semibold tabular-nums">{avgFps}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.max(6, Math.round((avgFps / maxRowFps) * 100))}%`, backgroundColor: tierFillVar[dominantTier] }}
                        />
                      </span>
                    </div>
                    <div className="flex items-center gap-3 md:block">
                      <span className="font-mono text-lg font-semibold tabular-nums md:hidden">{avgFps}<span className="ml-0.5 text-xs font-normal text-muted-foreground">fps</span></span>
                      <PerformanceBadge tier={dominantTier} size="sm" />
                    </div>
                    <ChevronRight className="hidden h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground md:block" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          /* -------- Individual report cards (browsable at report granularity) -------- */
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sortedReports.slice(0, reportsShown).map((r) => {
                const game = gameById.get(r.gameId);
                return (
                  <div key={r.id} className="flex flex-col gap-1.5">
                    {game && (
                      <Link
                        href={`/games/${game.slug}`}
                        className="px-1 text-sm font-medium text-foreground hover:text-brand"
                      >
                        {game.name}
                      </Link>
                    )}
                    <ReportCard report={r} compact onVote={handleReportVote} canVote={canVote} />
                  </div>
                );
              })}
            </div>
            {sortedReports.length > reportsShown && (
              <div className="mt-6 text-center">
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setReportsShown((n) => n + INITIAL_REPORTS_SHOWN)}
                >
                  Show more ({sortedReports.length - reportsShown} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {gamesQuery.isError && (
        <div className="mt-2 text-center text-sm text-warning">Game search is unavailable right now.</div>
      )}
      {reportsQuery.isError && reportsQuery.data && (
        <div className="mt-2 text-center text-sm text-warning">
          Couldn&apos;t refresh reports; showing the last results.
        </div>
      )}
    </div>
  );
}
