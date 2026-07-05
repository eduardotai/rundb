'use client';

import { useState, useMemo, useEffect } from 'react';
import { GameCard } from '@/components/game-card';
import {
  getGamesPage,
  getAllReportsAsync,
  computeGameStatsFromReports,
  applyGamesBrowseTransform,
  USE_REAL,
} from '@/lib/data';
import { PerformanceTier, GameStats } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const ALL_GENRES = ['Action', 'RPG', 'Open World', 'FPS', 'Competitive', 'Strategy', 'Shooter', 'Horror', 'Survival', 'Roguelike'];
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
  const needsGlobalTransform = Boolean(selectedTier) || sort === 'reports';

  const gamesQuery = useQuery({
    queryKey: paginatedMode
      ? ['games-page', needsGlobalTransform ? 'full' : page, debouncedSearch, selectedGenres[0] || '', sort, selectedTier || '']
      : ['all-games'],
    queryFn: () =>
      paginatedMode
        ? getGamesPage({
            page: needsGlobalTransform ? 1 : page,
            pageSize: needsGlobalTransform ? 10000 : PAGE_SIZE,
            search: debouncedSearch || undefined,
            genre: selectedGenres[0],
            sort, // pass 'reports' too; server delegates search/genre, reports sort + tier done globally client on received set
          })
        : getAllGames().then((games) => ({
            games,
            total: games.length,
            page: 1,
            pageSize: games.length,
            totalPages: 1,
          })),
  });

  const reportsQuery = useQuery({
    queryKey: ['all-reports-for-stats'],
    queryFn: () => getAllReportsAsync(),
  });

  const pageData = gamesQuery.data;
  const rawGames = useMemo(() => pageData?.games ?? [], [pageData]);
  const reportsData = reportsQuery.data;
  const allReports = useMemo(() => reportsData || [], [reportsData]);

  const gameStatsMap = useMemo(() => {
    const map: Record<string, GameStats> = {};
    if (allReports.length === 0) return map;
    // Compute for received games. When needsGlobalTransform we requested the full search/genre set,
    // so stats cover everything needed for tier filter + global reports sort.
    rawGames.forEach((g) => {
      const greports = allReports.filter((r) => r.gameId === g.id);
      map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [rawGames, allReports]);

  // Server delegates search/genre in paginated (full set requested when tier/reports active).
  // Client search/genre only for mock full mode. Tier + reports (and post-tier name/year) via pure transform for uniformity.
  const postFilterSortAll = useMemo(() => {
    let working = [...rawGames];

    if (!paginatedMode) {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        working = working.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            g.developer.toLowerCase().includes(q) ||
            g.genres.some((gen) => gen.toLowerCase().includes(q))
        );
      }

      if (selectedGenres.length > 0) {
        working = working.filter((g) => g.genres.some((gen) => selectedGenres.includes(gen)));
      }
    }

    // Delegate tier + sort to the pure testable transform (uses global stats counts for reports)
    return applyGamesBrowseTransform(working, gameStatsMap, {
      tier: selectedTier,
      sort,
    });
  }, [paginatedMode, rawGames, debouncedSearch, selectedGenres, selectedTier, sort, gameStatsMap]);

  // Derive display list + counts/pages from the *fully transformed* set when client post-processing
  // (tier or reports) was used; otherwise trust server page data for name/year no-tier case.
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

    // Simple server-paged name/year (no tier) or mock mode: no extra slice
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
  // Counts, pages, display list, and paging controls now always derive from post-filter/sort transformed set
  // when tier or reports-sort active (via needsGlobalTransform + effective* derived from postFilterSortAll).

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const next = prev.includes(genre) ? prev.filter((g) => g !== genre) : [genre];
      setPage(1);
      return next;
    });
  };

  const isLoading = gamesQuery.isLoading;
  const isStatsLoading = reportsQuery.isLoading;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Browse Games</h1>
          <p className="text-muted-foreground">Search and filter by community performance data.</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : paginatedMode
              ? `${totalGames} games${selectedTier ? ' (tier-filtered)' : ''} · page ${effectivePage}/${effectiveTotalPages}`
              : `${postFilterSortAll.length} games shown`}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="Search games or developers..."
            value={search}
            onChange={(e) => setSearch(sanitizeSearchQuery(e.target.value))}
            className="md:w-80"
            disabled={isLoading}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Sort:</span>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as 'reports' | 'name' | 'year');
                setPage(1);
              }}
              disabled={isLoading}
            >
              <SelectTrigger
                className={cn(
                  'h-10 w-[180px]',
                  'border-primary/70 bg-primary/5 ring-1 ring-inset ring-primary/25'
                )}
              >
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

        <div>
          <div className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">Genres</div>
          <div className="flex flex-wrap gap-2">
            {ALL_GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => toggleGenre(genre)}
                disabled={isLoading}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition',
                  selectedGenres.includes(genre)
                    ? 'border-primary bg-white text-black shadow-sm'
                    : 'border-border hover:bg-muted',
                  isLoading && 'opacity-60 cursor-not-allowed'
                )}
              >
                {genre}
              </button>
            ))}
            {selectedGenres.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedGenres([]);
                  setPage(1);
                }}
                disabled={isLoading}
                className="h-7 gap-1 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">Dominant community tier</div>
          <div className="flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => {
                  setSelectedTier(selectedTier === tier ? '' : tier);
                  setPage(1);
                }}
                disabled={isLoading || isStatsLoading || allReports.length === 0}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition',
                  selectedTier === tier ? 'border-primary bg-white text-black shadow-sm' : 'border-border hover:bg-muted',
                  isLoading && 'opacity-60 cursor-not-allowed'
                )}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {isLoading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <Skeleton className="aspect-[2/3] w-full" />
              <div className="p-2.5 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))
        ) : displayGames.length > 0 ? (
          displayGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              stats={gameStatsMap[game.id]}
              variant="compact"
              imageSizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 20vw, 16vw"
            />
          ))
        ) : rawGames.length === 0 && !hasActiveFilters ? (
          <div className="col-span-full py-12 text-center">
            <p className="text-muted-foreground">No games in the database yet.</p>
            {USE_REAL && (
              <p className="mt-2 text-sm text-muted-foreground">
                Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run build:seed</code>,{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run seed:queue</code>, then{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run ingest:worker</code>.
              </p>
            )}
          </div>
        ) : (
          <div className="col-span-full py-12 text-center text-muted-foreground">No games match your filters.</div>
        )}
      </div>

      {paginatedMode && effectiveTotalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
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

      {(gamesQuery.isError || reportsQuery.isError) && (
        <div className="mt-4 text-center text-sm text-amber-500">Some live stats unavailable — using partial data.</div>
      )}
    </div>
  );
}
