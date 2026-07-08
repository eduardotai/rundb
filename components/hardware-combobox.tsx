'use client';

import * as React from 'react';
import { useState } from 'react';
import { Check, ChevronsUpDown, Cpu, Zap, CircuitBoard } from 'lucide-react';
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
import { useQuery } from '@tanstack/react-query';
import { getAllHardwareCatalogAsync, findHardwareByQuery } from '@/lib/data';
import { resolveIgpuForCpu } from '@/lib/cpu-igpu';
import type { HardwareCatalogEntry } from '@/lib/types';

interface HardwareComboboxProps {
  value: string;
  onChange: (value: string, canonical?: string) => void;
  componentType?: 'cpu' | 'gpu' | 'ram';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * When selecting a GPU, pass the paired CPU value so the related integrated
   * graphics option can be pinned under "From your CPU".
   */
  relatedCpu?: string;
  /** Optional controlled open state (e.g. focus GPU picker after iGPU dismiss). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function HardwareCombobox({
  value,
  onChange,
  componentType,
  placeholder = 'Select or type hardware...',
  disabled,
  className,
  relatedCpu,
  open: openControlled,
  onOpenChange: onOpenChangeControlled,
}: HardwareComboboxProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const open = openControlled ?? openUncontrolled;
  const setOpen = (next: boolean) => {
    onOpenChangeControlled?.(next);
    if (openControlled === undefined) setOpenUncontrolled(next);
  };
  const [search, setSearch] = useState('');

  // Load catalog — prefers live DB when real data mode is enabled
  const { data: allEntries = [] } = useQuery({
    queryKey: ['hardware-catalog', process.env.NEXT_PUBLIC_USE_REAL_DATA],
    queryFn: () => getAllHardwareCatalogAsync(),
    staleTime: 1000 * 60 * 10,
  });

  const relatedIgpu = React.useMemo(() => {
    if (componentType !== 'gpu' || !relatedCpu?.trim()) return null;
    const resolved = resolveIgpuForCpu(relatedCpu, allEntries as HardwareCatalogEntry[]);
    if (!resolved?.hasIgpu || !resolved.igpuCanonical) return null;
    const fromCatalog =
      resolved.igpuEntry ||
      (allEntries as HardwareCatalogEntry[]).find((e) => e.canonical === resolved.igpuCanonical);
    if (fromCatalog) return fromCatalog;
    // Synthetic minimal entry if GPU row somehow missing
    return {
      canonical: resolved.igpuCanonical,
      componentType: 'gpu' as const,
      vendor: resolved.igpuCanonical.startsWith('Intel') ? 'Intel' : 'AMD',
      series: 'iGPU',
      source: 'cpu-igpu',
      lastUpdated: new Date().toISOString().slice(0, 10),
      notes: 'Integrated graphics',
    } satisfies HardwareCatalogEntry;
  }, [componentType, relatedCpu, allEntries]);

  const filtered = React.useMemo(() => {
    // Always prefer the loaded list (live merged when real) for both no-search and search
    // This makes admin bulk adds / DB overrides immediately visible and searchable.
    const list = (allEntries as HardwareCatalogEntry[]).filter(
      (e) => !componentType || e.componentType === componentType
    );

    let results: HardwareCatalogEntry[];
    if (!search.trim()) {
      results = [...list]
        .sort((a, b) => (b.perfIndex || 0) - (a.perfIndex || 0))
        .slice(0, 20);
    } else {
      results = findHardwareByQuery(search, 20, list).filter(
        (e) => !componentType || e.componentType === componentType
      );
    }

    // Keep pinned iGPU out of the main list to avoid duplicate rows
    if (relatedIgpu) {
      results = results.filter((e) => e.canonical !== relatedIgpu.canonical);
    }
    return results;
  }, [search, allEntries, componentType, relatedIgpu]);

  const selectedEntry = (allEntries as HardwareCatalogEntry[]).find((e) => e.canonical === value);

  const handleSelect = (entry: HardwareCatalogEntry | null, customValue?: string) => {
    if (entry) {
      onChange(entry.canonical, entry.canonical);
    } else if (customValue) {
      onChange(customValue);
    }
    setOpen(false);
    setSearch('');
  };

  const renderEntryRow = (entry: HardwareCatalogEntry, opts?: { igpuBadge?: boolean }) => (
    <CommandItem
      key={entry.canonical}
      value={entry.canonical}
      onSelect={() => handleSelect(entry)}
      className="cursor-pointer"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {opts?.igpuBadge ? (
            <CircuitBoard className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : entry.componentType === 'gpu' ? (
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          ) : (
            <Cpu className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          )}
          <span className="truncate">{entry.canonical}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
          {opts?.igpuBadge && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400 uppercase tracking-wider">
              iGPU
            </span>
          )}
          {entry.perfIndex != null && <span>P{entry.perfIndex.toFixed(0)}</span>}
          {entry.vramGB != null && <span>{entry.vramGB}GB</span>}
          {entry.cores != null && <span>{entry.cores}c</span>}
          <span className="uppercase tracking-wider">{entry.series}</span>
        </div>
      </div>
      {value === entry.canonical && <Check className="ml-auto h-4 w-4" />}
    </CommandItem>
  );

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
            !value && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">
            {selectedEntry ? (
              <>
                {selectedEntry.canonical}
                {selectedEntry.perfIndex != null && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    (P{selectedEntry.perfIndex.toFixed(0)})
                  </span>
                )}
              </>
            ) : value ? (
              value
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[380px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${componentType || 'hardware'}...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              No exact match in catalog.
              <div className="mt-2 text-xs text-muted-foreground">
                You can still use your exact model name.
              </div>
            </CommandEmpty>

            {relatedIgpu && (
              <>
                <CommandGroup heading="From your CPU">
                  {renderEntryRow(relatedIgpu, { igpuBadge: true })}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            <CommandGroup heading="Catalog Matches">
              {filtered.map((entry) => renderEntryRow(entry))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup>
              <CommandItem
                onSelect={() => handleSelect(null, search || 'Custom hardware')}
                className="cursor-pointer text-muted-foreground"
              >
                Use exactly:{' '}
                <span className="ml-1 font-medium text-foreground truncate">
                  “{search || 'My exact model'}”
                </span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
