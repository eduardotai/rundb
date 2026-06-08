/**
 * RunDB Data Layer Adapter
 *
 * This file is the single source of truth for all data access.
 * Public data access is real-data-first. Fixture data is available only behind
 * an explicit development-only opt-in for local UI work.
 *
 * All pages and components should eventually import from here
 * instead of directly from '@/lib/mock-data'.
 */

import * as mock from './mock-data'
import type {
  Game,
  Report,
  UserPC,
  GameStats,
  ReportFilters,
  PredictionResult,
  SubmitReportInput,
  ReportStatus,
  GraphicsPreset,
  PerformanceTier,
  HardwareAlias,
  BulkImportResult,
  GamesPageResult,
  CredibilityBadge,
} from './types'

// Hardware catalog live mapper (for Phase 6+ large 2015+ DB-backed catalog)
import {
  dbRowToHardwareCatalogEntry,
  mergeDbRowsIntoStatic,
} from './hardware-catalog-mapper'
import type { HardwareCatalogEntry } from './types'

// React Query hooks (Phase 3 migration). useQuery only — no react state primitives needed here anymore.
import { useQuery } from '@tanstack/react-query'

// Agent 2 / PR 2: Public cover resolver + enrichment (Steam/IGDB/RAWG direct + game_media)
import * as coverResolver from './game-cover-resolver'
import { getCatalogCover } from './game-cover-catalog'
import { upgradeCoverImageSrc } from './cover-image-url'
import { cleanPublicReportNotes } from './report-notes'
import type { MatchFilters, RigMatch } from './similarity'
import { rankAndFilterMatches } from './similarity'
import { rankTrendingGameIds, type TrendingRankRow } from './trending'

export const ALLOW_MOCK_DATA =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA === 'true'
export const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA !== 'false' || !ALLOW_MOCK_DATA

const EMPTY_GAME_STATS: GameStats = {
  totalReports: 0,
  tierDistribution: {
    Excellent: 0,
    Good: 0,
    Playable: 0,
    Struggling: 0,
    Unplayable: 0,
  },
  avgFpsByResolution: {},
  mostCommonPreset: null,
  avgFpsOverall: 0,
}

function unavailablePrediction(): PredictionResult {
  return {
    predictedTier: 'Unplayable',
    confidence: 0,
    matchingReports: [],
    explanation: 'Not enough public reports are available for this game yet.',
    recommendedSettings: 'Submit a report to help build the community dataset.',
  }
}

function publicStarterGames(): Game[] {
  return enrichGamesWithCoversSync(mock.getAllGames())
}

function getStarterGamesPage(params: Required<Pick<GetGamesPageParams, 'page' | 'pageSize' | 'sort'>> & Pick<GetGamesPageParams, 'search' | 'genre'>): GamesPageResult {
  let games = mock.getAllGames()
  const search = params.search?.trim()
  const genre = params.genre?.trim()

  if (search) {
    const q = search.toLowerCase()
    games = games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.developer.toLowerCase().includes(q) ||
        g.slug.includes(q)
    )
  }
  if (genre) games = games.filter((g) => g.genres.includes(genre))
  if (params.sort === 'name') games.sort((a, b) => a.name.localeCompare(b.name))
  else if (params.sort === 'year') games.sort((a, b) => b.releaseYear - a.releaseYear)

  const total = games.length
  const start = (params.page - 1) * params.pageSize
  const slice = games.slice(start, start + params.pageSize)

  return {
    games: enrichGamesWithCoversSync(slice),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  }
}

function searchStarterGames(query: string, limit: number): Game[] {
  const q = query.trim().toLowerCase()
  const games = q
    ? mock.getAllGames().filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.slug.includes(q) ||
          g.developer.toLowerCase().includes(q)
      )
    : mock.getAllGames()

  return enrichGamesWithCoversSync(games.slice(0, limit))
}

async function withSupabaseReadTimeout<T>(
  operation: PromiseLike<T>,
  label: string,
  timeoutMs = 3500
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      console.warn(`[data] ${label} timed out; using starter catalog/fallback data.`)
      resolve(null)
    }, timeoutMs)
  })

  try {
    return await Promise.race([Promise.resolve(operation), timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** True when public Supabase env vars are present (real network client, not the no-op stub). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

// Convenience: tells UI/components whether the hardware catalog is coming from live DB
export const HARDWARE_CATALOG_LIVE = USE_REAL;

// ============================================
// DB <-> TYPE MAPPERS (snake_case Postgres -> camelCase app types)
// Master Plan aligned. Used by real-data paths for getGameBySlug / getReportsForGame etc.
// ============================================

function mapDbGameToGame(row: any): Game {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // Agent 2: picsum fallback here is only last-resort; enrichment layer (resolver + game_media)
    // overrides it for both real and !USE_REAL paths below.
    coverImage: row.cover_url || 'https://picsum.photos/id/1015/300/400',
    coverAttribution: row.cover_attribution || row.attribution,
    genres: row.genres || [],
    releaseYear: row.release_year || 2020,
    developer: row.developer || 'Unknown',
    publisher: row.publisher,
    officialMinReqs: row.official_min_reqs,
    officialRecReqs: row.official_rec_reqs,
    // Agent 5 / PR 5: external IDs via cached resolver (populated at ingest or runtime enrichment)
    steamAppId: row.steam_app_id || undefined,
    igdbId: row.igdb_id || undefined,
    externalIdAttribution: row.external_id_attribution || undefined,
    ingestStatus: row.ingest_status || undefined,
  }
}

function mapDbReportToReport(row: any): Report {
  return {
    id: row.id,
    gameId: row.game_id,
    gameName: row.game_name,
    cpu: row.cpu,
    gpu: row.gpu,
    ram: row.ram,
    ramSpeed: row.ram_speed,
    resolution: row.resolution,
    refreshRate: row.refresh_rate,
    settingsPreset: row.settings_preset as GraphicsPreset,
    customSettingsNotes: row.custom_settings_notes,
    avgFps: Number(row.avg_fps),
    fps1PercentLow: row.fps_1_percent_low != null ? Number(row.fps_1_percent_low) : undefined,
    performanceTier: row.performance_tier as PerformanceTier,
    notes: cleanPublicReportNotes(row.notes),
    tweaks: row.tweaks,
    issues: row.issues,
    driverVersion: row.driver_version,
    createdAt: row.created_at,
    helpfulVotes: row.helpful_votes ?? 0,
    downvoteVotes: row.downvote_votes ?? 0,
    voteScore: row.vote_score ?? row.helpful_votes ?? 0,
    credibilityScore: row.credibility_score,
    credibilityBadge: row.credibility_badge,
    canonicalCpu: row.canonical_cpu,
    canonicalGpu: row.canonical_gpu,
    gpuPerfIndex: row.gpu_perf_index != null ? Number(row.gpu_perf_index) : undefined,
    cpuPerfIndex: row.cpu_perf_index != null ? Number(row.cpu_perf_index) : undefined,
    // Phase 2 moderation fields (populated when RLS allows, e.g. for admins)
    status: row.status as ReportStatus | undefined,
    userId: row.user_id,
    moderatedBy: row.moderated_by,
    moderatedAt: row.moderated_at,
    moderatorNotes: row.moderator_notes,
  }
}

// ============================================
// AGENT 2 / PR 2: GAME MEDIA + COVER ENRICHMENT LAYER
// ============================================

/**
 * Fetch game_media rows for a game (covers, screenshots, artworks etc).
 * - When USE_REAL: queries public RLS policy on game_media (no key needed for SELECT).
 * - When !USE_REAL or error: returns [] (enrichment will use resolver instead).
 * Used by enrich + future UI galleries.
 */
export async function getGameMedia(gameId: string): Promise<any[]> {
  if (!USE_REAL || !gameId) return []
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const { data, error } = await supabase
      .from('game_media')
      .select('*')
      .eq('game_id', gameId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.warn('[data] getGameMedia Supabase error (falling back to resolver):', error.message)
      return []
    }
    return data || []
  } catch (err: any) {
    console.warn('[data] getGameMedia unexpected error:', err?.message || err)
    return []
  }
}

/**
 * Batched variant of getGameMedia: fetch media rows for many games in a single
 * query (chunked to keep the `in(...)` list reasonable). Returns a Map keyed by
 * game_id. This replaces the previous one-query-per-game pattern in
 * enrichGamesWithCovers, which fired N parallel Supabase requests per grid and
 * saturated the browser connection pool (the main site-wide lag source).
 */
export async function getGameMediaForGames(gameIds: string[]): Promise<Map<string, any[]>> {
  const byGame = new Map<string, any[]>()
  if (!USE_REAL || gameIds.length === 0) return byGame

  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const CHUNK = 200
    for (let i = 0; i < gameIds.length; i += CHUNK) {
      const slice = gameIds.slice(i, i + CHUNK)
      const { data, error } = await supabase
        .from('game_media')
        .select('*')
        .in('game_id', slice)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        console.warn('[data] getGameMediaForGames Supabase error (skipping media enrichment):', error.message)
        continue
      }
      for (const row of data || []) {
        const arr = byGame.get(row.game_id)
        if (arr) arr.push(row)
        else byGame.set(row.game_id, [row])
      }
    }
  } catch (err: any) {
    console.warn('[data] getGameMediaForGames unexpected error:', err?.message || err)
  }
  return byGame
}

