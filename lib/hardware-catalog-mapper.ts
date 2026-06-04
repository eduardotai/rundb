/**
 * Hardware Catalog DB <-> TS Mapper + Live Merge
 *
 * Centralizes the snake_case (DB / Supabase) <-> camelCase (TS HardwareCatalogEntry) conversion.
 * This fixes the long-standing static-vs-live drift (see exploration: missing columns like
 * architecture/threads/tdpW, no consistent mapping in seed/reads, consumers expect camel).
 *
 * Used by:
 * - lib/data.ts + data-server.ts (live reads + merge over static)
 * - app/actions/hardware-catalog.ts (seed + bulk + upsert)
 * - Future admin bulk import, verify scripts, etc.
 *
 * Invariants:
 * - Static (lib/hardware-catalog.ts) is always the blessed offline/seed source of truth.
 * - When NEXT_PUBLIC_USE_REAL_DATA=true, DB rows (overrides or additions) win on canonical conflict.
 * - All returned objects are valid HardwareCatalogEntry (camelCase, typed).
 * - Pure + safe (no side effects, usable client/server).
 */

import type { HardwareCatalogEntry, HardwareComponentType } from './types';

/**
 * Convert a Supabase row (snake_case, possibly partial) to canonical TS shape.
 * Missing optionals default gracefully; numbers are cast.
 */
export function dbRowToHardwareCatalogEntry(row: any): HardwareCatalogEntry {
  if (!row || !row.canonical) {
    throw new Error('Invalid hardware_catalog row: missing canonical');
  }

  const componentType = (row.component_type || row.componentType || 'gpu') as HardwareComponentType;

  return {
    canonical: String(row.canonical),
    componentType,
    vendor: (row.vendor || 'Other') as HardwareCatalogEntry['vendor'],
    series: row.series || 'Unknown',
    perfIndex: row.perf_index != null ? Number(row.perf_index) : (row.perfIndex != null ? Number(row.perfIndex) : undefined),
    releaseYear: row.release_year != null ? Number(row.release_year) : (row.releaseYear != null ? Number(row.releaseYear) : undefined),
    // GPU
    vramGB: row.vram_gb != null ? Number(row.vram_gb) : (row.vramGB != null ? Number(row.vramGB) : undefined),
    architecture: row.architecture || undefined,
    // CPU
    cores: row.cores != null ? Number(row.cores) : undefined,
    threads: row.threads != null ? Number(row.threads) : undefined,
    has3DVCache: row.has_3d_vcache != null ? Boolean(row.has_3d_vcache) : (row.has3DVCache != null ? Boolean(row.has3DVCache) : false),
    tdpW: row.tdp_w != null ? Number(row.tdp_w) : (row.tdpW != null ? Number(row.tdpW) : undefined),
    // RAM / future
    memoryType: (row.memory_type || row.memoryType) as any,
    speedMTs: row.speed_mts != null ? Number(row.speed_mts) : (row.speedMTs != null ? Number(row.speedMTs) : undefined),
    notes: row.notes || undefined,
    source: row.source || 'live-db',
    lastUpdated: row.last_updated ? String(row.last_updated) : (row.lastUpdated ? String(row.lastUpdated) : new Date().toISOString()),
  };
}

/**
 * Convert a TS HardwareCatalogEntry to DB row shape (snake_case) for upsert/insert.
 * Omits undefineds to avoid sending junk; always includes requireds.
 */
export function hardwareCatalogEntryToDbRow(entry: HardwareCatalogEntry): Record<string, unknown> {
  const row: Record<string, unknown> = {
    canonical: entry.canonical,
    component_type: entry.componentType,
    vendor: entry.vendor,
    series: entry.series,
    perf_index: entry.perfIndex ?? null,
    release_year: entry.releaseYear ?? null,
    notes: entry.notes ?? null,
    source: entry.source,
    last_updated: entry.lastUpdated || new Date().toISOString(),
  };

  // GPU
  if (entry.vramGB != null) row.vram_gb = entry.vramGB;
  if (entry.architecture) row.architecture = entry.architecture;

  // CPU
  if (entry.cores != null) row.cores = entry.cores;
  if (entry.threads != null) row.threads = entry.threads;
  if (entry.has3DVCache != null) row.has_3d_vcache = entry.has3DVCache;
  if (entry.tdpW != null) row.tdp_w = entry.tdpW;

  // RAM/future
  if (entry.memoryType) row.memory_type = entry.memoryType;
  if (entry.speedMTs != null) row.speed_mts = entry.speedMTs;

  return row;
}

/**
 * Merge static catalog (base) with live DB rows (overrides/additions).
 * DB wins on exact canonical match. Result is always sorted by perfIndex desc (for combobox defaults).
 * Returns fresh array of HardwareCatalogEntry (no mutation of inputs).
 */
export function mergeCatalogs(
  staticEntries: HardwareCatalogEntry[],
  dbRows: any[]
): HardwareCatalogEntry[] {
  const byCanonical = new Map<string, HardwareCatalogEntry>();

  // Seed with static (blessed)
  for (const e of staticEntries) {
    byCanonical.set(e.canonical, { ...e });
  }

  // Apply DB overrides / new entries
  for (const row of dbRows || []) {
    try {
      const live = dbRowToHardwareCatalogEntry(row);
      byCanonical.set(live.canonical, live);
    } catch (err) {
      // Skip bad rows but don't crash the whole catalog
      console.warn('[hardware-catalog-mapper] Skipping bad DB row', row?.canonical, err);
    }
  }

  // Return as array, prefer high-perf first (matches current combobox non-search behavior)
  return Array.from(byCanonical.values()).sort((a, b) => {
    const pa = a.perfIndex ?? 0;
    const pb = b.perfIndex ?? 0;
    return pb - pa;
  });
}

/**
 * Convenience: given a raw DB list (from .select('*')), produce typed + merged result.
 * If no DB rows, just returns (a copy of) the static list.
 */
export function mergeDbRowsIntoStatic(staticEntries: HardwareCatalogEntry[], dbRows: any[] | null | undefined): HardwareCatalogEntry[] {
  if (!dbRows || dbRows.length === 0) {
    return [...staticEntries];
  }
  return mergeCatalogs(staticEntries, dbRows);
}
