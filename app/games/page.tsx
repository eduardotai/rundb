'use client';

import { useState, useMemo, useEffect } from 'react';
import { GameCard } from '@/components/game-card';
import {
  getGamesPage,
  getAllGames,
  getAllReportsAsync,
  getReportedGamesWithStatsAsync,
  useAvailableGenres,
  computeGameStatsFromReports,
  applyGamesBrowseTransform,
  USE_REAL,
} from '@/lib/data';
import { PerformanceTier, GameStats, Game } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { X, ChevronLeft, ChevronRight, Search, SearchX, Gamepad2 } from 'lucide-react';

const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];
const PAGE_SIZE = 48;

export default function GamesPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedTier, setSelectedTier] = useState<PerformanceTier | ''>('');
  const [sort, setSort] = useState<'reports' | 'name' | 'year'>('name');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const paginatedMode = USE_REAL;
  // Tier filter: only games WITH reports can have a dominant tier, so real mode loads exactly
  // that set (all reported games + their stats) instead of "the first N games" (PostgREST caps
  // any page at 1,000 rows, which hid every reported game past row 1,000 A–Z).
  // Name / year / reports sorts are applied server-side via getGamesPage — do not re-sort and scramble them.
  const needsGlobalTransform = Boolean(selectedTier);
  const tierMode = paginatedMode && needsGlobalTransform;
  const { data: genreOptions = [] } = useAvailableGenres();

  const gamesQuery = useQuery({
    queryKey: paginatedMode
      ? ['games-page', page, debouncedSearch, selectedGenres[0] || '', sort]
      : ['all-games'],
    enabled: !tierMode,
    queryFn: () =>
      paginatedMode
        ? getGamesPage({
            page,
            pageSize: PAGE_SIZE,
            search: debouncedSearch || undefined,
            genre: selectedGenres[0],
            // Server applies: name=A–Z, year=newest release_year, reports=report_count
            sort,
          })
        : getAllGames().then((games: Game[]) => ({
            games,
            total: games.length,
            page: 1,
            pageSize: games.length,
            totalPages: 1,
          })),
  });

  const reportedQuery = useQuery({
    queryKey: ['reported-games-with-stats', debouncedSearch, selectedGenres[0] || ''],
    enabled: tierMode,
    queryFn: () =>
      getReportedGamesWithStatsAsync({ search: debouncedSearch || undefined, genre: selectedGenres[0] }),
  });

  const reportsQuery = useQuery({
    queryKey: ['all-reports-for-stats'],
    queryFn: () => getAllReportsAsync(),
  });

  const pageData = gamesQuery.data;
  const reportedData = reportedQuery.data;
  const rawGames = useMemo(
    () => (tierMode ? reportedData?.games ?? [] : pageData?.games ?? []),
    [tierMode, reportedData, pageData]
  );
  const reportsData = reportsQuery.data;
  const allReports = useMemo(() => reportsData || [], [reportsData]);

  const gameStatsMap = useMemo(() => {
    if (tierMode && reportedData) return reportedData.stats;
    const map: Record<string, GameStats> = {};
    if (allReports.length === 0) return map;
    // Compute for received games. When needsGlobalTransform we requested the full search/genre set,
    // so stats cover everything needed for tier filter + global reports sort.
    rawGames.forEach((g: Game) => {
      const greports = allReports.filter((r) => r.gameId === g.id);
      map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [tierMode, reportedData, rawGames, allReports]);

  // Real mode without tier: trust server search/genre/sort order (do not re-sort with empty stats).
  // Mock mode: full client filter + sort. Tier filter: client dominant-tier pass + re-sort.
  const postFilterSortAll = useMemo(() => {
    let working = [...rawGames];

    if (!paginatedMode) {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        working = working.filter(
          (g: Game) =>
            g.name.toLowerCase().includes(q) ||
            g.developer.toLowerCase().includes(q) ||
            g.genres.some((gen: string) => gen.toLowerCase().includes(q))
        );
      }

      if (selectedGenres.length > 0) {
        working = working.filter((g: Game) => g.genres.some((gen: string) => selectedGenres.includes(gen)));
      }

      return applyGamesBrowseTransform(working, gameStatsMap, {
        tier: selectedTier,
        sort,
      });
    }

    if (selectedTier) {
      return applyGamesBrowseTransform(working, gameStatsMap, {
        tier: selectedTier,
        sort,
      });
    }

    // Server already ordered by name / release_year / report_count
    return working;
  }, [paginatedMode, rawGames, debouncedSearch, selectedGenres, selectedTier, sort, gameStatsMap]);

  // Derive display list + counts/pages from the *fully transformed* set when tier filter
  // forced a bulk load; otherwise trust server page metadata for name/year/reports.
  const { displayGames, totalGames, totalPages: effectiveTotalPages, currentPage: effectivePage } = useMemo(() => {
    if (paginatedMode && needsGlobalTransform) {
      const full = postFilterSortAll;
      const t = full.length;
      const tp = Math.max(1, Math.ceil(t / PAGE_SIZE));
      const p = Math.min(Math.max(1, page), tp);
      const start = (p - 1) * PAGE_SIZE;
      return {
        displayGames: full.slice(start, start + PAGE_SIZE),
        totalGames: t,
        totalPages: tp,
        currentPage: p,
      };
    }

    // Server-paged sorts (no tier) or mock mode (already sliced / full list)
    return {
      displayGames: postFilterSortAll,
      totalGames: pageData?.total ?? postFilterSortAll.length,
      totalPages: pageData?.totalPages ?? 1,
      currentPage: pageData?.page ?? page,
    };
  }, [paginatedMode, needsGlobalTransform, postFilterSortAll, page, pageData]);

  const hasActiveFilters =
    Boolean(debouncedSearch) || selectedGenres.length > 0 || Boolean(selectedTier);
  // Note: hasActiveFilters intentionally excludes sort (sort is ordering, not a restrictor for "empty db vs no matches").

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const next = prev.includes(genre) ? prev.filter((g) => g !== genre) : [genre];
      setPage(1);
      return next;
    });
  };

  const isLoading = tierMode ? reportedQuery.isLoading : gamesQuery.isLoading;
  const isStatsLoading = tierMode ? reportedQuery.isLoading : reportsQuery.isLoading;
  // The game list itself failed: say so instead of "no games" (fetchers throw since #78).
  const listError = tierMode ? reportedQuery.isError : gamesQuery.isError;
  const retryList = () => (tierMode ? reportedQuery.refetch() : gamesQuery.refetch());

  const tierFill: Record<PerformanceTier, string> = {
    Excellent: 'var(--tier-excellent-fill)',
    Good: 'var(--tier-good-fill)',
    Playable: 'var(--tier-playable-fill)',
    Struggling: 'var(--tier-struggling-fill)',
    Unplayable: 'var(--tier-unplayable-fill)',
  };

  const clearAll = () => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedGenres([]);
    setSelectedTier('');
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="theme-page-title">Browse games</h1>
          <p className="mt-1.5 text-muted-foreground">
            Search the catalog and filter by how games actually run for the community.
          </p>
        </div>
      </div>

      <div className="sticky top-[var(--header-h)] z-30 -mx-4 mt-6 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative md:w-96">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search games or developers…"
              aria-label="Search games or developers"
              value={search}
              onChange={(e) => setSearch(sanitizeSearchQuery(e.target.value))}
              className="h-11 rounded-full pl-9 pr-9"
              disabled={isLoading}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 md:ml-auto">
            <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {isLoading
                ? 'Loading…'
                : paginatedMode
                  ? `${totalGames} games${effectiveTotalPages > 1 ? ` · page ${effectivePage}/${effectiveTotalPages}` : ''}`
                  : `${postFilterSortAll.length} games`}
            </span>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as 'reports' | 'name' | 'year');
                setPage(1);
              }}
              disabled={isLoading}
            >
              <SelectTrigger className="ml-auto h-11 w-[170px] rounded-full md:ml-0" aria-label="Sort games">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reports">Most reports</SelectItem>
                <SelectItem value="name">A–Z</SelectItem>
                <SelectItem value="year">Newest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <div className="scrollbar-none -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 md:flex-wrap md:overflow-visible" role="group" aria-label="Filter by genre">
            <span className="eyebrow mr-1 w-12 shrink-0">Genre</span>
            {genreOptions.slice(0, 12).map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                disabled={isLoading}
                aria-pressed={selectedGenres.includes(genre)}
                className="chip shrink-0"
              >
                {genre}
              </button>
            ))}
          </div>
          <div className="scrollbar-none -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 md:flex-wrap md:overflow-visible" role="group" aria-label="Filter by community tier">
            <span className="eyebrow mr-1 w-12 shrink-0">Runs</span>
            {TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => {
                  setSelectedTier(selectedTier === tier ? '' : tier);
                  setPage(1);
                }}
                disabled={isLoading || isStatsLoading}
                aria-pressed={selectedTier === tier}
                className="chip shrink-0"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tierFill[tier] }} aria-hidden />
                {tier}
              </button>
            ))}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="ml-1 h-8 shrink-0 gap-1 rounded-full px-3 text-xs"
              >
                <X className="h-3 w-3" />
                Clear all
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="motion-grid-stagger mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {isLoading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="surface overflow-hidden">
              <Skeleton className="aspect-[2/3] w-full rounded-none" />
              <div className="p-2.5 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))
        ) : listError ? (
          <div role="alert" className="col-span-full rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">Couldn&apos;t load games right now</p>
            <p className="mt-1 text-sm text-muted-foreground">The catalog is temporarily unavailable. Please try again.</p>
            <Button variant="outline" size="sm" className="mt-5 rounded-full" onClick={() => void retryList()}>
              Try again
            </Button>
          </div>
        ) : displayGames.length > 0 ? (
          displayGames.map((game: Game) => (
            <GameCard
              key={game.id}
              game={game}
              stats={gameStatsMap[game.id]}
              variant="compact"
              imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 20vw, 16vw"
            />
          ))
        ) : rawGames.length === 0 && !hasActiveFilters ? (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card py-14 text-center">
            <Gamepad2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">No games in the database yet.</p>
            {USE_REAL && (
              <p className="mt-2 text-sm text-muted-foreground">
                Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run build:seed</code>,{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run seed:queue</code>, then{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run ingest:worker</code>.
              </p>
            )}
          </div>
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">No games match your filters</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different name, or remove a genre or tier filter.</p>
            <Button variant="outline" size="sm" className="mt-5 rounded-full" onClick={clearAll}>
              Clear all filters
            </Button>
          </div>
        )}
      </div>

      {paginatedMode && effectiveTotalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={effectivePage <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {effectivePage} of {effectiveTotalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={effectivePage >= effectiveTotalPages || isLoading}
            onClick={() => setPage((p) => Math.min(effectiveTotalPages, p + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {!listError && !tierMode && reportsQuery.isError && (
        <div className="mt-4 text-center text-sm text-warning">Community stats are unavailable right now, so tiers and FPS are hidden.</div>
      )}
    </div>
  );
}
