/**
 * Pure planning for the catalog sync: Steam data + current catalog rows -> the exact
 * row patches and inserts to make. No I/O here, so the rules are unit-tested directly.
 *
 * Ownership rules (what the sync may change):
 * - cover_url: only when it is empty or a Steam CDN URL. Curated covers (Supabase Storage,
 *   IGDB) are never replaced. Steam URLs are replaced with Steam's authoritative
 *   content-hashed library capsule, so stale guessed paths (404s) get fixed.
 * - release_year, developer, publisher, genres: fill-only (never overwrite a value).
 * - name, slug, id, report_count, igdb_id, official requirements and anything report/user
 *   related: never touched.
 * - Rows sharing a steam_app_id with another row are skipped and reported for manual review.
 * - New games: Steam games released since `since`, visible, not coming soon, with at least
 *   `minReviews` reviews, whose app id is not in the catalog yet.
 */
import { normalizeSlug } from '../utils'
import { STEAM_STORE_ASSET_BASE } from '../cover-image-url'
import type { SteamStoreItem } from './steam'

export interface CatalogRow {
  id: string
  slug: string
  name: string
  cover_url: string | null
  steam_app_id: string | null
  release_year: number | null
  developer: string | null
  publisher: string | null
  genres: string[] | null
}

export interface SteamGameInfo {
  appid: string
  name: string
  coverUrl: string | null
  coverCandidates: string[]
  /** YYYY-MM-DD (UTC) or null when Steam has no date. */
  releaseDate: string | null
  releaseYear: number | null
  developer: string | null
  publisher: string | null
  isGame: boolean
  visible: boolean
  comingSoon: boolean
  reviewCount: number
}

export type GamePatch = Partial<Pick<CatalogRow, 'cover_url' | 'release_year' | 'developer' | 'publisher' | 'genres'>>

export interface RowUpdate {
  id: string
  slug: string
  steamAppId: string
  patch: GamePatch
  /** cover_url read before planning; the write only applies if it is still this value. */
  expectedCoverUrl: string | null
}

export interface NewGameRow {
  slug: string
  name: string
  cover_url: string | null
  steam_app_id: string
  release_year: number | null
  developer: string | null
  publisher: string | null
  genres: string[]
  ingest_status: 'skeleton'
}

export interface SyncPlan {
  updates: RowUpdate[]
  inserts: (NewGameRow & { releaseDate: string | null; reviewCount: number })[]
  stats: {
    catalogRows: number
    steamMatched: number
    coverFixes: number
    coverFixesFromEmpty: number
    fieldUpdates: Record<keyof GamePatch, number>
    rowsUpdated: number
    newGames: number
    newCandidatesSeen: number
  }
  skipped: {
    duplicateAppIds: { appid: string; slugs: string[] }[]
    notOnSteam: string[]
    noSteamAppId: string[]
  }
}

export interface PlanOptions {
  since: Date
  now: Date
  minReviews: number
  maxNew: number
  /** Genres for new games / backfill, keyed by app id (from appdetails). */
  genresByAppId?: Map<string, string[]>
}

