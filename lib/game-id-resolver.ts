/**
 * Public API Resilience Layer (Agent 5 / plan PR 5)
 *
 * Cached resolver: Steam-first AppID map + RAWG / IGDB fallbacks.
 * Both demo seeds (bulk import, admin CLI seeds, mock enrichment) and
 * future runtime enrichment (data.ts get*Async paths, live game detail hydration)
 * MUST use this single source.
 *
 * Guarantees:
 * - Never throws to callers (resilience). Always returns a resolution.
 * - In-memory TTL cache (shared across requests in same process / serverless instance).
 * - Attribution string ALWAYS populated and suitable for storage/display/legal.
 * - Steam prioritized (static map → public search API with no key required).
 * - Graceful degradation + structured logging ([resolver] prefix).
 *
 * Env keys (optional for full fallbacks):
 *   RAWG_API_KEY
 *   IGDB_CLIENT_ID / IGDB_CLIENT_SECRET  (reuse existing from Phase 1)
 *
 * Attribution is designed to be stored e.g. alongside resolved IDs or in audit logs.
 * (game_media already has attribution column; games table may gain source/attribution columns in future.)
 */

import type { Game } from './types';
import { SLUG_STEAM_APP_IDS } from './game-cover-catalog';

// ============================================
// STATIC STEAM-FIRST APPID MAP (curated, zero-cost, high confidence)
// Keys = canonical slugs used across seeds/ingest/admin (see normalizeSlug in utils)
// Values verified against official Steam store (as of 2026 data snapshot)
// Catalog from mock-data is merged in as the primary source.
// ============================================
const STEAM_APPID_MAP: Record<string, string> = {
  ...SLUG_STEAM_APP_IDS,
  // Legacy slug aliases
  'the-witcher-3-wild-hunt': '292030',
  'resident-evil-4': '2050650',
};

// ============================================
// ATTRIBUTION STRINGS (store these!)
// All end-users / DB rows / UI footers using resolved data must credit sources.
// ============================================
export const ATTRIBUTIONS = {
  'static-map':
    'Steam AppID from curated static map (cross-verified with official Steam store listings). Sourced from Steam. (https://store.steampowered.com/)',
  'steam-search':
    'Steam AppID resolved dynamically via public Steam Store Search API (https://store.steampowered.com/api/). App data © Valve Corporation. Used for non-commercial informational purposes only.',
  rawg:
    'External IDs and game metadata sourced from RAWG.io API (https://rawg.io/apidocs). © RAWG. Used under API terms for informational purposes.',
  igdb:
    'Sourced from IGDB (https://www.igdb.com). Game IDs, metadata and related data © respective copyright holders. Used for non-commercial informational purposes.',
  none:
    'No Steam AppID / external IDs could be resolved from public Steam/RAWG/IGDB sources. Internal RunDB data only.',
} as const;

