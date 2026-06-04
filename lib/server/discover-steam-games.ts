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
