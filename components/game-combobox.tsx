'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Gamepad2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useQuery } from '@tanstack/react-query';
import { searchGames } from '@/lib/data';
import type { Game } from '@/lib/types';

interface GameComboboxProps {
  /** Selected game id, or 'all' for no game filter. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Optional seed list (e.g. already-loaded games) used only to resolve the
   * label of the current selection without an extra fetch. The dropdown itself
   * always fetches dynamically via searchGames — it never renders this whole list.
   */
  games?: Game[];
  disabled?: boolean;
  className?: string;
}

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

export function GameCombobox({ value, onChange, games = [], disabled, className }: GameComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  // Remember the game picked in this component so the trigger stays correct even
  // after the search results that contained it have been replaced.
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  // Debounce the search term so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Only fetch a small, dynamic slice of games (matching the query, or the
  // first RESULT_LIMIT alphabetically when empty) — never the full catalog.
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['game-combobox', debounced],
    queryFn: () => searchGames(debounced, RESULT_LIMIT),
    enabled: open,
    staleTime: 1000 * 60 * 2,
  });

  const handleSelect = (id: string, name?: string) => {
    onChange(id);
    setPicked(id === 'all' || !name ? null : { id, name });
    setOpen(false);
    setSearch('');
  };

  // Resolve the trigger label without an effect: prefer the in-component pick,
  // then the seed list, then whatever the current search results reveal.
  const resolvedLabel =
    (picked?.id === value ? picked.name : undefined) ||
    games.find((g) => g.id === value)?.name ||
    (results as Game[]).find((g) => g.id === value)?.name;
  const triggerLabel = value === 'all' ? 'All games' : resolvedLabel || 'Selected game';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            value === 'all' && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate" title={value === 'all' ? undefined : triggerLabel}>{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[min(420px,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search games..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isFetching ? 'Searching…' : 'No games found.'}
            </CommandEmpty>

            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => handleSelect('all')} className="cursor-pointer">
                <span>All games</span>
                {value === 'all' && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>

              {(results as Game[]).map((game) => (
                <CommandItem
                  key={game.id}
                  value={game.id}
                  onSelect={() => handleSelect(game.id, game.name)}
                  className="cursor-pointer"
                >
                  <Gamepad2 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="whitespace-normal break-words">{game.name}</span>
                  {game.releaseYear ? (
                    <span className="ml-2 text-[10px] text-muted-foreground shrink-0">{game.releaseYear}</span>
                  ) : null}
                  {value === game.id && <Check className="ml-2 h-4 w-4 shrink-0" />}
                </CommandItem>
              ))}

              {isFetching && (results as Game[]).length > 0 && (
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Updating…
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