/** Sync variant (warns in real mode; for legacy compat only). */
export function getGameMediaSync(_gameId: string): any[] {
  if (USE_REAL) {
    console.warn('[data] getGameMediaSync using empty (real mode — use async getGameMedia + RQ)')
  }
  return []
}

/**
 * Enrich an array of (already mapped) games with real covers.
 * Sync catalog/resolver first; optional async game_media only for unknown imports.
 * Never calls Server Actions — safe from client components (e.g. /games React Query).
 */
export async function enrichGamesWithCovers(games: Game[]): Promise<Game[]> {
  if (!games?.length) return games

  const base = enrichGamesWithCoversSync(games)

  if (!USE_REAL) return base

  // Sync enrichment already resolves the great majority of covers (static catalog,
  // DB cover_url, and the Steam/IGDB resolver). Only games still left with a weak
  // placeholder need the game_media table consulted — and we do that in ONE batched
  // query rather than one request per game (previously an N+1 that hammered Supabase
  // and stalled the whole UI on large grids).
  const needsMedia = base.filter(
    (g) =>
      g.id &&
      !getCatalogCover(g.slug) &&
      (!g.coverImage || g.coverImage.includes('picsum.photos'))
  )

  if (needsMedia.length === 0) return base

  const mediaByGame = await getGameMediaForGames(needsMedia.map((g) => g.id))
  if (mediaByGame.size === 0) return base

  return base.map((g) => {
    const rows = mediaByGame.get(g.id)
    if (!rows?.length) return g
    const coverRow = rows.find((m: any) => m.media_type === 'cover' && m.url)
    if (coverRow?.url) {
      return {
        ...g,
        coverImage: upgradeCoverImageSrc(coverRow.url, g.steamAppId),
        coverAttribution: coverRow.attribution || g.coverAttribution,
      }
    }
    return g
  })
}

/**
 * Cover resolution safe for client + server.
 * Client uses sync static catalog (no Server Actions — avoids HMR / deployment ID mismatches).
 * Server may use async resolver for unknown titles (RAWG/IGDB network fallbacks).
 */
async function resolveCoverForGameClientSafe(game: { slug: string; name?: string }) {
  if (typeof window !== 'undefined') {
    return coverResolver.resolveCoverForGameSync(game)
  }
  const { resolveCoverForGame } = await import('@/lib/game-cover-resolver')
  return resolveCoverForGame(game)
}

/** External ID resolution safe for client + server (static map only on client). */
async function resolveGameExternalIdsClientSafe(name: string, slug?: string) {
  if (typeof window !== 'undefined') {
    const { resolveGameExternalIdsSync } = await import('@/lib/game-id-resolver')
    return resolveGameExternalIdsSync(name, slug)
  }
  const { resolveGameExternalIds } = await import('@/lib/game-id-resolver')
  return resolveGameExternalIds(name, slug)
}

async function resolveSteamAppIdClientSafe(name: string, slug?: string) {
  if (typeof window !== 'undefined') {
    const { resolveGameExternalIdsSync } = await import('@/lib/game-id-resolver')
    return resolveGameExternalIdsSync(name, slug).steamAppId
  }
  const { resolveSteamAppId } = await import('@/lib/game-id-resolver')
  return resolveSteamAppId(name, slug)
}

/** Sync enrich (for getGameBySlug + getAllGamesSync legacy paths). Uses catalog + static resolver map. */
export function enrichGamesWithCoversSync(games: Game[]): Game[] {
  if (!games?.length) return games
  return games.map((g) => {
    const catalog = getCatalogCover(g.slug)
    if (catalog) {
      return {
        ...g,
        coverImage: upgradeCoverImageSrc(catalog.url, catalog.steamAppId || g.steamAppId),
        coverAttribution: catalog.attribution || g.coverAttribution,
        steamAppId: catalog.steamAppId || g.steamAppId,
      }
    }
    if (g.coverImage && !g.coverImage.includes('picsum.photos')) {
      return {
        ...g,
        coverImage: upgradeCoverImageSrc(g.coverImage, g.steamAppId),
      }
    }
    const resolved = coverResolver.resolveCoverForGameSync({ slug: g.slug, name: g.name })
    return {
      ...g,
      coverImage: upgradeCoverImageSrc(resolved.url, g.steamAppId),
      coverAttribution: resolved.attribution || g.coverAttribution,
    }
  })
}

// ============================================
// GAMES
// ============================================

export async function getAllGames(): Promise<Game[]> {
  if (USE_REAL) {
    if (!isSupabaseConfigured()) {
      console.warn('[data] Supabase is not configured. Using the public starter game catalog so reports can still be submitted.')
      return publicStarterGames()
    }

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const result = await withSupabaseReadTimeout<any>(
      supabase
        .from('games')
        .select('*')
        .order('name', { ascending: true }),
      'getAllGames'
    )

    if (!result) return publicStarterGames()

    const { data, error } = result

    if (error) {
      console.error('[data] Failed to fetch games from Supabase:', error)
      return publicStarterGames()
    }

    const rows = data || []
    if (rows.length === 0) {
      console.warn('[data] Supabase games table is empty. Using the public starter game catalog until the ingest pipeline is populated.')
      return publicStarterGames()
    }

    const mapped = rows.map(mapDbGameToGame)
    return enrichGamesWithCovers(mapped)
  }
  return publicStarterGames()
}

export interface GetGamesPageParams {
  page?: number
  pageSize?: number
  search?: string
  genre?: string
  sort?: 'name' | 'year'
}

/** Paginated games browse — use when catalog exceeds ~500 rows (real Supabase mode). */
export async function getGamesPage(params: GetGamesPageParams = {}): Promise<GamesPageResult> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 48))
  const search = params.search?.trim() ?? ''
  const genre = params.genre?.trim() ?? ''
  const sort = params.sort ?? 'name'

  if (!USE_REAL || !isSupabaseConfigured()) {
    return getStarterGamesPage({ page, pageSize, search, genre, sort })
  }

  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()

  let query = supabase.from('games').select('*', { count: 'exact' })

  if (search) query = query.ilike('name', `%${search}%`)
  if (genre) query = query.contains('genres', [genre])

  if (sort === 'name') query = query.order('name', { ascending: true })
  else if (sort === 'year') query = query.order('release_year', { ascending: false, nullsFirst: false })
  else query = query.order('name', { ascending: true })

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const result = await withSupabaseReadTimeout<any>(query.range(from, to), 'getGamesPage')

  if (!result) {
    return getStarterGamesPage({ page, pageSize, search, genre, sort })
  }

  const { data, error, count } = result

  if (error) {
    console.error('[data] getGamesPage error:', error)
    return getStarterGamesPage({ page, pageSize, search, genre, sort })
  }

  const total = count ?? 0
  const mapped = (data || []).map(mapDbGameToGame)
  const enriched = await enrichGamesWithCovers(mapped)

  return {
    games: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/** Debounced game search for submit picker (real mode scales to 10k+). */
export async function searchGames(query: string, limit = 25): Promise<Game[]> {
  const q = query.trim()
  if (!q) {
    if (USE_REAL && isSupabaseConfigured()) {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const result = await withSupabaseReadTimeout<any>(
        supabase
          .from('games')
          .select('*')
          .order('name', { ascending: true })
          .limit(limit),
        'searchGames'
      )
      if (!result) return []
      const { data, error } = result
      if (error) {
        console.error('[data] searchGames initial load error:', error)
        return []
      }
      if (data?.length) return enrichGamesWithCovers(data.map(mapDbGameToGame))
      return []
    }
    return searchStarterGames('', limit)
  }

  if (USE_REAL && isSupabaseConfigured()) {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const result = await withSupabaseReadTimeout<any>(
      supabase
        .from('games')
        .select('*')
        .ilike('name', `%${q}%`)
        .order('name', { ascending: true })
        .limit(limit),
      'searchGames'
    )

    if (!result) return searchStarterGames(q, limit)

    const { data, error } = result

    if (error) {
      console.error('[data] searchGames error:', error)
      return searchStarterGames(q, limit)
    }
    return enrichGamesWithCovers((data || []).map(mapDbGameToGame))
  }

  return searchStarterGames(q, limit)
}

/** Rank distinct genres by how many games carry them (most common first, then A–Z). */
function rankGenres(all: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const raw of all) {
    const name = (raw || '').trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name)
}