/** Build the hashed asset URL; `?t=` cache-busters are dropped so unchanged art is a no-op. */
export function steamAssetUrl(format: string | undefined, file: string | undefined): string | null {
  if (!format || !file || !format.includes('${FILENAME}')) return null
  const path = format.replace('${FILENAME}', file).split('?')[0]
  if (!/^steam\/apps\/\d+\//.test(path)) return null
  return `${STEAM_STORE_ASSET_BASE}${path}`
}

/**
 * Cover URLs in preference order: portrait library capsule (600x900) first, the landscape
 * header only as a last resort. Steam occasionally lists an asset that is not on the CDN, so
 * the run verifies these in order (lib/catalog-sync/run.ts verifyCovers).
 */
export function steamCoverCandidates(item: SteamStoreItem): string[] {
  const a = item.assets
  if (!a) return []
  const files = [a.library_capsule_2x, a.library_capsule, a.header_2x, a.header]
  return [...new Set(files.map((f) => steamAssetUrl(a.asset_url_format, f)).filter((u): u is string => Boolean(u)))]
}

export function steamCoverUrl(item: SteamStoreItem): string | null {
  return steamCoverCandidates(item)[0] ?? null
}

function firstName(list?: { name?: string }[]): string | null {
  const n = list?.find((x) => x.name?.trim())?.name?.trim()
  return n || null
}

export function mapSteamItem(item: SteamStoreItem): SteamGameInfo | null {
  const appid = String(item.appid ?? item.id ?? '')
  if (!appid || item.success !== 1 || !item.name) return null
  const ts = item.release?.steam_release_date ?? item.release?.original_release_date
  const date = ts ? new Date(ts * 1000) : null
  return {
    appid,
    name: item.name.trim(),
    coverUrl: steamCoverUrl(item),
    coverCandidates: steamCoverCandidates(item),
    releaseDate: date ? date.toISOString().slice(0, 10) : null,
    releaseYear: date ? date.getUTCFullYear() : null,
    developer: firstName(item.basic_info?.developers),
    publisher: firstName(item.basic_info?.publishers),
    isGame: item.type === 0,
    visible: item.visible !== false,
    comingSoon: Boolean(item.release?.is_coming_soon),
    reviewCount: item.reviews?.summary_filtered?.review_count ?? 0,
  }
}

const STEAM_COVER_HOSTS = /(^https?:\/\/)?([a-z0-9.-]*steamstatic\.com|steamcdn-a\.akamaihd\.net)\//i

/** The sync owns a cover only when it is empty or points at the Steam CDN. */
export function isSyncManagedCover(url: string | null | undefined): boolean {
  return !url || !url.trim() || STEAM_COVER_HOSTS.test(url.trim())
}

const isBlank = (v: string | null | undefined) => !v || !v.trim() || v.trim() === 'Unknown'

export function planCatalogSync(
  rows: CatalogRow[],
  steam: Map<string, SteamGameInfo>,
  candidateAppIds: string[],
  opts: PlanOptions
): SyncPlan {
  const fieldUpdates: SyncPlan['stats']['fieldUpdates'] = {
    cover_url: 0,
    release_year: 0,
    developer: 0,
    publisher: 0,
    genres: 0,
  }
  const byAppId = new Map<string, CatalogRow[]>()
  const skipped: SyncPlan['skipped'] = { duplicateAppIds: [], notOnSteam: [], noSteamAppId: [] }
  for (const row of rows) {
    const id = row.steam_app_id?.trim()
    if (!id) {
      skipped.noSteamAppId.push(row.slug)
      continue
    }
    byAppId.set(id, [...(byAppId.get(id) ?? []), row])
  }

  const updates: RowUpdate[] = []
  let steamMatched = 0
  let coverFixesFromEmpty = 0
  for (const [appid, group] of byAppId) {
    if (group.length > 1) {
      skipped.duplicateAppIds.push({ appid, slugs: group.map((r) => r.slug).sort() })
      continue
    }
    const row = group[0]
    const info = steam.get(appid)
    if (!info || !info.visible) {
      skipped.notOnSteam.push(row.slug)
      continue
    }
    steamMatched++
    const patch: GamePatch = {}
    if (info.coverUrl && isSyncManagedCover(row.cover_url) && row.cover_url !== info.coverUrl) {
      patch.cover_url = info.coverUrl
      if (!row.cover_url?.trim()) coverFixesFromEmpty++
    }
    if (row.release_year == null && info.releaseYear && !info.comingSoon) patch.release_year = info.releaseYear
    if (isBlank(row.developer) && info.developer) patch.developer = info.developer
    if (isBlank(row.publisher) && info.publisher) patch.publisher = info.publisher
    const genres = opts.genresByAppId?.get(appid)
    if ((!row.genres || row.genres.length === 0) && genres?.length) patch.genres = genres
    const keys = Object.keys(patch) as (keyof GamePatch)[]
    if (keys.length === 0) continue
    for (const k of keys) fieldUpdates[k]++
    updates.push({ id: row.id, slug: row.slug, steamAppId: appid, patch, expectedCoverUrl: row.cover_url })
  }

  // New games.
  const takenSlugs = new Set(rows.map((r) => r.slug))
  const sinceIso = opts.since.toISOString().slice(0, 10)
  const nowIso = opts.now.toISOString().slice(0, 10)
  const fresh = [...new Set(candidateAppIds)]
    .filter((id) => !byAppId.has(id))
    .map((id) => steam.get(id))
    .filter((g): g is SteamGameInfo => Boolean(g))
    .filter(
      (g) =>
        g.isGame &&
        g.visible &&
        !g.comingSoon &&
        g.releaseDate != null &&
        g.releaseDate >= sinceIso &&
        g.releaseDate <= nowIso &&
        g.reviewCount >= opts.minReviews &&
        Boolean(g.coverUrl)
    )
    .sort((a, b) => b.reviewCount - a.reviewCount || a.appid.localeCompare(b.appid))
    .slice(0, opts.maxNew)

  const inserts: SyncPlan['inserts'] = []
  for (const g of fresh) {
    let slug = normalizeSlug(g.name) || `steam-${g.appid}`
    if (takenSlugs.has(slug)) slug = `${slug}-${g.appid}`
    if (takenSlugs.has(slug)) continue
    takenSlugs.add(slug)
    inserts.push({
      slug,
      name: g.name,
      cover_url: g.coverUrl,
      steam_app_id: g.appid,
      release_year: g.releaseYear,
      developer: g.developer,
      publisher: g.publisher,
      genres: opts.genresByAppId?.get(g.appid) ?? [],
      ingest_status: 'skeleton',
      releaseDate: g.releaseDate,
      reviewCount: g.reviewCount,
    })
  }

  return {
    updates,
    inserts,
    stats: {
      catalogRows: rows.length,
      steamMatched,
      coverFixes: fieldUpdates.cover_url,
      coverFixesFromEmpty,
      fieldUpdates,
      rowsUpdated: updates.length,
      newGames: inserts.length,
      newCandidatesSeen: candidateAppIds.length,
    },
    skipped,
  }
}

/** Strip planning-only fields before writing a new row. */
export function toInsertRow(row: SyncPlan['inserts'][number]): NewGameRow {
  const { releaseDate: _d, reviewCount: _r, ...rest } = row
  return rest
}
