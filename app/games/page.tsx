'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { GameCard } from '@/components/game-card';
import { getAllGames, getAllReportsAsync, computeGameStatsFromReports } from '@/lib/data';
import { PerformanceTier, GameStats } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { X } from 'lucide-react';

// Phase 3: Games list (heavy client filters + tier dominant + sort-by-reports) now uses real adapters + React Query.
// Fetches games + reports (adapter), derives per-game stats client-side via pure computeGameStatsFromReports (no direct mock, consistent with real).
// RQ caches; filters/sorts client but driven by real data when flag=true. Full backward + graceful loading (skeletons).
// Uses root QueryClientProvider from app/providers.tsx (no per-page client creation).

const ALL_GENRES = ['Action', 'RPG', 'Open World', 'FPS', 'Competitive', 'Strategy', 'Shooter', 'Horror', 'Survival', 'Roguelike'];
const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];

export default function GamesPage() {
  const [search, setSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedTier, setSelectedTier] = useState<PerformanceTier | ''>('');
  const [sort, setSort] = useState<'reports' | 'name' | 'year'>('reports');

  // Phase 3 real adapter calls via RQ
  const gamesQuery = useQuery({
    queryKey: ['all-games'],
    queryFn: () => getAllGames(),
  });

  const reportsQuery = useQuery({
    queryKey: ['all-reports-for-stats'],
    queryFn: () => getAllReportsAsync(),
  });

  const games = gamesQuery.data || [];
  const allReports = reportsQuery.data || [];

  // Phase 3: Derive per-game stats from adapter reports using pure helper (real data when flag on).
  // Avoids direct mock compute + supports tier/sort filters on real community data.
  const gameStatsMap = useMemo(() => {
    const map: Record<string, GameStats> = {};
    if (allReports.length === 0) return map;
    games.forEach((g) => {
      const greports = allReports.filter((r) => r.gameId === g.id);
      map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [games, allReports]);

  const filtered = useMemo(() => {
    let result = [...games];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.developer.toLowerCase().includes(q) ||
          g.genres.some((gen) => gen.toLowerCase().includes(q))
      );
    }

    if (selectedGenres.length > 0) {
      result = result.filter((g) => g.genres.some((gen) => selectedGenres.includes(gen)));
    }

    if (selectedTier) {
      result = result.filter((g) => {
        const stats = gameStatsMap[g.id];
        if (!stats) return false;
        const dominant = (Object.entries(stats.tierDistribution) as [PerformanceTier, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0];
        return dominant === selectedTier;
      });
    }

    if (sort === 'reports') {
      result.sort((a, b) => {
        const aCount = gameStatsMap[a.id]?.totalReports ?? 0;
        const bCount = gameStatsMap[b.id]?.totalReports ?? 0;
        return bCount - aCount;
      });
    } else if (sort === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'year') {
      result.sort((a, b) => b.releaseYear - a.releaseYear);
    }

    return result;
  }, [search, selectedGenres, selectedTier, sort, games, gameStatsMap]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const isLoading = gamesQuery.isLoading || reportsQuery.isLoading;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Browse Games</h1>
          <p className="text-muted-foreground">Search and filter by community performance data.</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${filtered.length} games shown`}
        </div>
      </div>

      {/* Filters */}
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
              onValueChange={(v) => setSort(v as 'reports' | 'name' | 'year')}
              disabled={isLoading}
            >
              <SelectTrigger
                className={cn(
                  "h-10 w-[180px]",
                  "border-primary/70 bg-primary/5 ring-1 ring-inset ring-primary/25"
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="reports"
                  className="data-[state=checked]:bg-primary/10 data-[state=checked]:font-semibold data-[state=checked]:text-foreground"
                >
                  Most reports
                </SelectItem>
                <SelectItem
                  value="name"
                  className="data-[state=checked]:bg-primary/10 data-[state=checked]:font-semibold data-[state=checked]:text-foreground"
                >
                  A–Z
                </SelectItem>
                <SelectItem
                  value="year"
                  className="data-[state=checked]:bg-primary/10 data-[state=checked]:font-semibold data-[state=checked]:text-foreground"
                >
                  Newest first
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Genre chips */}
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
                onClick={() => setSelectedGenres([])}
                disabled={isLoading}
                className="h-7 gap-1 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Tier filter */}
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">Dominant community tier</div>
          <div className="flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => setSelectedTier(selectedTier === tier ? '' : tier)}
                disabled={isLoading}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition',
                  selectedTier === tier ? 'border-primary bg-white text-black shadow-sm' : 'border-border hover:bg-muted',
                  isLoading && 'opacity-60 cursor-not-allowed'
                )}
              >
                {tier}
              </button>
            ))}
            {selectedTier && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedTier('')}
                disabled={isLoading}
                className="h-7 gap-1 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading ? (
          // Graceful loading skeletons for game cards grid (Phase 3)
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
              <Skeleton className="aspect-[2/3] w-full" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))
        ) : filtered.length > 0 ? (
          filtered.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              stats={gameStatsMap[game.id]}
              // Consistent real cover sizing for 4-col (xl) games grid
              imageSizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            />
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No games match your filters.
          </div>
        )}
      </div>

      {(gamesQuery.isError || reportsQuery.isError) && (
        <div className="mt-4 text-center text-sm text-amber-500">Some live stats unavailable — using partial data.</div>
      )}
    </div>
  );
}
