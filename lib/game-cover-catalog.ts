/**
 * Canonical slug → cover / Steam AppID map derived from lib/starter-games.ts.
 * Single source of truth for banner resolution — prevents IGDB ingest mismatches
 * from overriding correct Steam library art at display time.
 */
import { GAMES } from './starter-games'
import { extractSteamAppIdFromUrl, steamLibraryCoverUrl, upgradeCoverImageSrc } from './cover-image-url'

export interface CatalogCover {
  url: string
  steamAppId?: string
  source: 'steam' | 'igdb'
  attribution: string
}

const STEAM_ATTRIBUTION =
  '© Valve Corporation. Steam CDN library art. Used for non-commercial informational purposes.'
const IGDB_ATTRIBUTION =
  'Sourced from IGDB.com. Images © their respective copyright holders. Used for non-commercial, informational purposes.'

function buildCatalog(): Record<string, CatalogCover> {
  const catalog: Record<string, CatalogCover> = {}

  for (const game of GAMES) {
    if (!game.coverImage || game.coverImage.includes('picsum.photos')) continue

    const fromUrl = extractSteamAppIdFromUrl(game.coverImage)
    const steamAppId = fromUrl || game.steamAppId || undefined
    const isSteam = Boolean(steamAppId)

    catalog[game.slug] = {
      url: upgradeCoverImageSrc(
        isSteam ? steamLibraryCoverUrl(steamAppId!, true) : game.coverImage
      ),
      steamAppId,
      source: isSteam ? 'steam' : 'igdb',
      attribution: isSteam ? STEAM_ATTRIBUTION : IGDB_ATTRIBUTION,
    }
  }

  return catalog
}

/** Slug → authoritative cover metadata for every seeded game with real art. */
export const GAME_COVER_CATALOG: Record<string, CatalogCover> = buildCatalog()

/** Slug → Steam AppID (string) for quick resolver lookups. */
export const SLUG_STEAM_APP_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(GAME_COVER_CATALOG)
    .filter(([, c]) => c.steamAppId)
    .map(([slug, c]) => [slug, c.steamAppId!])
)

export function getCatalogCover(slug: string): CatalogCover | null {
  return GAME_COVER_CATALOG[slug] ?? null
}

export function hasCatalogCover(slug: string): boolean {
  return slug in GAME_COVER_CATALOG
}