// ============================================
// CACHE + RESILIENCE CONFIG
// ============================================
interface CacheEntry {
  resolution: ExternalIdResolution;
  timestamp: number;
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — long enough for seeds + typical runtime sessions
const FETCH_TIMEOUT_MS = 4500;

let lastSteamCallTs = 0;
const STEAM_RATE_MS = 180; // Polite to public Steam search (no strict limit published but good citizen)

let igdbToken: string | null = null;
let igdbTokenExpiry = 0;

// ============================================
// TYPES (the public API surface)
// ============================================
export interface ExternalIdResolution {
  /** Primary target: Steam AppID (as string for consistency with schema.text) */
  steamAppId?: string;
  /** IGDB numeric ID as string (matches games.igdb_id column) */
  igdbId?: string;
  /** RAWG numeric ID if resolved */
  rawgId?: number;
  /** Which layer produced the result (for debugging + source-specific attribution) */
  source: 'static-map' | 'steam-search' | 'rawg' | 'igdb' | 'none';
  /** Ready-to-store attribution / legal credit string. ALWAYS present. */
  attribution: string;
  /** Heuristic confidence in the mapping (0–1). Static highest. */
  confidence: number;
  /** True if served from the in-memory cache */
  cached: boolean;
}

// ============================================
// INTERNAL HELPERS (resilience primitives)
// ============================================
function makeCacheKey(name: string, slug?: string): string {
  const base = slug || name;
  return base
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeout = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'RunDB-Agent5-PublicResolver/1.0 (+https://github.com/example/rundb)',
        ...(init?.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Simple retry for transient (5xx / 429 / network)
async function resilientFetch(url: string, init?: RequestInit, retries = 1): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchWithTimeout(url, init);
      if (r.status === 429 || r.status >= 500) {
        if (attempt < retries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
      }
      return r;
    } catch (err) {
      if (attempt < retries) {
        await sleep(250);
        continue;
      }
      console.warn('[resolver] fetch failed after retries', url, err instanceof Error ? err.message : err);
      return null;
    }
  }
  return null;
}

// ============================================
// STEAM-FIRST RESOLUTION LAYERS
// ============================================
function resolveStaticMap(name: string, slug?: string): Partial<ExternalIdResolution> | null {
  const key = makeCacheKey(name, slug);
  const direct = STEAM_APPID_MAP[key];
  if (direct) {
    return {
      steamAppId: direct,
      source: 'static-map',
      attribution: ATTRIBUTIONS['static-map'],
      confidence: 0.96,
    };
  }
  // Loose name fallback within map (helps slight slug variations in demo seeds)
  const lower = name.toLowerCase();
  for (const [mapKey, appId] of Object.entries(STEAM_APPID_MAP)) {
    const mapName = mapKey.replace(/-/g, ' ');
    if (lower === mapName || lower.includes(mapName) || mapName.includes(lower)) {
      return {
        steamAppId: appId,
        source: 'static-map',
        attribution: ATTRIBUTIONS['static-map'],
        confidence: 0.82,
      };
    }
  }
  return null;
}

async function tryStaticMap(name: string, slug?: string): Promise<Partial<ExternalIdResolution> | null> {
  return resolveStaticMap(name, slug);
}

/**
 * Sync static-map lookup only. Safe for client components (no network, no Server Actions).
 */
export function resolveGameExternalIdsSync(name: string, slug?: string): ExternalIdResolution {
  if (!name || typeof name !== 'string') {
    return {
      source: 'none',
      attribution: ATTRIBUTIONS.none,
      confidence: 0,
      cached: false,
    };
  }

  const partial = resolveStaticMap(name, slug);
  return {
    steamAppId: partial?.steamAppId,
    igdbId: partial?.igdbId,
    rawgId: partial?.rawgId,
    source: partial?.source || 'none',
    attribution: partial?.attribution || ATTRIBUTIONS.none,
    confidence: partial?.confidence ?? 0,
    cached: false,
  };
}

async function trySteamPublicSearch(name: string): Promise<Partial<ExternalIdResolution> | null> {
  const now = Date.now();
  const wait = STEAM_RATE_MS - (now - lastSteamCallTs);
  if (wait > 0) await sleep(wait);
  lastSteamCallTs = Date.now();

  try {
    const term = encodeURIComponent(name);
    const url = `https://store.steampowered.com/api/storesearch/?term=${term}&cc=US&l=english&limit=5`;
    const res = await resilientFetch(url);
    if (!res || !res.ok) return null;

    const json: unknown = await res.json().catch(() => ({}));
    const jsonObj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const rawItems = jsonObj.items;
    const items: Array<{ id?: unknown; name?: unknown }> = Array.isArray(rawItems) ? (rawItems as Array<{ id?: unknown; name?: unknown }>) : [];

    if (!items.length) return null;

    // Prefer exact name match, else first result (Steam ranks relevance well)
    const lower = name.toLowerCase().trim();
    let chosen: { id?: unknown; name?: unknown } = items[0];
    for (const it of items) {
      if (typeof it.name === 'string' && it.name.toLowerCase().trim() === lower) {
        chosen = it;
        break;
      }
    }
    if (chosen?.id != null) {
      return {
        steamAppId: String(chosen.id),
        source: 'steam-search',
        attribution: ATTRIBUTIONS['steam-search'],
        confidence: 0.88,
      };
    }
  } catch (err) {
    console.warn('[resolver] Steam public search transient failure (resilient, continuing to next fallback):', err instanceof Error ? err.message : err);
  }
  return null;
}

async function tryRAWG(name: string): Promise<Partial<ExternalIdResolution> | null> {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) return null;