/**
 * Distinct genres actually present in the browsable catalog — drives the /games
 * genre filter chips.
 *
 * The chips must reflect the genres games are really tagged with (IGDB names like
 * "Role-playing (RPG)" / "Shooter" in real mode), not a hardcoded wishlist. A
 * static label such as "FPS" that no row carries silently filters to zero results.
 * Real mode samples the genres column and aggregates distinct values client-side
 * (cheap: only the array column is transferred, and the handful of distinct genres
 * saturate well within the sample). Falls back to mock genres when not in real
 * mode or on error. Ordered most-common-first so the most useful filters lead.
 */
export async function getAvailableGenresAsync(limit = 40): Promise<string[]> {
  if (USE_REAL && isSupabaseConfigured()) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('games')
        .select('genres')
        .not('genres', 'is', null)
        .limit(2000)

      if (error) {
        console.warn('[data] getAvailableGenresAsync error:', error.message)
      } else if (data) {
        const ranked = rankGenres(data.flatMap((row: any) => row.genres || []), limit)
        if (ranked.length) return ranked
      }
    } catch (err: any) {
      console.warn('[data] getAvailableGenresAsync unexpected error:', err?.message || err)
    }
  }

  return rankGenres(mock.getAllGames().flatMap((g) => g.genres || []), limit)
}

// Keep synchronous version for components that haven't migrated yet (will be removed)
export function getAllGamesSync(): Game[] {
  return publicStarterGames()
}

export function getGameBySlug(slug: string): Game | undefined {
  const game = mock.getGameBySlug(slug)
  if (!game) return undefined
  const [enriched] = enrichGamesWithCoversSync([game])
  return enriched
}

/**
 * Async real-data version of getGameBySlug.
 * When NEXT_PUBLIC_USE_REAL_DATA=true: queries Supabase games table (public RLS),
 * maps snake_case columns to camelCase Game type.
 * On error or missing keys: falls back to mock (production-safe, never breaks UI).
 * When flag false: resolves to mock (no DB hit).
 * Aligns with approved Master Plan for gradual real-data migration.
 */
export async function getGameBySlugAsync(slug: string): Promise<Game | undefined> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('slug', slug)
        .single()

      if (error) {
        // PGRST116 = no rows (PostgREST). Return undefined (game genuinely not in real DB).
        if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
          return undefined
        }
        console.error('[data] getGameBySlugAsync Supabase error:', error)
        return getGameBySlug(slug)
      }

      if (!data) return undefined
      const mapped = mapDbGameToGame(data)
      const [enriched] = await enrichGamesWithCovers([mapped]) // media + resolver
      return enriched
    } catch (err: any) {
      console.error('[data] getGameBySlugAsync unexpected error:', err)
      return getGameBySlug(slug)
    }
  }
  return Promise.resolve(getGameBySlug(slug))
}

// ============================================
// REPORTS
// ============================================

/**
 * Safety cap for per-game report fetches.
 *
 * Popular titles in the real (ProtonDB-seeded) dataset have thousands of reports
 * (e.g. Cyberpunk ~2.6k). The compatibility tab predicts across several games at
 * once, and the game detail page renders the list — without a cap the browser
 * materializes tens of thousands of report objects and OOMs. The newest N reports
 * are more than enough for similarity scoring and for the list UI; exact totals
 * still come from the dedicated stats aggregation (computeGameStatsAsync).
 */
export const REPORTS_FETCH_HARD_CAP = 500

export function getAllReports(): Report[] {
  return ALLOW_MOCK_DATA ? mock.getAllReports() : []
}

export function getReportsForGame(gameId: string, filters?: ReportFilters): Report[] {
  return ALLOW_MOCK_DATA ? mock.getReportsForGame(gameId, filters) : []
}

/**
 * Async real-data version of getReportsForGame.
 * When NEXT_PUBLIC_USE_REAL_DATA=true: queries Supabase reports table.
 * RLS automatically restricts to approved reports for public/anon users (per schema policy).
 * Moderators/admins see more via their RLS policy.
 * Maps snake_case -> camelCase using mapDbReportToReport.
 * Applies client-side filters via the existing pure filterReports() for consistency with mock.
 * Always sorts newest-first (created_at desc).
 * Full error handling + fallback to mock on any failure (production-ready).
 */
export async function getReportsForGameAsync(
  gameId: string,
  filters?: ReportFilters,
  limit: number = REPORTS_FETCH_HARD_CAP
): Promise<Report[]> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        console.error('[data] getReportsForGameAsync Supabase error:', error)
        return getReportsForGame(gameId, filters)
      }

      let reports = (data || []).map(mapDbReportToReport)

      if (filters) {
        reports = filterReports(reports, filters)
      }

      // Ensure consistent newest-first order after client filtering
      reports.sort((a: Report, b: Report) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      reports = await enrichReportsWithReporters(reports)
      return reports
    } catch (err: any) {
      console.error('[data] getReportsForGameAsync unexpected error:', err)
      return getReportsForGame(gameId, filters)
    }
  }
  return Promise.resolve(getReportsForGame(gameId, filters))
}

export function filterReports(reports: Report[], filters: ReportFilters): Report[] {
  // This is a pure function — no need to switch, always use mock version
  return mock.filterReports(reports, filters)
}

/**
 * Enrich reports with public reporter profile info (username, avatar, their credibility badge).
 * Used so game-specific report pages and ReportCard can show "reported by X" + badges.
 * Requires the public profiles SELECT policy (added for this). Falls back silently.
 * Only runs in real mode; distinct userIds are batched to avoid N+1.
 */
async function enrichReportsWithReporters(reports: Report[]): Promise<Report[]> {
  if (!USE_REAL || !isSupabaseConfigured() || reports.length === 0) return reports
  const userIds = Array.from(new Set(reports.map((r) => r.userId).filter((id): id is string => Boolean(id))))
  if (userIds.length === 0) return reports
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: profs, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, credibility_badge')
      .in('id', userIds)
    if (error || !profs) {
      console.warn('[data] enrichReportsWithReporters: profiles fetch failed (policy or incremental?):', error?.message)
      return reports
    }
    const byId = new Map<string, any>((profs || []).map((p: any) => [p.id, p]))
    return reports.map((r) => {
      if (!r.userId) return r
      const p = byId.get(r.userId)
      if (!p) return r
      return {
        ...r,
        reporter: {
          id: p.id,
          username: p.username ?? null,
          avatarUrl: p.avatar_url ?? null,
          credibilityBadge: (p.credibility_badge as CredibilityBadge | undefined) ?? null,
        },
      }
    })
  } catch (err: any) {
    console.warn('[data] enrichReportsWithReporters unexpected error:', err?.message || err)
    return reports
  }
}

/**
 * Batched reports fetch for a set of games in a single query.
 *
 * Used by list surfaces (home trending, /games grid) to build per-game stats for
 * only the games actually on screen, instead of pulling a global 200-row sample
 * (wrong) or filtering an all-reports array per game (O(games × reports)).
 * One `in(game_id, …)` query, capped, grouped client-side in a single pass.
 */
export async function getReportsForGamesAsync(
  gameIds: string[],
  cap: number = 2000
): Promise<Map<string, Report[]>> {
  const byGame = new Map<string, Report[]>()
  const ids = gameIds.filter(Boolean)
  if (ids.length === 0) return byGame

  if (USE_REAL && isSupabaseConfigured()) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .in('game_id', ids)
        .order('created_at', { ascending: false })
        .limit(cap)

      if (error) {
        console.error('[data] getReportsForGamesAsync Supabase error:', error)
      } else {
        for (const row of data || []) {
          const r = mapDbReportToReport(row)
          const arr = byGame.get(r.gameId)
          if (arr) arr.push(r)
          else byGame.set(r.gameId, [r])
        }
        return byGame
      }
    } catch (err: any) {
      console.error('[data] getReportsForGamesAsync unexpected error:', err)
    }
  }

  if (!ALLOW_MOCK_DATA) return byGame

  const idSet = new Set(ids)
  for (const r of mock.getAllReports()) {
    if (!idSet.has(r.gameId)) continue
    const arr = byGame.get(r.gameId)
    if (arr) arr.push(r)
    else byGame.set(r.gameId, [r])
  }
  return byGame
}

