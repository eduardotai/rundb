'use client';

import { useState, useEffect, useMemo } from 'react';
import { searchGames } from '@/lib/data';
import { SubmitReportDialog } from '@/components/submit-report-dialog';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import type { Game } from '@/lib/types';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { upgradeCoverImageSrc } from '@/lib/cover-image-url';
import { cn } from '@/lib/utils';
import { Loader2, Search, Gamepad2, ArrowRight, Check, BarChart3, Users, Sparkles } from 'lucide-react';

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
    queueMicrotask(() => {
      if (!cancelled) setIsSearching(true);
    });
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

  const showResults = games.length > 0;

  const hint = useMemo(() => {
    if (isSearching) return 'Searching…';
    if (games.length === 0 && debouncedSearch) return 'No games match your search.';
    if (games.length === 0) return 'Start typing to search the catalog.';
    return `${games.length} game${games.length === 1 ? '' : 's'} found — click one to open the report form`;
  }, [isSearching, games.length, debouncedSearch]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      {/* Header */}
      <div className="text-center">
        <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium tracking-[0.5px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          SHARE YOUR RESULTS
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Submit a performance report</h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-muted-foreground">
          Pick a game and tell the community how it actually runs on your rig. It takes about a minute
          and helps thousands of players decide what to buy and how to tune their settings.
        </p>
      </div>

      {/* Step indicator */}
      <div className="mt-9 flex items-center justify-center gap-3 text-sm">
        <span className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition ${
              selectedGame ? 'bg-primary/15 text-primary' : 'bg-primary text-primary-foreground'
            }`}
          >
            {selectedGame ? <Check className="h-3.5 w-3.5" /> : '1'}
          </span>
          <span className={selectedGame ? 'text-muted-foreground' : 'font-medium text-foreground'}>Pick a game</span>
        </span>
        <span className="h-px w-8 bg-border" aria-hidden />
        <span className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition ${
              selectedGame ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            2
          </span>
          <span className={selectedGame ? 'font-medium text-foreground' : 'text-muted-foreground'}>Report performance</span>
        </span>
      </div>

      {/* Search + select card */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-5 md:p-6">
        <label className="text-sm font-medium" htmlFor="game-search">
          Which game did you play?
        </label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="game-search"
            placeholder="Search by game name…"
            className="h-11 pl-9 pr-9 text-base"
            value={search}
            autoComplete="off"
            onChange={(e) => {
              setSearch(sanitizeSearchQuery(e.target.value));
              setSelectedGame(null);
            }}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>

        {/* Results — always visible when matches. Clicking any card directly opens the report form for that game. */}
        {showResults && (
          <ul className="mt-3 grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {games.map((g) => {
              const isSelected = selectedGame?.id === g.id;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-background/40 hover:border-primary/50 hover:bg-muted/50"
                    )}
                    onClick={() => {
                      setSelectedGame(g);
                      setSearch(g.name);
                      setShowDialog(true);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={upgradeCoverImageSrc(g.coverImage, g.steamAppId)} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{g.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {g.developer}
                        {g.releaseYear ? ` • ${g.releaseYear}` : ''}
                      </span>
                    </span>
                    {isSelected ? (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                        <Check className="h-3.5 w-3.5" /> SELECTED
                      </span>
                    ) : (
                      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/0 transition group-hover:text-primary" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Empty state when a search returns nothing */}
        {!isSearching && games.length === 0 && debouncedSearch && (
          <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <Gamepad2 className="mx-auto h-6 w-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm text-muted-foreground">
              No games match “{debouncedSearch}”.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              Try a shorter or different spelling, or{' '}
              <Link href="/games" className="text-primary underline-offset-2 hover:underline">browse the full catalog</Link>.
            </p>
          </div>
        )}

        {/* No separate continue button — clicking a result in the list above directly opens the report form.
            The selected item stays highlighted (with ✓ SELECTED) after closing the form (cancel or submit) so you can easily re-open or switch. */}
      </div>

      {/* What makes a great report — light reassurance + browse fallback */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <BarChart3 className="h-4 w-4 text-primary" />
          <p className="mt-2 text-sm font-medium">Your real FPS</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Average and 1% lows at your resolution and preset.</p>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="mt-2 text-sm font-medium">Your tweaks</p>
          <p className="mt-0.5 text-xs text-muted-foreground">DLSS, frame-gen, and the settings that made it sing.</p>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <Users className="h-4 w-4 text-primary" />
          <p className="mt-2 text-sm font-medium">Help the next buyer</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Every report sharpens predictions for similar rigs.</p>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prefer browsing first?{' '}
        <Link href="/games" className="text-primary underline-offset-2 hover:underline">
          Go to the game list
        </Link>
      </p>

      {selectedGame && (
        <SubmitReportDialog
          open={showDialog}
          onOpenChange={setShowDialog}
          game={selectedGame}
          onSuccess={() => {
            // Reset picker after successful submit so the page is ready for another report
            // (toast is handled inside the dialog).
            setSelectedGame(null);
            setSearch('');
          }}
        />
      )}
    </div>
  );
}