  try {
    const term = encodeURIComponent(name);
    const url = `https://api.rawg.io/api/games?key=${apiKey}&search=${term}&page_size=1`;
    const res = await resilientFetch(url);
    if (!res || !res.ok) return null;

    const json: unknown = await res.json().catch(() => ({}));
    const jsonObj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const results = jsonObj.results as Array<{ id?: unknown }> | undefined;
    const game = results?.[0];
    if (game?.id != null) {
      // RAWG search response does not reliably embed Steam AppID (would need /games/{id} + stores).
      // We still record the RAWG id for future enrichment / linking.
      return {
        rawgId: Number(game.id),
        source: 'rawg',
        attribution: ATTRIBUTIONS.rawg,
        confidence: 0.65,
      };
    }
  } catch (err) {
    console.warn('[resolver] RAWG fallback transient failure:', err instanceof Error ? err.message : err);
  }
  return null;
}

// Lightweight IGDB path (replicates minimal token + search from ingest script for self-containment)
async function getIgdbToken(): Promise<string | null> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const secret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !secret) return null;

  const now = Date.now();
  if (igdbToken && now < igdbTokenExpiry) return igdbToken;

  try {
    const tokenUrl = `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${secret}&grant_type=client_credentials`;
    const res = await resilientFetch(tokenUrl);
    if (!res || !res.ok) return null;
    const data: unknown = await res.json();
    const tokenData = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    igdbToken = (tokenData.access_token as string) || null;
    igdbTokenExpiry = now + (((tokenData.expires_in as number) || 3600) - 60) * 1000;
    return igdbToken;
  } catch {
    return null;
  }
}

async function tryIGDB(name: string): Promise<Partial<ExternalIdResolution> | null> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const secret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !secret) return null;

  const token = await getIgdbToken();
  if (!token) return null;

  try {
    const body = `search "${name.replace(/["\\]/g, '')}"; fields id,name,external_games.category,external_games.uid; limit 1;`;
    const res = await fetchWithTimeout('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    });

    if (!res.ok) return null;
    const games: unknown[] = await res.json().catch(() => []);
    const g = (games?.[0] && typeof games[0] === 'object' ? games[0] : {}) as Record<string, unknown>;
    if (!g || !g.id) return null;

    let steamAppId: string | undefined;
    const igdbId: string | undefined = g.id != null ? String(g.id) : undefined;

    // external_games may be present if we requested properly; category 1 === Steam per IGDB docs
    const externalsRaw = g.external_games;
    const externals: Array<Record<string, unknown>> = Array.isArray(externalsRaw) ? (externalsRaw as Array<Record<string, unknown>>) : [];
    for (const ex of externals) {
      if (ex?.category === 1 && ex?.uid) {
        steamAppId = String(ex.uid);
        break;
      }
    }

    return {
      steamAppId,
      igdbId,
      source: 'igdb',
      attribution: ATTRIBUTIONS.igdb,
      confidence: steamAppId ? 0.92 : 0.75,
    };
  } catch (err) {
    console.warn('[resolver] IGDB fallback transient failure (resilient):', err instanceof Error ? err.message : err);
  }
  return null;
}

// ============================================
// PUBLIC RESOLVER API (the contract Agent 5 exposes)
// ============================================

/**
 * Resolve external IDs for a game (Steam AppID prioritized).
 * Order: in-memory cache → static Steam map → Steam public search → RAWG (if keyed) → IGDB (if creds).
 * Returns attribution ready for DB storage or UI.
 * 100% resilient: never rejects, worst case returns { source: 'none', attribution: ATTRIBUTIONS.none, ... }
 */
