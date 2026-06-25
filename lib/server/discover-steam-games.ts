/**
 * Discover the latest game releases from Steam's public charts.
 *
 * Source: https://store.steampowered.com/api/featuredcategories (no API key).
 * Produces a deduped SeedGame[] suitable for the existing ingestGame() pipeline.
 * Pure helpers (parseSteamReleaseYear, appDetailsToSeed) are network-free and unit-tested.
 */
// Relative import (not the @/ alias) so the module resolves under `tsx --test`.
import { normalizeSlug } from '../utils'

export interface SeedGame {
  name: string
  slug: string
  steamAppId: string
}

export interface DiscoverOptions {
  /** Minimum release year to include. Default: current year - 1. */
  sinceYear?: number
  /** Include coming_soon (unreleased) titles. Default: false. */
  includeUnreleased?: boolean
  /** Cap the number of returned seeds. */
  limit?: number
}

interface SteamAppDetailsResponse {
  success?: boolean
  data?: {
    type?: string
    name?: string
    steam_appid?: number
    release_date?: { coming_soon?: boolean; date?: string }
  }
}

interface TransformOptions {
  sinceYear: number
  includeUnreleased: boolean
}

/** Extract a 4-digit year (1900–2099) from a Steam release_date string. */
export function parseSteamReleaseYear(dateStr?: string): number | null {
  if (!dateStr) return null
  const m = dateStr.match(/(?:19|20)\d{2}/)
  return m ? Number(m[0]) : null
}

/** Pure transform: one appdetails response -> SeedGame, or null if it should be skipped. */
export function appDetailsToSeed(
  appId: string,
  res: SteamAppDetailsResponse | undefined,
  opts: TransformOptions
): SeedGame | null {
  if (!res || res.success !== true || !res.data) return null
  const d = res.data
  if (d.type !== 'game') return null

  const name = (d.name || '').trim()
  if (!name) return null

  const comingSoon = d.release_date?.coming_soon === true
  if (comingSoon) {
    if (!opts.includeUnreleased) return null
  } else {
    const year = parseSteamReleaseYear(d.release_date?.date)
    if (year == null || year < opts.sinceYear) return null
  }

  return { name, slug: normalizeSlug(name), steamAppId: appId }
}

/**
 * Pure dedup filter: given discovered + existing rows, return only those not present by slug or steam_app_id.
 * This lets callers produce "list of candidate new games" for direct integration (AC1).
 * Network-free; unit-testable.
 */
export function filterNewSeeds(
  discovered: SeedGame[],
  existing: Array<{ slug: string; steam_app_id?: string | null }>
): SeedGame[] {
  const slugs = new Set(existing.map((e) => e.slug))
  const appIds = new Set(
    existing.map((e) => e.steam_app_id).filter(Boolean).map(String)
  )
  return discovered.filter((s) => !slugs.has(s.slug) && !appIds.has(s.steamAppId))
}

// ============================================
// NETWORK LAYER (resilient — mirrors lib/game-id-resolver.ts patterns)
// ============================================
const STEAM_RATE_MS = 200
const FETCH_TIMEOUT_MS = 8000
const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=us&l=en'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url: string, retries = 1): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RunDB-LatestImporter/1.0 (+https://github.com/example/rundb)' },
      })
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(400 * (attempt + 1))
          continue
        }
        return null
      }
      if (!res.ok) return null
      return await res.json().catch(() => null)
    } catch (err) {
      if (attempt < retries) {
        await sleep(300)
        continue
      }
      console.warn('[discover] fetch failed:', url, err instanceof Error ? err.message : err)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * Discover recent game releases from Steam's new-releases + top-sellers charts.
 * Returns a slug-deduped SeedGame[]. Throws only if the featured endpoint is unreachable.
 */
export async function discoverLatestSteamGames(opts: DiscoverOptions = {}): Promise<SeedGame[]> {
  const sinceYear = opts.sinceYear ?? new Date().getFullYear() - 1
  const includeUnreleased = opts.includeUnreleased ?? false

  const featured = await fetchJson(FEATURED_URL)
  if (!featured) {
    throw new Error('Steam featuredcategories endpoint unreachable')
  }
  const featuredSections = featured as Record<string, { items?: Array<{ id?: unknown }> } | undefined>

  const sections = ['new_releases', 'top_sellers']
  if (includeUnreleased) sections.push('coming_soon')

  const appIds = new Set<string>()
  for (const key of sections) {
    const items = featuredSections[key]?.items
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it?.id != null) appIds.add(String(it.id))
      }
    }
  }

  const seeds: SeedGame[] = []
  const seenSlugs = new Set<string>()

  for (const appId of appIds) {
    if (opts.limit && seeds.length >= opts.limit) break
    await sleep(STEAM_RATE_MS)
    const detail = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
    )
    const res = (detail as Record<string, SteamAppDetailsResponse> | null)?.[appId]
    const seed = appDetailsToSeed(appId, res, { sinceYear, includeUnreleased })
    if (seed && !seenSlugs.has(seed.slug)) {
      seeds.push(seed)
      seenSlugs.add(seed.slug)
    }
  }

  return seeds
}
