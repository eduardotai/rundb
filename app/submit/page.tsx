'use client';

import { useState, useEffect, useMemo } from 'react';
import { searchGames } from '@/lib/data';
import { SubmitReportDialog } from '@/components/submit-report-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import type { Game } from '@/lib/types';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { Loader2 } from 'lucide-react';

export default function SubmitPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setIsSearching(true);
    searchGames(debouncedSearch, 30)
      .then((results) => {
        if (!cancelled) setGames(results);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const hint = useMemo(() => {
    if (isSearching) return 'Searching…';
    if (games.length === 0 && debouncedSearch) return 'No games match your search.';
    if (games.length === 0) return 'Type to search the catalog.';
    return `${games.length} game${games.length === 1 ? '' : 's'} — click to select`;
  }, [isSearching, games.length, debouncedSearch]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Submit a Report</h1>
      <p className="mt-2 text-muted-foreground">Search for a game and tell the community how it actually runs on your hardware.</p>

      <div className="mt-8">
        <label className="text-sm font-medium" htmlFor="game-search">
          Game
        </label>
        <div className="relative mt-1.5">
          <Input
            id="game-search"
            placeholder="Search by game name…"
            value={search}
            onChange={(e) => {
              setSearch(sanitizeSearchQuery(e.target.value));
              setSelectedGame(null);
            }}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>

        {games.length > 0 && !selectedGame && (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border">
            {games.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60 transition"
                  onClick={() => {
                    setSelectedGame(g);
                    setSearch(g.name);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={g.coverImage}
                    alt=""
                    className="h-10 w-7 rounded object-cover shrink-0"
                  />
                  <span className="font-medium">{g.name}</span>
                  {g.ingestStatus === 'skeleton' && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                      loading metadata
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedGame && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selectedGame.coverImage} alt="" className="h-12 w-8 rounded object-cover" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{selectedGame.name}</div>
              <div className="text-xs text-muted-foreground">{selectedGame.developer}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedGame(null); setSearch(''); }}>
              Change
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6">
        <Button
          size="lg"
          disabled={!selectedGame}
          onClick={() => setShowDialog(true)}
          className="w-full"
        >
          Continue to Report Form
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prefer browsing first? <Link href="/games" className="underline">Go to game list</Link>
      </p>

      {selectedGame && (
        <SubmitReportDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          game={selectedGame}
        />
      )}
    </div>
  );
}
