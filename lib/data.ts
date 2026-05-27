/**
 * RunDB Data Layer Adapter
 *
 * This file is the single source of truth for all data access.
 * It allows us to switch between mock data and real Supabase data
 * using the NEXT_PUBLIC_USE_REAL_DATA feature flag.
 *
 * During development and early rollout:
 * - Keep using mocks by default (safe, fast, no DB dependency)
 * - Flip the flag to gradually migrate to real data
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
  AdminReport,
  ReportImage,
  BulkImportResult,
  GamesPageResult,
} from './types'

// React Query hooks (Phase 3 migration). useQuery only — no react state primitives needed here anymore.
import { useQuery } from '@tanstack/react-query'

// Agent 2 / PR 2: Public cover resolver + enrichment (Steam/IGDB/RAWG direct + game_media)
import * as coverResolver from './game-cover-resolver'
import { getCatalogCover } from './game-cover-catalog'
import { upgradeCoverImageSrc } from './cover-image-url'

export const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'

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
    notes: row.notes,
    tweaks: row.tweaks,
    issues: row.issues,
    driverVersion: row.driver_version,
    createdAt: row.created_at,
    helpfulVotes: row.helpful_votes ?? 0,
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

/** Sync variant (warns in real mode; for legacy compat only). */
export function getGameMediaSync(gameId: string): any[] {
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

  return Promise.all(
    base.map(async (g) => {
      // Catalog covers are authoritative; skip ingested media for known slugs
      if (getCatalogCover(g.slug) || !g.id) return g

      try {
        const media = await getGameMedia(g.id)
        const coverRow = media.find((m: any) => m.media_type === 'cover' && m.url)
        if (coverRow?.url) {
          return {
            ...g,
            coverImage: upgradeCoverImageSrc(coverRow.url, g.steamAppId),
            coverAttribution: coverRow.attribution || g.coverAttribution,
          }
        }
      } catch {}

      return g
    })
  )
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
      console.warn(
        '[data] USE_REAL=true but Supabase is not configured — using mock games. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
      )
      return enrichGamesWithCoversSync(mock.getAllGames())
    }

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const { data, error } = await supabase
      .from('games')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      console.error('[data] Failed to fetch games from Supabase:', error)
      const fallback = mock.getAllGames()
      return enrichGamesWithCoversSync(fallback) // still get real banners via resolver even on DB error
    }

    const rows = data || []
    if (rows.length === 0) {
      console.warn(
        '[data] Supabase games table is empty. Run: npm run seed:games (or npm run ingest:games with IGDB credentials).'
      )
      if (process.env.NODE_ENV === 'development') {
        return enrichGamesWithCoversSync(mock.getAllGames())
      }
      return []
    }

    const mapped = rows.map(mapDbGameToGame)
    return enrichGamesWithCovers(mapped) // DB cover_url + game_media + public resolver
  }
  const mockGames = mock.getAllGames()
  return enrichGamesWithCoversSync(mockGames) // !USE_REAL: resolver supplies real public banners (no picsum)
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
    let games = mock.getAllGames()
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
    if (sort === 'name') games.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'year') games.sort((a, b) => b.releaseYear - a.releaseYear)

    const total = games.length
    const start = (page - 1) * pageSize
    const slice = games.slice(start, start + pageSize)
    return {
      games: enrichGamesWithCoversSync(slice),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
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
  const { data, error, count } = await query.range(from, to)

  if (error) {
    console.error('[data] getGamesPage error:', error)
    return { games: [], total: 0, page, pageSize, totalPages: 1 }
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
      const { data } = await supabase
        .from('games')
        .select('*')
        .order('name', { ascending: true })
        .limit(limit)
      if (data?.length) return enrichGamesWithCovers(data.map(mapDbGameToGame))
    }
    const all = mock.getAllGames().slice(0, limit)
    return enrichGamesWithCoversSync(all)
  }

  if (USE_REAL && isSupabaseConfigured()) {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .ilike('name', `%${q}%`)
      .order('name', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('[data] searchGames error:', error)
      return []
    }
    return enrichGamesWithCovers((data || []).map(mapDbGameToGame))
  }

  const lower = q.toLowerCase()
  const filtered = mock
    .getAllGames()
    .filter(
      (g) =>
        g.name.toLowerCase().includes(lower) ||
        g.slug.includes(lower) ||
        g.developer.toLowerCase().includes(lower)
    )
    .slice(0, limit)
  return enrichGamesWithCoversSync(filtered)
}