export interface TrendingResult {
  /** Ordered, length <= limit, covers enriched. */
  games: Game[]
  /** gameId -> number of reports within the window. Fill games are absent (treat as 0). */
  recentCounts: Record<string, number>
}

/**
 * "Trending right now" for the home page.
 *
 * Ranks games by how many NEW reports they received in the last `windowDays`
 * days. When fewer than `limit` games have recent reports, the remaining slots
 * are filled with the all-time leaders from the newest-200 report sample (the
 * same sample the home page used before), so the row always renders `limit`
 * cards. Returns the ordered games plus a per-game recent count (the count is
 * currently unused by the UI but returned for a future "+N this week" badge).
 *
 * Uses lightweight two-column queries (game_id + created_at) for ranking, then a
 * single `in(id, ...)` fetch to hydrate the chosen rows — never pulls the whole
 * games table.
 */
export async function getTrendingGamesAsync(limit: number = 6, windowDays: number = 7): Promise<TrendingResult> {
  const safeLimit = Math.min(48, Math.max(1, limit))
  const safeDays = Math.min(365, Math.max(1, windowDays))
  const starterFallback = (): TrendingResult => ({
    games: publicStarterGames().slice(0, safeLimit),
    recentCounts: {},
  })

  if (!USE_REAL || !isSupabaseConfigured()) {
    return starterFallback()
  }

  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()

    // 1. Recent ranking rows (cheap: two columns).
    const recentResult = await withSupabaseReadTimeout<any>(
      supabase
        .from('reports')
        .select('game_id, created_at')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(5000),
      'getTrendingGamesAsync.recent',
    )
    if (!recentResult) return starterFallback()
    if (recentResult.error) {
      console.error('[data] getTrendingGamesAsync recent query error:', recentResult.error)
      return starterFallback()
    }
    const recentRows: TrendingRankRow[] = (recentResult.data || []).map((r: any) => ({
      gameId: r.game_id,
      createdAt: r.created_at,
    }))

    // 2. All-time top-up sample, only when recent activity is too thin to fill the row.
    const distinctRecent = new Set(recentRows.map((r) => r.gameId)).size
    let fallbackRows: TrendingRankRow[] = []
    if (distinctRecent < safeLimit) {
      const fallbackResult = await withSupabaseReadTimeout<any>(
        supabase
          .from('reports')
          .select('game_id, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        'getTrendingGamesAsync.fallback',
      )
      if (fallbackResult?.error) {
        console.warn('[data] getTrendingGamesAsync fallback query error (continuing without top-up):', fallbackResult.error)
      } else if (fallbackResult) {
        fallbackRows = (fallbackResult.data || []).map((r: any) => ({
          gameId: r.game_id,
          createdAt: r.created_at,
        }))
      }
    }

    const { ids, recentCounts } = rankTrendingGameIds(recentRows, fallbackRows, safeLimit)
    if (ids.length === 0) return starterFallback()

    // 3. Hydrate the chosen game rows in one query, then restore ranked order.
    const gamesResult = await withSupabaseReadTimeout<any>(
      supabase.from('games').select('*').in('id', ids),
      'getTrendingGamesAsync.games',
    )
    if (!gamesResult || gamesResult.error) {
      if (gamesResult?.error) console.error('[data] getTrendingGamesAsync games query error:', gamesResult.error)
      return starterFallback()
    }
    const mapped = (gamesResult.data || []).map(mapDbGameToGame)
    if (mapped.length === 0) return starterFallback()

    const enriched = await enrichGamesWithCovers(mapped)
    const byId = new Map<string, Game>(enriched.map((g) => [g.id, g]))
    const ordered = ids.map((id) => byId.get(id)).filter((g): g is Game => Boolean(g))

    return { games: ordered, recentCounts }
  } catch (err: any) {
    console.error('[data] getTrendingGamesAsync unexpected error:', err)
    return starterFallback()
  }
}

/**
 * Lightweight global counts for hero/stat headers — uses `head: true` count
 * queries so no row payloads are transferred (vs. fetching reports just to read
 * `.length`).
 */
export async function getGlobalCountsAsync(): Promise<{ totalGames: number; totalReports: number }> {
  if (USE_REAL && isSupabaseConfigured()) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const [gamesRes, reportsRes] = await Promise.all([
        supabase.from('games').select('id', { count: 'exact', head: true }),
        supabase.from('reports').select('id', { count: 'exact', head: true }),
      ])

      return {
        totalGames: gamesRes.count ?? 0,
        totalReports: reportsRes.count ?? 0,
      }
    } catch (err: any) {
      console.error('[data] getGlobalCountsAsync error:', err)
    }
  }

  if (!ALLOW_MOCK_DATA) {
    return { totalGames: 0, totalReports: 0 }
  }

  return {
    totalGames: mock.getAllGames().length,
    totalReports: mock.getAllReports().length,
  }
}

export function getFilteredGlobalReports(filters: {
  gameSlug?: string
  gpuSeries?: string
  minFps?: number
  tier?: import('./types').PerformanceTier
}): Report[] {
  return ALLOW_MOCK_DATA ? mock.getFilteredGlobalReports(filters) : []
}

/**
 * Async real-data version of getAllReports (basic reports read).
 * Queries Supabase reports (RLS: only approved for public).
 * Maps snake_case to camelCase via mapDbReportToReport.
 * Returns newest first, limited for safety.
 * Full fallback + error handling.
 */
export async function getAllReportsAsync(): Promise<Report[]> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      // Embed the parent game row (FK reports.game_id -> games.id) so consumers like the
      // "Will It Run?" match feed can render game banners/covers without depending on a
      // separately-loaded catalog snapshot (which misses un-ingested or just-added games).
      // Mirrors getFilteredGlobalReportsAsync.
      const { data, error } = await supabase
        .from('reports')
        .select('*, game:games(id, slug, name, cover_url, genres, release_year, developer, publisher, steam_app_id, igdb_id)')
        .order('created_at', { ascending: false })
        .limit(200) // safety for MVP

      if (error) {
        console.error('[data] getAllReportsAsync Supabase error:', error)
        return getAllReports()
      }

      const base = (data || []).map((row: any) => {
        const report = mapDbReportToReport(row)
        if (row.game) {
          report.game = enrichGamesWithCoversSync([mapDbGameToGame(row.game)])[0]
        }
        return report
      })
      return await enrichReportsWithReporters(base)
    } catch (err: any) {
      console.error('[data] getAllReportsAsync unexpected error:', err)
      return getAllReports()
    }
  }
  return Promise.resolve(getAllReports())
}

export async function getMatchesForRigAsync(
  rig: UserPC,
  filters: MatchFilters = {}
): Promise<RigMatch[]> {
  const reports = await getAllReportsAsync()
  return rankAndFilterMatches(reports, rig, filters)
}

/**
 * Async real-data version of getFilteredGlobalReports (basic reports read).
 * Fetches approved reports from Supabase, maps snake->camel.
 * For gameSlug filter: resolves slug -> game uuid first (extra query, cached in practice).
 * Applies remaining filters client-side via existing pure filterReports for consistency.
 * Adds more error handling + fallback.
 * Aligns with Master Plan for real reports reads when NEXT_PUBLIC_USE_REAL_DATA=true.
 */
