/**
 * Lightweight IGDB search result validation - rejects obvious title mismatches
 * before wrong cover art is ingested into game_media.
 */

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => (isVersionToken(token) ? canonicalVersionToken(token) : token))
}

function isVersionToken(token: string): boolean {
  return /^\d+$/.test(token) || /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(token)
}

function canonicalVersionToken(token: string): string {
  const roman: Record<string, string> = {
    i: '1',
    ii: '2',
    iii: '3',
    iv: '4',
    v: '5',
    vi: '6',
    vii: '7',
    viii: '8',
    ix: '9',
    x: '10',
  }
  return roman[token] ?? token
}

function versionTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter(isVersionToken).map(canonicalVersionToken))
}

function sameVersions(a: string[], b: string[]): boolean {
  const versionsA = versionTokens(a)
  const versionsB = versionTokens(b)
  if (versionsA.size !== versionsB.size) return false
  for (const version of versionsA) {
    if (!versionsB.has(version)) return false
  }
  return true
}

function isTokenPrefix(shorter: string[], longer: string[]): boolean {
  if (shorter.length >= longer.length) return false
  return shorter.every((token, idx) => token === longer[idx])
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
  const tokensA = new Set(titleTokens(a))
  const tokensB = new Set(titleTokens(b))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let shared = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) shared++
  }
  return shared / Math.max(tokensA.size, tokensB.size)
}

/**
 * Returns true when an IGDB result plausibly matches the seed game name.
 * Requires exact normalized equality, a safe subtitle/edition prefix match,
 * or very strong token overlap. Sequel/version tokens must agree so "Hades"
 * cannot match "Hades II" and "Counter-Strike" cannot match "Counter-Strike 2".
 */
export function igdbTitleMatchesSeed(expectedName: string, igdbName: string): boolean {
  const expected = normalizeTitle(expectedName)
  const igdb = normalizeTitle(igdbName)
  if (!expected || !igdb) return false
  if (expected === igdb) return true

  const expectedTokens = titleTokens(expectedName)
  const igdbTokens = titleTokens(igdbName)
  if (!sameVersions(expectedTokens, igdbTokens)) return false

  if (
    isTokenPrefix(expectedTokens, igdbTokens) ||
    isTokenPrefix(igdbTokens, expectedTokens)
  ) {
    return true
  }

  return tokenOverlap(expectedName, igdbName) >= 0.85
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
