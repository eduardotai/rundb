'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface FilterOption {
  /** The value applied to the filter when selected (e.g. a GPU series substring or a game slug). */
  value: string;
  /** Human-readable label shown in the list + trigger. */
  label: string;
  /** Optional small right-aligned hint (perf index, vram, year…). */
  hint?: string;
  /** Optional group heading; options sharing a group render together. */
  group?: string;
}

interface FilterComboboxProps {
  /** Current value ('' = nothing selected). */
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** When set, allows using a free-typed value not in the list (e.g. an exact GPU model). */
  allowCustom?: boolean;
  triggerClassName?: string;
  disabled?: boolean;
  /**
   * Called whenever the search text changes. When provided, the parent owns search
   * (e.g. a debounced server query), so the combobox stops client-filtering `options`
   * and just renders whatever the parent supplies. Enables search-as-you-type over
   * large catalogs without loading every row up front.
   */
  onSearchChange?: (query: string) => void;
  /** Show a spinner in the list while the parent's async search is in flight. */
  loading?: boolean;
  /**
   * Trigger label for the current value when it isn't present in `options` — needed in
   * async mode, where `options` only holds the latest search results, not the selection.
   */
  selectedLabel?: string;
}

/**
 * Searchable, browsable filter combobox built on the shared Command + Popover primitives.
 * Replaces the old flat <Select> (game) and broken free-text <input> (GPU) on /reports.
 * - Type-to-filter across long option lists (the catalog has 80+ GPUs, many games).
 * - Optional grouping (e.g. GPU "Series" vs "Models").
 * - Optional custom typed value so a user's exact model still works.
 * - Never disables the inner input on parent refetch, so focus is never dropped mid-type.
 */
export function FilterCombobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  allowCustom = false,
  triggerClassName,
  disabled,
  onSearchChange,
  loading = false,
  selectedLabel,
}: FilterComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // Async mode: the parent owns search (server query) and supplies the results, so we
  // render `options` as-is instead of filtering them client-side.
  const asyncSearch = !!onSearchChange;

  React.useEffect(() => {
    if (onSearchChange) onSearchChange(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = React.useMemo(() => {
    if (asyncSearch) return options;
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ? o.hint.toLowerCase().includes(q) : false)
    );
  }, [asyncSearch, search, options]);

  // Group preserving first-seen order
  const groups = React.useMemo(() => {
    const map = new Map<string, FilterOption[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const selected = options.find((o) => o.value === value);
  const triggerLabel = selected?.label || selectedLabel || (value ? value : placeholder);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch('');
  };

  const exactExists =
    !!search.trim() &&
    options.some((o) => o.label.toLowerCase() === search.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-9 justify-between gap-2 font-normal',
            !value && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          {value ? (
            <X
              className="h-3.5 w-3.5 shrink-0 opacity-60 hover:opacity-100"
              role="button"
              aria-label="Clear"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }}
            />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
              </div>
            )}
            {!loading && <CommandEmpty>No matches.</CommandEmpty>}

            {groups.map(([groupName, opts]) => (
              <CommandGroup key={groupName || '_'} heading={groupName || undefined}>
                {opts.map((o) => (
                  <CommandItem
                    key={`${groupName}:${o.value}`}
                    value={o.value}
                    onSelect={() => commit(o.value)}
                    className="cursor-pointer"
                  >
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-auto pl-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {o.hint}
                      </span>
                    )}
                    {value === o.value && <Check className="ml-2 h-4 w-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {allowCustom && search.trim() && !exactExists && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__custom__${search}`}
                    onSelect={() => commit(search.trim())}
                    className="cursor-pointer text-muted-foreground"
                  >
                    Match exactly:
                    <span className="ml-1 font-medium text-foreground truncate">
                      “{search.trim()}”
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