export async function getFilteredGlobalReportsAsync(filters: {
  gameSlug?: string
  gpuSeries?: string
  minFps?: number
  tier?: import('./types').PerformanceTier
}): Promise<Report[]> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      let gameIdForFilter: string | null = null
      if (filters.gameSlug) {
        const { data: g } = await supabase
          .from('games')
          .select('id')
          .eq('slug', filters.gameSlug)
          .single()
        gameIdForFilter = (g as any)?.id || null
      }

      // Embed the parent game row so the "By game" view can render banners without a
      // separate full-catalog fetch (game:games(...) is the FK reports.game_id -> games.id).
      let q = supabase
        .from('reports')
        .select('*, game:games(id, slug, name, cover_url, genres, release_year, developer, publisher, steam_app_id, igdb_id)')
        .order('created_at', { ascending: false })
        .limit(300)

      if (gameIdForFilter) {
        q = q.eq('game_id', gameIdForFilter)
      }

      const { data, error } = await q

      if (error) {
        console.error('[data] getFilteredGlobalReportsAsync Supabase error:', error)
        return attachMockGames(getFilteredGlobalReports(filters))
      }

      let reports = (data || []).map((row: any) => {
        const report = mapDbReportToReport(row)
        if (row.game) {
          report.game = enrichGamesWithCoversSync([mapDbGameToGame(row.game)])[0]
        }
        return report
      })

      // Client-side apply the rest of filters (gpuSeries, minFps, tier) using pure helper
      if (filters) {
        reports = filterReports(reports, {
          // note: filterReports accepts partial; gameSlug already handled via id
          ...(filters as any),
        })
      }

      reports = await enrichReportsWithReporters(reports)
      return reports
    } catch (err: any) {
      console.error('[data] getFilteredGlobalReportsAsync unexpected error:', err)
      return attachMockGames(getFilteredGlobalReports(filters))
    }
  }
  return Promise.resolve(attachMockGames(getFilteredGlobalReports(filters)))
}

/**
 * Attach embedded game metadata to mock reports so the /reports "By game" view renders
 * banners identically in mock and real modes (mock catalog is in-memory — no overload).
 */
function attachMockGames(reports: Report[]): Report[] {
  if (!ALLOW_MOCK_DATA || reports.length === 0) return reports
  const byId = new Map<string, Game>()
  for (const g of enrichGamesWithCoversSync(mock.getAllGames())) byId.set(g.id, g)
  return reports.map((r) => (r.game ? r : { ...r, game: byId.get(r.gameId) }))
}

// ============================================
// STATS & PREDICTIONS
// ============================================

// Sync versions: ALWAYS use mock for full backward compatibility with existing
// sync call sites (game cards, lists, etc.). When USE_REAL=true these still
// delegate to mock + warn to encourage migration to *Async or RQ hooks.
// (Phase 3: real paths live in the async variants below.)

export function computeGameStats(gameId: string): GameStats {
  return ALLOW_MOCK_DATA ? mock.computeGameStats(gameId) : EMPTY_GAME_STATS
}

export function predictForUserRig(userPC: UserPC, gameId: string): PredictionResult {
  return ALLOW_MOCK_DATA ? mock.predictForUserRig(userPC, gameId) : unavailablePrediction()
}

export function getTrendingGames(limit = 6): Game[] {
  return publicStarterGames().slice(0, limit)
}

/**
 * Async real-data version of computeGameStats.
 * When NEXT_PUBLIC_USE_REAL_DATA=true: queries Supabase reports (RLS restricts to approved),
 * maps rows, then aggregates using the pure computeGameStatsFromReports (no dupe logic).
 * Falls back to mock on error (safe). When flag off: resolves mock.
 * Used by React Query in game detail page (Phase 3).
 */
export async function computeGameStatsAsync(gameId: string): Promise<GameStats> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('[data] computeGameStatsAsync Supabase error:', error)
        return computeGameStats(gameId)
      }

      const reports = (data || []).map(mapDbReportToReport)
      return mock.computeGameStatsFromReports(reports)
    } catch (err: any) {
      console.error('[data] computeGameStatsAsync unexpected error:', err)
      return computeGameStats(gameId)
    }
  }
  return Promise.resolve(computeGameStats(gameId))
}

/**
 * Async real-data version of predictForUserRig.
 * Fetches game reports via Supabase when flag true (RLS-approved only), then runs
 * pure similarity + tier logic via predictForUserRigFromReports.
 * Full fallback to mock. Enables future migration of CompatibilityChecker etc.
 */
export async function predictForUserRigAsync(
  userPC: UserPC,
  gameId: string,
  sampleLimit: number = REPORTS_FETCH_HARD_CAP
): Promise<PredictionResult> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
        .limit(sampleLimit)

      if (error) {
        console.error('[data] predictForUserRigAsync Supabase error:', error)
        return predictForUserRig(userPC, gameId)
      }

      const gameReports = (data || []).map(mapDbReportToReport)
      return mock.predictForUserRigFromReports(userPC, gameReports)
    } catch (err: any) {
      console.error('[data] predictForUserRigAsync unexpected error:', err)
      return predictForUserRig(userPC, gameId)
    }
  }
  return Promise.resolve(predictForUserRig(userPC, gameId))
}

// ============================================
// USER REPORTS — Phase 2: real submission path via Server Action + RPC-ready
// Master Plan: submission always goes through here. When NEXT_PUBLIC_USE_REAL_DATA=true
// we use app/actions/reports.ts (submitReportAction) which enforces schema (pending status,
// server-side performance_tier calc, moderation fields) + anti-abuse (rate limit + dup detect).
// Upvoting uses report_votes + trigger.
// ============================================

export async function addUserReport(
  report: SubmitReportInput | Parameters<typeof mock.addUserReport>[0]
): Promise<Report> {
  if (USE_REAL && isSupabaseConfigured()) {
    // Dynamic import keeps server-only code out of client bundles
    const { submitReportAction } = await import('@/app/actions/reports')
    // Normalize to SubmitReportInput shape (mock path had performanceTier; real ignores it)
    const normalized: SubmitReportInput = {
      gameId: (report as any).gameId,
      cpu: (report as any).cpu,
      gpu: (report as any).gpu,
      ram: (report as any).ram,
      resolution: (report as any).resolution,
      refreshRate: (report as any).refreshRate,
      settingsPreset: (report as any).settingsPreset,
      avgFps: (report as any).avgFps,
      fps1PercentLow: (report as any).fps1PercentLow,
      notes: (report as any).notes,
      tweaks: (report as any).tweaks,
      issues: (report as any).issues,
      driverVersion: (report as any).driverVersion,
      ramSpeed: (report as any).ramSpeed,
      customSettingsNotes: (report as any).customSettingsNotes,
      kernel: (report as any).kernel,
      distro: (report as any).distro,
      canonicalCpu: (report as any).canonicalCpu,
      canonicalGpu: (report as any).canonicalGpu,
    }
    return submitReportAction(normalized)
  }
  if (USE_REAL) {
    console.warn('[data] Supabase is not configured; report submit is unavailable.')
  }
  if (!ALLOW_MOCK_DATA) {
    throw new Error('Report submission requires a configured Supabase backend.')
  }
  // Mock path remains synchronous in behavior for demo continuity (data adapter returns Promise for consistency)
  const result = mock.addUserReport(report as any)
  return Promise.resolve(result)
}

export function loadUserReports() {
  return ALLOW_MOCK_DATA ? mock.loadUserReports() : []
}

export async function voteReport(reportId: string, value: 1 | -1 | 0): Promise<void> {
  if (USE_REAL && isSupabaseConfigured()) {
    const { voteReportAction } = await import('@/app/actions/reports')
    return voteReportAction(reportId, value)
  }
  if (USE_REAL) {
    console.warn('[data] USE_REAL=true but Supabase not configured; report voting is unavailable.')
  }
  throw new Error('You must sign in to vote on reports.')
}

export async function upvoteReport(reportId: string): Promise<void> {
  return voteReport(reportId, 1)
}

export async function downvoteReport(reportId: string): Promise<void> {
  return voteReport(reportId, -1)
}

// ============================================
// MY RIG — Phase 2: DB persistence (user_rigs + profiles tables)
// Master Plan aligned: dedicated user_rigs for compatibility checker rig.
// When logged in (incl. anonymous users via auth.uid) + USE_REAL=true:
//   - loadMyRigAsync: prefers user_rigs, falls back to profiles.main_* fields
//   - saveMyRigAsync: upserts user_rigs (and mirrors to profiles for consistency with ProfileRigEditor)
//   - clearMyRigAsync: removes from user_rigs
// Guests / !USE_REAL: fallback to localStorage (mock) exactly as before.
// Sync wrappers kept for backward compat (warn when real; prefer *Async in new code).
// Similarity scoring + predictions continue to work via existing predictForUserRigAsync etc.
// ============================================

export function loadMyRig(): UserPC | null {
  if (USE_REAL) {
    console.warn('[data] loadMyRig using MOCK/localStorage (real mode — use loadMyRigAsync for profiles/user_rigs per Phase 2 plan)')
  }
  return mock.loadMyRig()
}

export function saveMyRig(rig: UserPC) {
  if (USE_REAL) {
    console.warn('[data] saveMyRig using MOCK/localStorage (real mode — use saveMyRigAsync for profiles/user_rigs per Phase 2 plan)')
  }
  mock.saveMyRig(rig)
}

