'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { ArrowRight, CornerDownLeft, Gamepad2, Gauge, Loader2, PlusCircle, Search, Rows3 } from 'lucide-react';
import { searchGames } from '@/lib/data';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';

const RESULT_LIMIT = 8;
const DEBOUNCE_MS = 180;

const QUICK_LINKS = [
  { href: '/games', label: 'Browse all games', icon: Gamepad2 },
  { href: '/compatibility', label: 'Will it run on my PC?', icon: Gauge },
  { href: '/reports', label: 'Latest reports', icon: Rows3 },
  { href: '/submit', label: 'Submit a report', icon: PlusCircle },
];

/** Opens on ⌘K / Ctrl+K or "/" anywhere outside a text field. */
function useSearchHotkey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

type GlobalSearchProps = {
  /** `header`: compact pill; `hero`: large field on the home page; `icon`: mobile icon button. */
  variant?: 'header' | 'hero' | 'icon';
  className?: string;
  /** Only one instance should own the keyboard shortcut. */
  hotkey?: boolean;
};

export function GlobalSearch({ variant = 'header', className, hotkey = false }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const openSearch = useCallback(() => setOpen(true), []);
  // Hook always runs; the handler is a no-op for instances that don't own the hotkey.
  const noop = useCallback(() => {}, []);
  useSearchHotkey(hotkey ? openSearch : noop);

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search games"
          className={cn(
            'grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            className
          )}
        >
          <Search className="h-[18px] w-[18px]" aria-hidden />
        </button>
      ) : variant === 'hero' ? (
        <button
          type="button"
          onClick={openSearch}
          className={cn(
            'group flex h-14 w-full items-center gap-3 rounded-2xl border border-input bg-card px-4 text-left shadow-md transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:h-16 sm:px-5',
            className
          )}
        >
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate text-base text-muted-foreground sm:text-lg">
            Search a game<span className="hidden sm:inline"> — e.g. Cyberpunk 2077</span>
          </span>
          <span className="hidden items-center gap-1 sm:flex" aria-hidden>
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform duration-200 group-hover:translate-x-0.5 sm:h-10 sm:w-10">
            <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openSearch}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-full border border-border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-foreground/20 hover:text-foreground',
            className
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">Search games…</span>
          <kbd className="kbd" aria-hidden>⌘K</kbd>
        </button>
      )}
      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Empty query: searchGames('') returns the most active games (trending, then most reported).
  // Typed query: the ranked search_games RPC (exact > prefix > word > reports).
  const { data: results = [], isFetching, isError } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchGames(debounced, RESULT_LIMIT),
    enabled: open,
    staleTime: 1000 * 60 * 2,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setQuery('');
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(20_19_17/0.4)] backdrop-blur-[3px] dark:bg-black/65" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[61] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg focus:outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Search games</DialogPrimitive.Title>
          <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <CommandPrimitive.Input
                value={query}
                onValueChange={(v) => setQuery(sanitizeSearchQuery(v))}
                placeholder="Search games by name…"
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <kbd className="kbd">Esc</kbd>
              )}
            </div>
            <CommandPrimitive.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <CommandPrimitive.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">
                {isError
                  ? 'Search is unavailable right now. Please try again.'
                  : isFetching
                    ? 'Searching…'
                    : debounced
                      ? `No games match “${debounced}”.`
                      : 'Type a game name to search.'}
              </CommandPrimitive.Empty>
              {results.length > 0 && (
                <CommandPrimitive.Group
                  heading={debounced ? 'Games' : 'Most active'}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {results.map((g) => (
                    <CommandPrimitive.Item
                      key={g.id}
                      value={g.id}
                      onSelect={() => go(`/games/${g.slug}`)}
                      className="group flex items-center gap-3 !rounded-xl !px-2 !py-2"
                    >
                      <ResultThumb src={g.coverImage} steamAppId={g.steamAppId} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{g.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[g.developer, g.releaseYear].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <CornerDownLeft className="h-4 w-4 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" aria-hidden />
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              )}
              {!debounced && (
                <CommandPrimitive.Group
                  heading="Jump to"
                  className="mt-1 border-t border-border pt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
                    <CommandPrimitive.Item
                      key={href}
                      value={href}
                      onSelect={() => go(href)}
                      className="flex items-center gap-3 !rounded-xl !px-2 !py-2 text-sm"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card">
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </span>
                      {label}
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              )}
            </CommandPrimitive.List>
            <div className="flex items-center justify-between border-t border-border bg-surface-2 px-4 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">↑</kbd>
                <kbd className="kbd">↓</kbd> to move
                <kbd className="kbd ml-2">↵</kbd> to open
              </span>
              <span className="hidden sm:inline">
                Tip: press <kbd className="kbd">/</kbd> anywhere
              </span>
            </div>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Small cover; falls back to a neutral tile when the image is missing or fails to load. */
function ResultThumb({ src, steamAppId }: { src?: string; steamAppId?: string | number | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span aria-hidden className="grid h-12 w-9 shrink-0 place-items-center rounded-md border border-border bg-muted">
        <Gamepad2 className="h-4 w-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <GameCoverFrame
      src={src}
      alt=""
      steamAppId={steamAppId}
      className="h-12 w-9 shrink-0 rounded-md"
      sizes="40px"
      blurBackdrop={false}
      onError={() => setFailed(true)}
    />
  );
}