export async function resolveGameExternalIds(
  name: string,
  slug?: string
): Promise<ExternalIdResolution> {
  if (!name || typeof name !== 'string') {
    return {
      source: 'none',
      attribution: ATTRIBUTIONS.none,
      confidence: 0,
      cached: false,
    };
  }

  const cacheKey = makeCacheKey(name, slug);
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.resolution, cached: true };
  }

  // Layer 1: Static Steam map (fast path)
  let partial = await tryStaticMap(name, slug);

  // Layer 2: Public Steam search (no key, always attempted if static missed)
  if (!partial?.steamAppId) {
    partial = await trySteamPublicSearch(name);
  }

  // Layer 3: RAWG
  if (!partial?.steamAppId && !partial?.rawgId) {
    const rawg = await tryRAWG(name);
    if (rawg) {
      partial = { ...partial, ...rawg };
    }
  }

  // Layer 4: IGDB (can also yield steamAppId via external_games)
  if (!partial?.steamAppId) {
    const ig = await tryIGDB(name);
    if (ig) {
      partial = { ...partial, ...ig };
    }
  }

  const resolution: ExternalIdResolution = {
    steamAppId: partial?.steamAppId,
    igdbId: partial?.igdbId,
    rawgId: partial?.rawgId,
    source: partial?.source || 'none',
    attribution: partial?.attribution || ATTRIBUTIONS.none,
    confidence: partial?.confidence ?? 0,
    cached: false,
  };

  // Normalize final source label
  if (!resolution.source) resolution.source = 'none';

  CACHE.set(cacheKey, { resolution, timestamp: Date.now() });
  return resolution;
}

/**
 * Convenience: just the Steam AppID (or undefined).
 * Preferred for most callers doing Steam-first enrichment.
 */
export async function resolveSteamAppId(name: string, slug?: string): Promise<string | undefined> {
  const r = await resolveGameExternalIds(name, slug);
  return r.steamAppId;
}

/**
 * Batch resolver for demo seeds / bulk import / admin seeding.
 * Returns map of slug -> resolution. Perfect for enriching imported rows before write.
 * Stops on first error per item (resilient per game).
 */
export async function resolveManyGameExternalIds(
  games: Array<{ name: string; slug?: string }>
): Promise<Record<string, ExternalIdResolution>> {
  const out: Record<string, ExternalIdResolution> = {};
  // Sequential with small delay to stay under public API courtesy limits across services
  for (const g of games) {
    if (!g.name) continue;
    const key = g.slug || makeCacheKey(g.name);
    out[key] = await resolveGameExternalIds(g.name, g.slug);
    // tiny courtesy pause between batch items
    await sleep(60);
  }
  return out;
}

/**
 * Helper to enrich a plain Game-like object (or seed row) in place with resolved fields + attribution note.
 * Does NOT mutate original if you pass a copy; returns new augmented object.
 * Intended for use in demo seed pipelines and future runtime enrichment.
 */
export async function enrichGameWithExternalIds<T extends Partial<Game> & { name: string; slug?: string }>(
  game: T
): Promise<T & { steamAppId?: string; igdbId?: string; externalIdAttribution?: string }> {
  const res = await resolveGameExternalIds(game.name, game.slug);
  return {
    ...game,
    steamAppId: res.steamAppId,
    igdbId: res.igdbId,
    externalIdAttribution: res.attribution,
  };
}

// Clear cache (useful in tests / admin "force refresh" tools)
export function clearResolverCache() {
  CACHE.clear();
  igdbToken = null;
  igdbTokenExpiry = 0;
  console.log('[resolver] cache cleared');
}

// Expose for introspection / admin UI
export function getResolverStats() {
  return {
    cacheSize: CACHE.size,
    cachedKeys: Array.from(CACHE.keys()),
    hasRawgKey: !!process.env.RAWG_API_KEY,
    hasIgdbCreds: !!(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET),
    staticMapSize: Object.keys(STEAM_APPID_MAP).length,
  };
}
