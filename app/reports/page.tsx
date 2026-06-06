'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  searchGames,
  getFilteredGlobalReportsAsync,
  getAllHardwareCatalogAsync,
  voteReport,
} from '@/lib/data';
import { Report, PerformanceTier, Game } from '@/lib/types';
import { PerformanceBadge } from '@/components/performance-badge';
import { ReportCard } from '@/components/report-card';
import { FilterCombobox, FilterOption } from '@/components/reports/filter-combobox';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { gameMediaLoader } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, LayoutGrid, Rows3, Loader2 } from 'lucide-react';
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
        hint: String(g.releaseYear),
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
      .map((s) => ({ value: s, label: s, group: 'Series' }));

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">All Reports Browser</h1>
          <p className="text-muted-foreground">
            Advanced filtering across every game and hardware configuration.
          </p>
        </div>

        {/* View toggle */}
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button
            onClick={() => setView('games')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              view === 'games'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> By game
          </button>
          <button
            onClick={() => setView('reports')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              view === 'reports'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" /> All reports
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <FilterCombobox
          value={gameSlug}
          onChange={pickGame}
          options={gameOptions}
          placeholder="All games"
          searchPlaceholder="Search games…"
          triggerClassName="w-[200px]"
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
          triggerClassName="w-[220px]"
        />

        {/* Min FPS — quick presets + free numeric, never disabled mid-type */}
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min FPS"
            value={minFps || ''}
            onChange={(e) => setMinFps(Number(e.target.value) || 0)}
            className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
          />
          {MIN_FPS_PRESETS.map((f) => (
            <button
              key={f}
              onClick={() => setMinFps((cur) => (cur === f ? 0 : f))}
              className={`h-9 rounded-md border px-2 text-xs font-medium transition ${
                minFps === f
                  ? 'border-primary/60 bg-primary/15 text-foreground'
                  : 'border-input text-muted-foreground hover:text-foreground'
              }`}
            >
              {f}+
            </button>
          ))}
        </div>

        <Select
          value={selectedTier || ANY_TIER_VALUE}
          onValueChange={(v) => setSelectedTier((v === ANY_TIER_VALUE ? '' : v) as PerformanceTier)}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Any tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TIER_VALUE}>Any tier</SelectItem>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-[170px]">
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <button
              key={f.key}
              onClick={f.clear}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              {f.label}
              <X className="h-3 w-3 opacity-60" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Reset all
          </Button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        {isInitialLoading ? (
          'Loading reports…'
        ) : (
          <>
            <span>
              {reports.length} {reports.length === 1 ? 'report' : 'reports'} across {gameRows.length}{' '}
              {gameRows.length === 1 ? 'game' : 'games'}
            </span>
            {isRefetching && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" />}
          </>
        )}
      </div>

      {/* Results */}
      <div className="mt-5">
        {isInitialLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex overflow-hidden rounded-2xl border border-border bg-card">
                <Skeleton className="aspect-[2/3] w-40 flex-shrink-0" />
                <div className="flex-1 space-y-3 p-4">
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
        ) : gameRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <div className="text-lg text-muted-foreground">No reports match your current filters.</div>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Try widening the filters{hasActiveFilters ? ' or resetting them' : ''}.
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={resetFilters}>
                Reset all filters
              </Button>
            )}
          </div>
        ) : view === 'games' ? (
          /* -------- Grouped game-banner rows -------- */
          <div className="space-y-3">
            {gameRows.map(({ game, reportCount, avgFps, dominantTier }) => (
              <Link
                key={game.id}
                href={`/games/${game.slug}`}
                className="group flex overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
              >
                <div className="relative aspect-[2/3] w-40 flex-shrink-0 overflow-hidden bg-muted">
                  {!bannerErrors[game.id] ? (
                    <>
                      {/* Blurred, zoomed fill behind the cover so non-portrait art (e.g. landscape
                          IGDB/RAWG covers like League of Legends or Resident Evil Requiem) is shown
                          in full via object-contain instead of being hard-cropped. True 2:3 box art
                          fills the frame edge-to-edge and hides this backdrop entirely. */}
                      <Image
                        loader={gameMediaLoader}
                        src={game.coverImage}
                        alt=""
                        aria-hidden
                        fill
                        className="scale-125 object-cover blur-xl"
                        sizes="160px"
                      />
                      <Image
                        loader={gameMediaLoader}
                        src={game.coverImage}
                        alt={game.name}
                        fill
                        className="object-contain transition-transform duration-300 group-hover:scale-[1.035]"
                        sizes="160px"
                        onError={() => setBannerErrors((prev) => ({ ...prev, [game.id]: true }))}
                      />
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/70">
                      <div className="px-2 text-center">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60">COVER</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-tight text-foreground/85">{game.name}</div>
                      </div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/25 to-transparent" />
                  <div className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-px text-[10px] font-medium text-white backdrop-blur">
                    {reportCount} {reportCount === 1 ? 'report' : 'reports'}
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-3">
                  <div className="text-[21px] font-semibold leading-none tracking-[-0.3px] text-foreground transition-colors group-hover:text-primary">
                    {game.name}
                  </div>
                  <div className="mt-1.5 text-sm text-muted-foreground">
                    {game.developer} • {game.releaseYear}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground/80">Matching your filters</div>
                </div>

                <div className="flex items-center gap-7 pr-5 text-right">
                  <div>
                    <div className="font-mono text-4xl font-semibold tabular-nums tracking-tighter text-foreground">
                      {avgFps}
                    </div>
                    <div className="-mt-1 text-[10px] font-medium text-muted-foreground">AVG FPS</div>
                  </div>
                  <div>
                    <PerformanceBadge tier={dominantTier} size="md" className="px-3.5 py-1 text-sm" />
                  </div>
                  <div className="flex items-center gap-1.5 pl-1 text-sm text-muted-foreground transition group-hover:text-foreground">
                    View reports
                    <span className="inline-block transition group-hover:translate-x-0.5">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          /* -------- Individual report cards (browsable at report granularity) -------- */
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedReports.slice(0, reportsShown).map((r) => {
                const game = gameById.get(r.gameId);
                return (
                  <div key={r.id} className="flex flex-col gap-1.5">
                    {game && (
                      <Link
                        href={`/games/${game.slug}`}
                        className="px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
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
                  onClick={() => setReportsShown((n) => n + INITIAL_REPORTS_SHOWN)}
                >
                  Show more ({sortedReports.length - reportsShown} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {(gamesQuery.isError || reportsQuery.isError) && (
        <div className="mt-2 text-center text-sm text-amber-500">
          Some live data unavailable — results may be partial.
        </div>
      )}
    </div>
  );
}
