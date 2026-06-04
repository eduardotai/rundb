/**
 * RunDB Hardware Normalization Pipeline
 *
 * Raw user input (free text from any source) → rich canonical + catalog entry + confidence.
 *
 * Used by:
 * - Submit flow (client + server action)
 * - Compatibility checker
 * - Profile rig editor
 * - Future validation + similarity
 *
 * Design:
 * - Layered: sanitize → exact alias → built-in abbreviations → catalog fuzzy → heuristic series
 * - Reuses existing HardwareAlias system (when available)
 * - Fully safe for server actions (no localStorage dependency in core path)
 * - Unknown hardware → graceful "none" result with original input preserved
 */

import type { HardwareNormalizationResult, HardwareCatalogEntry } from './types';
import { sanitizeFullName } from './sanitize';
import {
  getHardwareEntry,
  resolveAbbreviation,
  findHardwareByQuery,
} from './hardware-catalog';

const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true';

// Lazy import to avoid pulling localStorage code into server bundles unnecessarily
async function safeLoadAliases(): Promise<Array<{ rawString: string; canonical: string }>> {
  if (typeof window === 'undefined') {
    // Server / server action path — use only built-in catalog abbreviations
    return [];
  }

  // When real data, try live hardware_aliases table first (community curated)
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data } = await supabase
        .from('hardware_aliases')
        .select('raw_string, canonical')
        .limit(500);
      if (data && data.length) {
        return data.map((r: any) => ({
          rawString: String(r.raw_string || '').toLowerCase(),
          canonical: String(r.canonical),
        }));
      }
    } catch {
      // fall through to mock LS
    }
  }

  try {
    const { loadHardwareAliases } = await import('./mock-data');
    return loadHardwareAliases().map((a) => ({
      rawString: a.rawString.toLowerCase(),
      canonical: a.canonical,
    }));
  } catch {
    return [];
  }
}

/**
 * Main normalization function.
 * Returns rich result including catalog entry when found.
 */
export async function normalizeHardware(rawInput: string): Promise<HardwareNormalizationResult> {
  const original = rawInput;
  const cleaned = sanitizeFullName(rawInput);

  if (!cleaned || cleaned.length < 2) {
    return {
      originalInput: original,
      confidence: 0,
      method: 'none',
    };
  }

  // 1. Exact catalog match (case-insensitive)
  const direct = getHardwareEntry(cleaned);
  if (direct) {
    return {
      canonical: direct.canonical,
      entry: direct,
      originalInput: original,
      confidence: 0.98,
      method: 'exact',
    };
  }

  // 2. Built-in abbreviations (very effective for gamers)
  const abbr = resolveAbbreviation(cleaned);
  if (abbr) {
    const entry = getHardwareEntry(abbr);
    if (entry) {
      return {
        canonical: entry.canonical,
        entry,
        originalInput: original,
        confidence: 0.92,
        method: 'heuristic',
      };
    }
  }

  // 3. HardwareAlias table (client only, when available)
  const aliases = await safeLoadAliases();
  const lowerClean = cleaned.toLowerCase();
  for (const alias of aliases) {
    if (alias.rawString === lowerClean || lowerClean.includes(alias.rawString)) {
      const entry = getHardwareEntry(alias.canonical);
      if (entry) {
        return {
          canonical: entry.canonical,
          entry,
          originalInput: original,
          confidence: 0.9,
          method: 'alias',
        };
      }
    }
  }

  // 4. Fuzzy search against full catalog (good for partial model names)
  // When real, try to use live-merged catalog for better coverage of admin-added entries
  let fuzzySource: any[] | undefined;
  if (USE_REAL) {
    try {
      const { getAllHardwareCatalogAsync } = await import('./data');
      const live = await getAllHardwareCatalogAsync();
      if (live && live.length > 20) fuzzySource = live; // use live if substantial
    } catch {}
  }
  const fuzzyMatches = findHardwareByQuery(cleaned, 5, fuzzySource as any);
  if (fuzzyMatches.length > 0) {
    // Prefer exact series + vendor match when possible
    const best = fuzzyMatches[0];
    return {
      canonical: best.canonical,
      entry: best,
      originalInput: original,
      confidence: 0.72,
      method: 'heuristic',
    };
  }

  // 5. Last resort: keep original (user will still get predictions via old heuristics)
  return {
    originalInput: original,
    confidence: 0.15,
    method: 'none',
  };
}

/**
 * Synchronous version for pure functions / client components where we don't need aliases.
 * Still very strong thanks to built-in abbreviations + catalog.
 */
export function normalizeHardwareSync(rawInput: string): HardwareNormalizationResult {
  const original = rawInput;
  const cleaned = sanitizeFullName(rawInput);

  if (!cleaned || cleaned.length < 2) {
    return { originalInput: original, confidence: 0, method: 'none' };
  }

  const direct = getHardwareEntry(cleaned);
  if (direct) {
    return { canonical: direct.canonical, entry: direct, originalInput: original, confidence: 0.97, method: 'exact' };
  }

  const abbr = resolveAbbreviation(cleaned);
  if (abbr) {
    const entry = getHardwareEntry(abbr);
    if (entry) {
      return { canonical: entry.canonical, entry, originalInput: original, confidence: 0.91, method: 'heuristic' };
    }
  }

  const fuzzy = findHardwareByQuery(cleaned, 3);
  if (fuzzy.length > 0) {
    const best = fuzzy[0];
    return { canonical: best.canonical, entry: best, originalInput: original, confidence: 0.68, method: 'heuristic' };
  }

  return { originalInput: original, confidence: 0.12, method: 'none' };
}

/**
 * Convenience: get perfIndex for a raw string (used heavily by similarity engine).
 *
 * Memoized: the similarity engine calls this several times per report, and on a
 * cache miss normalizeHardwareSync runs a fuzzy catalog scan that allocates a
 * haystack string per catalog entry. Over thousands of reports (popular games on
 * the compatibility tab) that allocation churn was a major source of memory
 * pressure / OOM. The static catalog makes raw→perfIndex a pure function, so a
 * module-level cache is safe and stays bounded by the number of distinct hardware
 * strings seen (realistically hundreds).
 */
const perfIndexCache = new Map<string, number | undefined>();

export function getPerfIndexForRaw(raw: string): number | undefined {
  if (!raw) return undefined;
  const cached = perfIndexCache.get(raw);
  if (cached !== undefined || perfIndexCache.has(raw)) return cached;
  const result = normalizeHardwareSync(raw);
  const perfIndex = result.entry?.perfIndex;
  perfIndexCache.set(raw, perfIndex);
  return perfIndex;
}

/**
 * Batch helper (useful for admin/import).
 */
export async function normalizeMany(inputs: string[]): Promise<HardwareNormalizationResult[]> {
  return Promise.all(inputs.map((i) => normalizeHardware(i)));
}