// Keep synchronous version for components that haven't migrated yet (will be removed)
export function getAllGamesSync(): Game[] {
  if (USE_REAL) {
    console.warn('[data] getAllGamesSync falling back to mock — use async getAllGames() instead')
  }
  const games = mock.getAllGames()
  return enrichGamesWithCoversSync(games) // Agent 2: real public covers even in sync legacy paths
}

export function getGameBySlug(slug: string): Game | undefined {
  // Kept for full backward compat (many call sites, admin, etc.).
  // Agent 2: now applies resolver enrichment so even sync callers get real banners (no picsum for seeded games).
  // Strongly prefer getGameBySlugAsync / useGame(slug) for new code (especially detail page).
  if (USE_REAL) {
    console.warn('[data] getGameBySlug using MOCK (real mode — prefer getGameBySlugAsync or useGame hook per plan; covers enriched via resolver)')
  }
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
        console.error('[data] getGameBySlugAsync Supabase error, falling back to mock:', error)
        return mock.getGameBySlug(slug)
      }

      if (!data) return undefined
      const mapped = mapDbGameToGame(data)
      const [enriched] = await enrichGamesWithCovers([mapped]) // media + resolver
      return enriched
    } catch (err: any) {
      console.error('[data] getGameBySlugAsync unexpected error, falling back to mock:', err)
      const fb = mock.getGameBySlug(slug)
      return fb ? enrichGamesWithCoversSync([fb])[0] : undefined
    }
  }
  const mockGame = mock.getGameBySlug(slug)
  return Promise.resolve(mockGame ? enrichGamesWithCoversSync([mockGame])[0] : undefined)
}

// ============================================
// REPORTS
// ============================================

export function getAllReports(): Report[] {
  if (USE_REAL) {
    console.warn('[data] getAllReports using MOCK (real mode not implemented yet — use getAllReportsAsync for Supabase + snake->camel mapping per plan)')
    return mock.getAllReports()
  }
  return mock.getAllReports()
}

export function getReportsForGame(gameId: string, filters?: ReportFilters): Report[] {
  if (USE_REAL) {
    console.warn('[data] getReportsForGame using MOCK (real mode not implemented yet — use getReportsForGameAsync for real Supabase data per Master Plan)')
    return mock.getReportsForGame(gameId, filters)
  }
  return mock.getReportsForGame(gameId, filters)
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
  filters?: ReportFilters
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

      if (error) {
        console.error('[data] getReportsForGameAsync Supabase error, falling back to mock:', error)
        return mock.getReportsForGame(gameId, filters)
      }

      let reports = (data || []).map(mapDbReportToReport)

      if (filters) {
        reports = filterReports(reports, filters)
      }

      // Ensure consistent newest-first order after client filtering
      reports.sort((a: Report, b: Report) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      return reports
    } catch (err: any) {
      console.error('[data] getReportsForGameAsync unexpected error, falling back to mock:', err)
      return mock.getReportsForGame(gameId, filters)
    }
  }
  return Promise.resolve(mock.getReportsForGame(gameId, filters))
}

export function filterReports(reports: Report[], filters: ReportFilters): Report[] {
  // This is a pure function — no need to switch, always use mock version
  return mock.filterReports(reports, filters)
}

export function getFilteredGlobalReports(filters: {
  gameSlug?: string
  gpuSeries?: string
  minFps?: number
  tier?: import('./types').PerformanceTier
}): Report[] {
  if (USE_REAL) {
    console.warn('[data] getFilteredGlobalReports using MOCK (real mode not implemented yet — use getFilteredGlobalReportsAsync)')
    return mock.getFilteredGlobalReports(filters)
  }
  return mock.getFilteredGlobalReports(filters)
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

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200) // safety for MVP

      if (error) {
        console.error('[data] getAllReportsAsync Supabase error, falling back to mock:', error)
        return mock.getAllReports()
      }

      return (data || []).map(mapDbReportToReport)
    } catch (err: any) {
      console.error('[data] getAllReportsAsync unexpected error, falling back to mock:', err)
      return mock.getAllReports()
    }
  }
  return Promise.resolve(mock.getAllReports())
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

      let q = supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)

      if (gameIdForFilter) {
        q = q.eq('game_id', gameIdForFilter)
      }

      const { data, error } = await q

      if (error) {
        console.error('[data] getFilteredGlobalReportsAsync Supabase error, falling back:', error)
        return mock.getFilteredGlobalReports(filters)
      }

      let reports = (data || []).map(mapDbReportToReport)

      // Client-side apply the rest of filters (gpuSeries, minFps, tier) using pure helper
      if (filters) {
        reports = filterReports(reports, {
          // note: filterReports accepts partial; gameSlug already handled via id
          ...(filters as any),
        })
      }

      return reports
    } catch (err: any) {
      console.error('[data] getFilteredGlobalReportsAsync unexpected error, falling back:', err)
      return mock.getFilteredGlobalReports(filters)
    }
  }
  return Promise.resolve(mock.getFilteredGlobalReports(filters))
}

