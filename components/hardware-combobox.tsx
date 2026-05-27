'use client';

import * as React from 'react';
import { useState } from 'react';
import { Check, ChevronsUpDown, Cpu, Zap } from 'lucide-react';
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
import type { HardwareCatalogEntry } from '@/lib/types';

interface HardwareComboboxProps {
  value: string;
  onChange: (value: string, canonical?: string) => void;
  componentType?: 'cpu' | 'gpu' | 'ram';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function HardwareCombobox({
  value,
  onChange,
  componentType,
  placeholder = 'Select or type hardware...',
  disabled,
  className,
}: HardwareComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Load catalog — prefers live DB when real data mode is enabled
  const { data: allEntries = [] } = useQuery({
    queryKey: ['hardware-catalog', process.env.NEXT_PUBLIC_USE_REAL_DATA],
    queryFn: () => getAllHardwareCatalogAsync(),
    staleTime: 1000 * 60 * 10,
  });

  const filtered = React.useMemo(() => {
    if (!search.trim()) {
      // Show popular first when no search
      return allEntries
        .filter((e) => !componentType || e.componentType === componentType)
        .sort((a, b) => (b.perfIndex || 0) - (a.perfIndex || 0))
        .slice(0, 18);
    }
    return findHardwareByQuery(search, 18).filter(
      (e) => !componentType || e.componentType === componentType
    );
  }, [search, allEntries, componentType]);

  const selectedEntry = allEntries.find((e) => e.canonical === value);

  const handleSelect = (entry: HardwareCatalogEntry | null, customValue?: string) => {
    if (entry) {
      onChange(entry.canonical, entry.canonical);
    } else if (customValue) {
      onChange(customValue);
    }
    setOpen(false);
    setSearch('');
  };

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
                {selectedEntry.perfIndex && (
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

            <CommandGroup heading="Catalog Matches">
              {filtered.map((entry) => (
                <CommandItem
                  key={entry.canonical}
                  value={entry.canonical}
                  onSelect={() => handleSelect(entry)}
                  className="cursor-pointer"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {entry.componentType === 'gpu' ? (
                        <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      ) : (
                        <Cpu className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      )}
                      <span className="truncate">{entry.canonical}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                      {entry.perfIndex && <span>P{entry.perfIndex.toFixed(0)}</span>}
                      {entry.vramGB && <span>{entry.vramGB}GB</span>}
                      {entry.cores && <span>{entry.cores}c</span>}
                      <span className="uppercase tracking-wider">{entry.series}</span>
                    </div>
                  </div>
                  {value === entry.canonical && (
                    <Check className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup>
              <CommandItem
                onSelect={() => handleSelect(null, search || 'Custom hardware')}
                className="cursor-pointer text-muted-foreground"
              >
                Use custom / typed value: <span className="ml-1 font-medium text-foreground truncate">“{search || 'My exact model'}”</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}