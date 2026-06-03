/**
 * Lightweight IGDB search result validation — rejects obvious title mismatches
 * before wrong cover art is ingested into game_media.
 */

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type IgdbExternalGame = {
  uid?: unknown
  category?: unknown
  external_game_source?: unknown
}

type IgdbGameLike = {
  name?: unknown
  external_games?: IgdbExternalGame[] | null
}

const IGDB_EXTERNAL_GAME_STEAM = 1

function normalizeSteamAppId(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function isSteamExternalGame(entry: IgdbExternalGame): boolean {
  return (
    Number(entry.category) === IGDB_EXTERNAL_GAME_STEAM ||
    Number(entry.external_game_source) === IGDB_EXTERNAL_GAME_STEAM
  )
}

/** Token overlap ratio (0-1) for fuzzy title comparison. */
function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeTitle(a).split(' ').filter(Boolean))
  const tokensB = new Set(normalizeTitle(b).split(' ').filter(Boolean))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let shared = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) shared++
  }
  return shared / Math.max(tokensA.size, tokensB.size)
}

/**
 * Returns true when an IGDB result plausibly matches the seed game name.
 * Requires normalized substring match OR strong token overlap (≥0.55).
 */
export function igdbTitleMatchesSeed(expectedName: string, igdbName: string): boolean {
  const expected = normalizeTitle(expectedName)
  const igdb = normalizeTitle(igdbName)
  if (!expected || !igdb) return false
  if (igdb.includes(expected) || expected.includes(igdb)) return true
  return tokenOverlap(expectedName, igdbName) >= 0.55
}

export function igdbHasSteamAppId(
  igdbGame: IgdbGameLike,
  steamAppId: string | number | null | undefined
): boolean {
  const expectedSteamAppId = normalizeSteamAppId(steamAppId)
  if (!expectedSteamAppId || !Array.isArray(igdbGame.external_games)) return false

  return igdbGame.external_games.some((entry) => {
    return isSteamExternalGame(entry) && normalizeSteamAppId(entry.uid) === expectedSteamAppId
  })
}

/**
 * Returns true when an IGDB result can safely enrich a seed.
 * A known Steam AppID is authoritative; title similarity alone is too weak for
 * sequels, remasters, DLC, and regional names that share substrings.
 */
export function igdbGameMatchesSeed(
  expectedName: string,
  igdbGame: IgdbGameLike,
  steamAppId?: string | number | null
): boolean {
  if (normalizeSteamAppId(steamAppId)) {
    return igdbHasSteamAppId(igdbGame, steamAppId)
  }

  return igdbTitleMatchesSeed(expectedName, typeof igdbGame.name === 'string' ? igdbGame.name : '')
}