// ============================================
// STATS & PREDICTIONS
// ============================================

// Sync versions: ALWAYS use mock for full backward compatibility with existing
// sync call sites (game cards, lists, etc.). When USE_REAL=true these still
// delegate to mock + warn to encourage migration to *Async or RQ hooks.
// (Phase 3: real paths live in the async variants below.)

export function computeGameStats(gameId: string): GameStats {
  if (USE_REAL) {
    console.warn('[data] computeGameStats using MOCK (real mode not implemented yet — use computeGameStatsAsync or useGameStats hook)')
    return mock.computeGameStats(gameId)
  }
  return mock.computeGameStats(gameId)
}

export function predictForUserRig(userPC: UserPC, gameId: string): PredictionResult {
  if (USE_REAL) {
    console.warn('[data] predictForUserRig using MOCK (real mode not implemented yet — use predictForUserRigAsync or usePrediction hook)')
    return mock.predictForUserRig(userPC, gameId)
  }
  return mock.predictForUserRig(userPC, gameId)
}

export function getTrendingGames(limit = 6): Game[] {
  if (USE_REAL) {
    console.warn('[data] getTrendingGames using MOCK (real mode not implemented yet)')
    return mock.getTrendingGames(limit)
  }
  return mock.getTrendingGames(limit)
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
        console.error('[data] computeGameStatsAsync Supabase error, falling back to mock:', error)
        return mock.computeGameStats(gameId)
      }

      const reports = (data || []).map(mapDbReportToReport)
      return mock.computeGameStatsFromReports(reports)
    } catch (err: any) {
      console.error('[data] computeGameStatsAsync unexpected error, falling back to mock:', err)
      return mock.computeGameStats(gameId)
    }
  }
  return Promise.resolve(mock.computeGameStats(gameId))
}

/**
 * Async real-data version of predictForUserRig.
 * Fetches game reports via Supabase when flag true (RLS-approved only), then runs
 * pure similarity + tier logic via predictForUserRigFromReports.
 * Full fallback to mock. Enables future migration of CompatibilityChecker etc.
 */
export async function predictForUserRigAsync(userPC: UserPC, gameId: string): Promise<PredictionResult> {
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
        console.error('[data] predictForUserRigAsync Supabase error, falling back to mock:', error)
        return mock.predictForUserRig(userPC, gameId)
      }

      const gameReports = (data || []).map(mapDbReportToReport)
      return mock.predictForUserRigFromReports(userPC, gameReports)
    } catch (err: any) {
      console.error('[data] predictForUserRigAsync unexpected error, falling back to mock:', err)
      return mock.predictForUserRig(userPC, gameId)
    }
  }
  return Promise.resolve(mock.predictForUserRig(userPC, gameId))
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
  if (USE_REAL) {
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
    }
    return submitReportAction(normalized)
  }
  // Mock path remains synchronous in behavior for demo continuity (data adapter returns Promise for consistency)
  const result = mock.addUserReport(report as any)
  return Promise.resolve(result)
}

export function loadUserReports() {
  return mock.loadUserReports()
}

/**
 * Phase 2 upvoting helper.
 * Real path: inserts to report_votes (unique + RLS + trigger maintains helpful_votes).
 * Mock: no-op (existing UI demo mutate in game page continues to work for seed data).
 */