export function clearMyRig() {
  if (USE_REAL) {
    console.warn('[data] clearMyRig using MOCK/localStorage (real mode — use clearMyRigAsync for profiles/user_rigs per Phase 2 plan)')
  }
  mock.clearMyRig()
}

function mapUserRigRowToUserPC(row: any): UserPC | null {
  if (!row?.cpu || !row?.gpu) return null
  return {
    cpu: row.cpu,
    gpu: row.gpu,
    ram: row.ram,
    resolution: row.resolution || undefined,
    driverVersion: row.driver_version || undefined,
    kernel: row.kernel || undefined,
    distro: row.distro || undefined,
  } as UserPC
}

async function loadPrimaryUserRigRow(supabase: any, userId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('user_rigs')
    .select('id, cpu, gpu, ram, resolution, driver_version, kernel, distro, is_primary, updated_at')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[data] loadPrimaryUserRigRow failed:', error.message)
    return null
  }

  return data ?? null
}

/**
 * Phase 2 real-data async loader for My Rig (UserPC).
 * If authenticated user + USE_REAL: queries user_rigs (preferred, per schema "for compatibility checker"),
 * with fallback to profiles.main_* (as used by existing /profile editor). Maps to UserPC shape.
 * Guests (no auth) or non-real mode: delegates to localStorage mock.
 * Safe fallback on any error. Enables CompatibilityChecker etc. to persist to DB.
 */
export async function loadMyRigAsync(): Promise<UserPC | null> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        // Preferred: newest primary user_rigs row. limit(1) keeps multi-device rows from making maybeSingle() error.
        const rig = mapUserRigRowToUserPC(await loadPrimaryUserRigRow(supabase, user.id))
        if (rig) return rig

        // Fallback: profiles table (main_* fields, kept in sync with ProfileRigEditor)
        const { data: profile, error: profErr } = await supabase
          .from('profiles')
          .select('main_cpu, main_gpu, main_ram, preferred_resolution')
          .eq('id', user.id)
          .maybeSingle()

        if (!profErr && profile && (profile.main_cpu || profile.main_gpu)) {
          return {
            cpu: profile.main_cpu || '',
            gpu: profile.main_gpu || '',
            ram: profile.main_ram || 16,
            resolution: profile.preferred_resolution || undefined,
          }
        }
      }
      // No authenticated user, or no rig saved in DB yet → fall through to localStorage
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[data] loadMyRigAsync Supabase error, falling back to localStorage:', msg)
    }
  }
  return mock.loadMyRig()
}

/**
 * Phase 2 real-data async saver for My Rig.
 * If authenticated + USE_REAL: upserts into user_rigs (authoritative for checker),
 * and also mirrors fields to profiles (for profile page consistency).
 * Guests / non-real: localStorage only.
 */
export async function saveMyRigAsync(rig: UserPC): Promise<void> {
  if (USE_REAL) {
    let authenticatedUserId: string | null = null
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        authenticatedUserId = user.id
        const payload = {
          user_id: user.id,
          label: 'My Rig',
          cpu: rig.cpu,
          gpu: rig.gpu,
          ram: rig.ram,
          resolution: rig.resolution || null,
          driver_version: (rig as any).driverVersion || null,
          kernel: (rig as any).kernel || null,
          distro: (rig as any).distro || null,
          is_primary: true,
        }

        // Update the current primary row when present; insert otherwise. This works with both
        // legacy UNIQUE(user_id) installs and multi-device installs where that constraint is removed.
        const existingRig = await loadPrimaryUserRigRow(supabase, user.id)
        const { error: rigErr } = existingRig?.id
          ? await supabase.from('user_rigs').update(payload).eq('id', existingRig.id).eq('user_id', user.id)
          : await supabase.from('user_rigs').insert(payload)
        if (rigErr) {
          throw new Error(`Failed to save rig: ${rigErr.message}`)
        }

        // Mirror to profiles for compatibility with existing ProfileRigEditor + profile display
        const { error: profErr } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            main_cpu: rig.cpu,
            main_gpu: rig.gpu,
            main_ram: rig.ram,
            preferred_resolution: rig.resolution || null,
          })

        if (profErr) {
          console.warn('[data] saveMyRigAsync profiles mirror failed:', profErr.message)
        }

        return // DB path succeeded; do not touch localStorage for authenticated users
      }
      // No user: fall through to localStorage below
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (authenticatedUserId) {
        console.error('[data] saveMyRigAsync Supabase save failed:', msg)
        throw err instanceof Error ? err : new Error(msg)
      }
      console.warn('[data] saveMyRigAsync Supabase error, falling back to localStorage save:', msg)
    }
  }
  mock.saveMyRig(rig)
}

/**
 * Phase 2 real-data async clearer for My Rig.
 * If authenticated + USE_REAL: deletes from user_rigs (profiles main_* left as-is or could be nulled; we leave for profile editor control).
 * Guests / non-real: localStorage clear.
 */
export async function clearMyRigAsync(): Promise<void> {
  if (USE_REAL) {
    let authenticatedUserId: string | null = null
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        authenticatedUserId = user.id
        const { error } = await supabase
          .from('user_rigs')
          .delete()
          .eq('user_id', user.id)

        if (error) {
          throw new Error(`Failed to clear rig: ${error.message}`)
        }
        return // DB cleared for user; do not clear localStorage for auth users
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (authenticatedUserId) {
        console.error('[data] clearMyRigAsync Supabase clear failed:', msg)
        throw err instanceof Error ? err : new Error(msg)
      }
      console.warn('[data] clearMyRigAsync Supabase error, falling back to localStorage clear:', msg)
    }
  }
  mock.clearMyRig()
}

// ============================================
// PHASE 2: Multi-Device ("My Devices") support
// These functions enable ProtonDB-style multiple named rigs per user.
// loadUserDevices / saveUserDevice are additive and do not break existing loadMyRigAsync.
// For backward compat, loadMyRigAsync continues to return the primary (or most recent) rig.
// ============================================

export interface UserDeviceInput {
  label: string;
  cpu: string;
  gpu: string;
  ram: number;
  resolution?: string;
  isPrimary?: boolean;
  driverVersion?: string;
  kernel?: string;
  distro?: string;
}

export async function loadUserDevices(): Promise<import('./types').UserDevice[]> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user?.id) {
        const { data, error } = await supabase
          .from('user_rigs')
          .select('id, label, cpu, gpu, ram, resolution, driver_version, kernel, distro, is_primary, updated_at')
          .eq('user_id', user.id)
          .order('is_primary', { ascending: false })
          .order('updated_at', { ascending: false })

        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            label: row.label || 'Unnamed Rig',
            cpu: row.cpu,
            gpu: row.gpu,
            ram: row.ram,
            resolution: row.resolution || undefined,
            isPrimary: row.is_primary || false,
            driverVersion: row.driver_version || undefined,
            kernel: row.kernel || undefined,
            distro: row.distro || undefined,
            updatedAt: row.updated_at,
          }))
        }
      }
    } catch (err) {
      console.warn('[data] loadUserDevices error, falling back to empty list', err)
    }
  }
  return ALLOW_MOCK_DATA ? mock.loadUserDevices?.() || [] : []
}

export async function saveUserDevice(device: UserDeviceInput & { id?: string }): Promise<void> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.id) {
        console.warn('[data] saveUserDevice: no authenticated user')
        return
      }

      const payload: any = {
        user_id: user.id,
        label: device.label || 'My Rig',
        cpu: device.cpu,
        gpu: device.gpu,
        ram: device.ram,
        resolution: device.resolution || null,
        driver_version: device.driverVersion || null,
        kernel: device.kernel || null,
        distro: device.distro || null,
        is_primary: device.isPrimary || false,
      }

      if (device.id) {
        const { error } = await supabase.from('user_rigs').update(payload).eq('id', device.id)
        if (error) throw new Error(`Failed to update device: ${error.message}`)
      } else {
        const { error } = await supabase.from('user_rigs').insert(payload)
        if (error) throw new Error(`Failed to save device: ${error.message}`)
      }
      return
    } catch (err) {
      if (err instanceof Error) throw err
      console.warn('[data] saveUserDevice Supabase error', err)
    }
  }
  if (ALLOW_MOCK_DATA) mock.saveUserDevice?.(device as any)
}

