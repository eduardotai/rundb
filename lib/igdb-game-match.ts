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

/** Token overlap ratio (0–1) for fuzzy title comparison. */
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