export async function upvoteReport(reportId: string): Promise<void> {
  if (USE_REAL) {
    const { upvoteReportAction } = await import('@/app/actions/reports')
    return upvoteReportAction(reportId)
  }
  // Demo mode: caller (e.g. game detail) handles local optimistic bump
  return Promise.resolve()
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
        // Preferred: user_rigs table (current saved hardware for compatibility checker)
        const { data: rigRow, error: rigErr } = await supabase
          .from('user_rigs')
          .select('cpu, gpu, ram, resolution, driver_version, kernel, distro')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!rigErr && rigRow && rigRow.cpu && rigRow.gpu) {
          return {
            cpu: rigRow.cpu,
            gpu: rigRow.gpu,
            ram: rigRow.ram,
            resolution: rigRow.resolution || undefined,
            driverVersion: rigRow.driver_version || undefined,
            kernel: rigRow.kernel || undefined,
            distro: rigRow.distro || undefined,
          } as UserPC
        }

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
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        // Save to user_rigs (primary for CompatibilityChecker per schema)
        const { error: rigErr } = await supabase
          .from('user_rigs')
          .upsert({
            user_id: user.id,
            cpu: rig.cpu,
            gpu: rig.gpu,
            ram: rig.ram,
            resolution: rig.resolution || null,
            driver_version: (rig as any).driverVersion || null,
            kernel: (rig as any).kernel || null,
            distro: (rig as any).distro || null,
          }, { onConflict: 'user_id' })

        if (rigErr) {
          console.warn('[data] saveMyRigAsync user_rigs upsert failed (RLS or schema?):', rigErr.message)
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

        return // DB path succeeded (or warned); do not touch localStorage for authenticated users
      }
      // No user: fall through to localStorage below
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) {
        const { error } = await supabase
          .from('user_rigs')
          .delete()
          .eq('user_id', user.id)

        if (error) {
          console.warn('[data] clearMyRigAsync user_rigs delete failed:', error.message)
        }
        return // DB cleared for user; do not clear localStorage for auth users
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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
  // Mock path: return a couple of example devices for demo
  return mock.loadUserDevices?.() || []
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
        if (error) console.warn('[data] saveUserDevice update failed', error.message)
      } else {
        const { error } = await supabase.from('user_rigs').insert(payload)
        if (error) console.warn('[data] saveUserDevice insert failed', error.message)
      }
      return
    } catch (err) {
      console.warn('[data] saveUserDevice Supabase error', err)
    }
  }
  // Mock fallback (if mock supports it)
  mock.saveUserDevice?.(device as any)
}

export async function deleteUserDevice(id: string): Promise<void> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error } = await supabase.from('user_rigs').delete().eq('id', id)
      if (error) console.warn('[data] deleteUserDevice failed', error.message)
      return
    } catch (err) {
      console.warn('[data] deleteUserDevice error', err)
    }
  }
  mock.deleteUserDevice?.(id)
}

// ============================================
// PHASE 4: ADMIN TOOLS (adapter for migration)
// ============================================

export function getAdminOverviewStats() {
  return mock.getAdminOverviewStats()
}

export function getModerationQueue(filterStatus?: ReportStatus | 'all') {
  return mock.getModerationQueue(filterStatus)
}

export function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  moderatorNotes?: string,
  moderatorName?: string
) {
  return mock.updateReportStatus(reportId, status, moderatorNotes, moderatorName)
}

export function getHardwareAliases(search?: string) {
  return mock.getHardwareAliases(search)
}

export function addHardwareAlias(rawString: string, canonical: string, vendor?: string, series?: string) {
  return mock.addHardwareAlias(rawString, canonical, vendor, series)
}

export function updateHardwareAlias(id: string, updates: Partial<Omit<HardwareAlias, 'id' | 'createdAt'>>) {
  return mock.updateHardwareAlias(id, updates)
}

export function deleteHardwareAlias(id: string) {
  return mock.deleteHardwareAlias(id)
}

export function getAllGamesForAdmin() {
  // In future could be more privileged view
  return mock.getAllGames()
}

export function bulkImportGames(rows: any[]): BulkImportResult {
  return mock.bulkImportGames(rows)
}

export const parseCSV = mock.parseCSV

export function getReportImages(filterStatus?: 'pending' | 'approved' | 'rejected' | 'all') {
  return mock.getReportImages(filterStatus)
}

export function updateImageStatus(imageId: string, status: 'pending' | 'approved' | 'rejected') {
  return mock.updateImageStatus(imageId, status)
}

export function deleteReportImage(imageId: string) {
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
} from './hardware-catalog'

// Convenient non-Static aliases (used by hardware-combobox and other surfaces)
export { findHardwareByQuery, getHardwareEntry } from './hardware-catalog'

// Live (Supabase) catalog access — used when NEXT_PUBLIC_USE_REAL_DATA=true
export async function getAllHardwareCatalogAsync(): Promise<any[]> {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data, error } = await supabase
        .from('hardware_catalog')
        .select('*')
        .order('perf_index', { ascending: false, nullsFirst: false })

      if (!error && data?.length) return data
    } catch (e) {
      console.warn('[data] hardware_catalog DB read failed, falling back to static')
    }
  }
  // Fallback to excellent static catalog
  const { getAllHardwareCatalog } = await import('./hardware-catalog')
  return getAllHardwareCatalog()
}

export async function getHardwareCatalogEntry(canonical: string) {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const { data } = await supabase
        .from('hardware_catalog')
        .select('*')
        .eq('canonical', canonical)
        .single()

      if (data) return data
    } catch {}
  }
  const { getHardwareEntry } = await import('./hardware-catalog')
  return getHardwareEntry(canonical)
}

// Server-only hardware catalog: import from '@/lib/data-server' in Server Actions / RSC.