export async function deleteUserDevice(id: string): Promise<void> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error } = await supabase.from('user_rigs').delete().eq('id', id)
      if (error) throw new Error(`Failed to delete device: ${error.message}`)
      return
    } catch (err) {
      if (err instanceof Error) throw err
      console.warn('[data] deleteUserDevice error', err)
    }
  }
  if (ALLOW_MOCK_DATA) mock.deleteUserDevice?.(id)
}

// ============================================
// STEAM LINKING (Plan 2) — "Verified Gamer" + persistent device association
// Does NOT auto-detect hardware (Steam API provides zero CPU/GPU/RAM).
// Primary benefit: easy persistent rigs/devices, badges, future library signals.
// Callers must still provide actual hardware via paste / detect / JSON one-liner
// (see loadUserDevices + saveUserDevice + the Steam System Information parser).
// ============================================

export interface SteamLinkStatus {
  linked: boolean;
  steamId?: string;
  persona?: string;
  avatarUrl?: string;
  linkedAt?: string;
}

export async function getLinkedSteamProfile(): Promise<SteamLinkStatus | null> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return { linked: false };

      const { data: link } = await supabase
        .from('linked_accounts')
        .select('provider_user_id, provider_data, created_at')
        .eq('user_id', user.id)
        .eq('provider', 'steam')
        .maybeSingle();

      if (link) {
        const pdata = (link.provider_data as any) || {};
        return {
          linked: true,
          steamId: link.provider_user_id,
          persona: pdata.personaname || pdata.persona_name,
          avatarUrl: pdata.avatar_url || pdata.avatarfull,
          linkedAt: link.created_at,
        };
      }
    } catch (e) {
      console.warn('[data] getLinkedSteamProfile error', e);
    }
  }
  // Mock support
  if (ALLOW_MOCK_DATA) {
    const mockLink = (await import('./mock-data')).loadSteamLink?.();
    return mockLink || { linked: false };
  }
  return { linked: false };
}

export async function linkSteamAccount(steamId: string, profileData: any = {}): Promise<boolean> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return false;

      const { error } = await supabase.from('linked_accounts').upsert({
        user_id: user.id,
        provider: 'steam',
        provider_user_id: steamId,
        provider_data: profileData,
      }, { onConflict: 'user_id,provider' });

      if (error) {
        console.warn('[data] linkSteamAccount upsert error', error.message);
        return false;
      }

      // Denorm for fast UI (persona, avatar)
      await supabase.from('profiles').upsert({
        id: user.id,
        steam_id: steamId,
        steam_persona: profileData.personaname || profileData.persona_name || null,
        steam_avatar_url: profileData.avatar_url || profileData.avatarfull || null,
        steam_linked_at: new Date().toISOString(),
      });

      return true;
    } catch (e) {
      console.warn('[data] linkSteamAccount error', e);
      return false;
    }
  }
  if (ALLOW_MOCK_DATA) {
    (await import('./mock-data')).saveSteamLink?.({ steamId, ...profileData });
    return true;
  }
  return false;
}

export async function unlinkSteamAccount(): Promise<boolean> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return false;

      const { error } = await supabase
        .from('linked_accounts')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'steam');

      if (error) {
        console.warn('[data] unlinkSteamAccount error', error.message);
        return false;
      }

      // Clear denorms
      await supabase.from('profiles').update({
        steam_id: null,
        steam_persona: null,
        steam_avatar_url: null,
        steam_linked_at: null,
      }).eq('id', user.id);

      return true;
    } catch (e) {
      console.warn('[data] unlinkSteamAccount error', e);
      return false;
    }
  }
  if (ALLOW_MOCK_DATA) {
    (await import('./mock-data')).clearSteamLink?.();
    return true;
  }
  return false;
}

// ============================================
// PHASE 4: ADMIN TOOLS (adapter for migration)
// ============================================

export function getAdminOverviewStats() {
  return ALLOW_MOCK_DATA ? mock.getAdminOverviewStats() : {
    totalReports: 0,
    pendingReports: 0,
    totalGames: 0,
    pendingImages: 0,
    hardwareAliases: 0,
    importedGames: 0,
  }
}

export function getModerationQueue(filterStatus?: ReportStatus | 'all') {
  return ALLOW_MOCK_DATA ? mock.getModerationQueue(filterStatus) : []
}

export function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  moderatorNotes?: string,
  moderatorName?: string
) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateReportStatus(reportId, status, moderatorNotes, moderatorName)
}

export function getHardwareAliases(search?: string) {
  return ALLOW_MOCK_DATA ? mock.getHardwareAliases(search) : []
}

export function addHardwareAlias(rawString: string, canonical: string, vendor?: string, series?: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.addHardwareAlias(rawString, canonical, vendor, series)
}

export function updateHardwareAlias(id: string, updates: Partial<Omit<HardwareAlias, 'id' | 'createdAt'>>) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateHardwareAlias(id, updates)
}

export function deleteHardwareAlias(id: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.deleteHardwareAlias(id)
}

export function getAllGamesForAdmin() {
  return publicStarterGames()
}

export function bulkImportGames(rows: any[]): BulkImportResult {
  if (!ALLOW_MOCK_DATA) {
    return {
      success: 0,
      errors: [{ row: 0, message: 'Mock bulk import is disabled for public deploy.' }],
      imported: [],
    }
  }
  return mock.bulkImportGames(rows)
}

export const parseCSV = mock.parseCSV

export function getReportImages(filterStatus?: 'pending' | 'approved' | 'rejected' | 'all') {
  return ALLOW_MOCK_DATA ? mock.getReportImages(filterStatus) : []
}

export function updateImageStatus(imageId: string, status: 'pending' | 'approved' | 'rejected') {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateImageStatus(imageId, status)
}

export function deleteReportImage(imageId: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.deleteReportImage(imageId)
}

// ============================================
// REACT QUERY HOOKS FOR COMPONENTS (Phase 3 Master Plan)
// 
// These are the preferred way to fetch data in client components going forward.
// They wrap the *Async adapters (which respect USE_REAL + safe mock fallbacks).
// 
// Benefits:
// - Centralized queryKeys (enables shared cache across pages/components, easy invalidation after submit/upvote)
// - Automatic loading/error states, background refetch, caching (staleTime 5min matches existing page patterns)
// - No more duplicated inline useQuery + get*Async calls in every page
// 
// Usage recommendation (after this migration):
//   import { useGames, useReportsForGame, useGameStats, usePrediction, useMyRig, useGame } from '@/lib/data'
// 
//   // In a page or component under a QueryClientProvider (all current RQ pages already are):
//   const { games, isLoading, error, refetch } = useGames();
//   const reportsQ = useReportsForGame(gameId, filters);
//   const statsQ = useGameStats(gameId);
//   const predQ = usePrediction(myRig, gameId);
//   const myRigQ = useMyRig();
//   const gameQ = useGame(slug); // Agent 2: single game + real enriched cover (detail pages)
// 
// Components/pages should prefer these over direct `useQuery({ queryFn: () => getAllGames() })` etc.
// This keeps the data layer as single source of truth (including future cache config or selectors).
// 
// All hooks are safe when !USE_REAL (instant mock resolution) or on Supabase errors (fallback).
// Query keys are designed to be compatible with existing inline useQuery keys in home/games/[slug]/etc. for gradual migration.
// ============================================

/**
 * React Query hook for fetching all games.
 * Uses getAllGames() under the hood (respects NEXT_PUBLIC_USE_REAL_DATA flag + mock fallback).
 * 
 * @returns {Object} with `games` (array, never null), plus standard RQ fields: isLoading, error, refetch, etc.
 * 
 * Backward compatible return shape for existing callers (e.g. /submit page).
 * Query key ['all-games'] shared with direct useQuery sites for cache reuse.
 */
export function useGames() {
  const query = useQuery<Game[]>({
    queryKey: ['all-games'],
    queryFn: () => getAllGames(),
    staleTime: 1000 * 60 * 5, // 5 minutes — matches Phase 3 page patterns
    gcTime: 1000 * 60 * 30,
  })

  return {
    games: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    refetch: query.refetch,
    // Full RQ result for advanced usage (isError, isFetching, data, etc.)
    query,
  }
}

/**
 * React Query hook for the distinct genres present in the browsable catalog.
 * Backs the /games genre filter chips so they always match real, filterable
 * genres (see getAvailableGenresAsync). Long staleTime — the genre set changes
 * only as the catalog grows.
 */
export function useAvailableGenres() {
  return useQuery<string[]>({
    queryKey: ['available-genres'],
    queryFn: () => getAvailableGenresAsync(),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  })
}

/**
 * React Query hook for reports for a specific game (with optional filters).
 * Uses getReportsForGameAsync() — real Supabase + RLS + filterReports (when flag true).
 * 
 * @param gameId - UUID of the game
 * @param filters - Optional ReportFilters (resolution, gpuSeries, etc.)
 * 
 * Query key includes gameId + filters for correct cache scoping and invalidation.
 * Use with useQueryClient().invalidateQueries({ queryKey: ['game-reports', gameId] }) after submit.
 */
export function useReportsForGame(gameId: string, filters?: ReportFilters) {
  return useQuery<Report[]>({
    queryKey: ['game-reports', gameId, filters ?? {}],
    queryFn: () => getReportsForGameAsync(gameId, filters),
    enabled: !!gameId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })
}

/**
 * React Query hook for community stats for a game.
 * Uses computeGameStatsAsync() (real aggregation over Supabase reports when flag true).
 * 
 * @param gameId - UUID of the game
 */
export function useGameStats(gameId: string) {
  return useQuery<GameStats>({
    queryKey: ['game-stats', gameId],
    queryFn: () => computeGameStatsAsync(gameId),
    enabled: !!gameId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })
}

/**
 * React Query hook for rig-based performance prediction for a game.
 * Uses predictForUserRigAsync() (real reports + pure similarity when flag true).
 * 
 * @param userPC - The user's hardware (from useMyRig or form)
 * @param gameId - Target game UUID
 * 
 * Query key incorporates userPC for correct per-rig caching.
 */
export function usePrediction(userPC: UserPC, gameId: string) {
  return useQuery<PredictionResult>({
    queryKey: ['prediction', gameId, userPC],
    queryFn: () => predictForUserRigAsync(userPC, gameId),
    enabled: !!gameId && !!userPC?.cpu && !!userPC?.gpu,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })
}

/**
 * React Query hook for the current user's saved rig (My Rig).
 * Uses loadMyRigAsync() — Phase 2 DB persistence (user_rigs + profiles fallback for logged-in users,
 * including anonymous; localStorage guest fallback only when !auth or !USE_REAL).
 * 
 * Components using this can reactively get the rig. For mutations (save/clear), continue using
 * saveMyRigAsync / clearMyRigAsync directly (or wrap in useMutation in future).
 * 
 * Auth state changes: callers may still listen to supabase auth and call queryClient.invalidateQueries(['my-rig'])
 * (or the hook will pick up on next mount/focus).
 */
export function useMyRig() {
  return useQuery<UserPC | null>({
    queryKey: ['my-rig'],
    queryFn: () => loadMyRigAsync(),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })
}

/**
 * React Query hook for a single game by slug (Agent 2 / PR 2).
 * Uses getGameBySlugAsync under the hood (real Supabase when flag true + full cover enrichment via
 * cover_url / game_media / public Steam/IGDB resolver).
 *
 * Preferred for game detail page and any single-game surfaces.
 * Shares cache semantics with useGames where possible.
 *
 * @returns { game, isLoading, error, refetch, query }
 */
export function useGame(slug: string) {
  const query = useQuery<Game | undefined>({
    queryKey: ['game', slug],
    queryFn: () => getGameBySlugAsync(slug),
    enabled: !!slug,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  })

  return {
    game: query.data ?? undefined,
    isLoading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    refetch: query.refetch,
    query,
  }
}

// Agent 5 / PR 5 + Agent 2: Public API Resilience Layer (unified)
// - game-id-resolver: Steam-first AppID + RAWG/IGDB fallbacks (IDs + attribution)
// - game-cover-resolver: High-quality banners (uses ID resolver for unknowns, heavy cache, rate limits)
// Single source for demo seeds + runtime enrichment. Attribution always stored.
//
// Client code importing from here gets sync-safe wrappers in the browser (no Server Actions).
// Server / seed scripts can import the raw async ones from game-id-resolver when network fallbacks are needed.
export {
  resolveCoverForGameClientSafe as resolveCoverForGame,
  resolveGameExternalIdsClientSafe as resolveGameExternalIds,
  resolveSteamAppIdClientSafe as resolveSteamAppId,
}

// Pure / batch helpers (re-exported for convenience; these do not include client guards)
export {
  resolveManyGameExternalIds,
  enrichGameWithExternalIds,
  clearResolverCache,
  getResolverStats,
  resolveGameExternalIdsSync,
  ATTRIBUTIONS,
  type ExternalIdResolution,
} from './game-id-resolver'

export { default as gameCoverResolver } from './game-cover-resolver'
export { isResolvedPublicCover } from './game-cover-resolver'
export type { ResolvedCover } from './game-cover-resolver'

// (Future: higher-level unified enricher combining IDs + covers + full external metadata.)

// ============================================
// HARDWARE IDENTIFICATION (Plan 4 Hybrid — now live)
// Pure client-only. Re-exported for convenience.
// ============================================
export {
  detectHardware,
  detectBrowser,
  parsePaste,
  applyHardwareAliases,
  getNormalizedRig,
} from './hardware-detector';

export type {
  DetectedHardware,
  DetectionMethod,
  DetectionMode,
} from './hardware-detector';

// ============================================
// HELPERS (pure, no data source change needed)
// ============================================

export const formatRelativeTime = mock.formatRelativeTime

// Hardware-aware similarity (new catalog-powered engine). The old name is aliased
// to the improved version for maximum quality with zero breaking changes.
export const calculateSimilarity = mock.calculateHardwareAwareSimilarity || mock.calculateSimilarity
export const calculateHardwareAwareSimilarity = mock.calculateHardwareAwareSimilarity || mock.calculateSimilarity

export const extractGpuSeries = mock.extractGpuSeries
export const getCpuTier = mock.getCpuTier

// Pure aggregation/prediction helpers (extracted for Phase 3 real-data list pages + GameCard stats derivation).
// Use with reports fetched via *Async adapters (e.g. getAllReportsAsync) to compute without N+1 calls or direct mock imports.
export const computeGameStatsFromReports = mock.computeGameStatsFromReports
export const predictForUserRigFromReports = mock.predictForUserRigFromReports

// ============================================
// HARDWARE CATALOG (Phase 6+ full database)
// Static fallback always available. Real DB used when USE_REAL=true.
// ============================================

export {
  getAllHardwareCatalog as getAllHardwareCatalogStatic,
  getHardwareEntry as getHardwareEntryStatic,
  findHardwareByQuery as findHardwareByQueryStatic,
  getPerfIndex as getPerfIndexStatic,
  getCatalogVersionInfo,
  HARDWARE_CATALOG_VERSION,
  getHardwareCatalogStats,
} from './hardware-catalog'

// Convenient non-Static aliases (used by hardware-combobox and other surfaces)
export { findHardwareByQuery, getHardwareEntry } from './hardware-catalog'

// Live (Supabase) catalog access — used when NEXT_PUBLIC_USE_REAL_DATA=true
// Now returns properly typed HardwareCatalogEntry[] (merged static + DB overrides)
export async function getAllHardwareCatalogAsync(): Promise<HardwareCatalogEntry[]> {
  const { getAllHardwareCatalog } = await import('./hardware-catalog')
  const staticEntries = getAllHardwareCatalog()

  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('hardware_catalog')
        .select('*')
        .order('perf_index', { ascending: false, nullsFirst: false })

      if (!error && data?.length) {
        // mergeDbRowsIntoStatic maps + merges (DB wins for same canonical)
        return mergeDbRowsIntoStatic(staticEntries, data)
      }
    } catch {
      console.warn('[data] hardware_catalog DB read failed, falling back to static')
    }
  }
  // Fallback / non-real: excellent static catalog (typed)
  return staticEntries
}

export async function getHardwareCatalogEntry(canonical: string): Promise<HardwareCatalogEntry | undefined> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data } = await supabase
        .from('hardware_catalog')
        .select('*')
        .eq('canonical', canonical)
        .single()

      if (data) {
        return dbRowToHardwareCatalogEntry(data)
      }
    } catch {}
  }
  const { getHardwareEntry } = await import('./hardware-catalog')
  return getHardwareEntry(canonical)
}

// Also expose a typed static getter for convenience
export async function getAllHardwareCatalogStaticTyped(): Promise<HardwareCatalogEntry[]> {
  const { getAllHardwareCatalog } = await import('./hardware-catalog')
  return getAllHardwareCatalog()
}

// Server-only hardware catalog: import from '@/lib/data-server' in Server Actions / RSC.
