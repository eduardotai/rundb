/**
 * Pure ranking for the home "Trending right now" section.
 *
 * Trending = games with the most NEW reports in a recent window. When fewer than
 * `limit` games have recent reports, remaining slots are filled from a fallback
 * sample (the newest-N reports overall) so the row is never sparse. Kept free of
 * Supabase/React imports so it is unit-testable in isolation.
 */

export interface TrendingRankRow {
  gameId: string
  createdAt: string // ISO
}

interface Tally {
  gameId: string
  count: number
  latest: number // ms epoch of most recent report
}

function tally(rows: TrendingRankRow[]): Map<string, Tally> {
  const byGame = new Map<string, Tally>()
  for (const r of rows) {
    if (!r.gameId) continue
    const ts = new Date(r.createdAt).getTime()
    const t = byGame.get(r.gameId)
    if (t) {
      t.count += 1
      if (ts > t.latest) t.latest = ts
    } else {
      byGame.set(r.gameId, { gameId: r.gameId, count: 1, latest: Number.isNaN(ts) ? 0 : ts })
    }
  }
  return byGame
}

/** Sort by count desc, then most-recent report desc, then gameId for stability. */
function rankTallies(byGame: Map<string, Tally>): string[] {
  return [...byGame.values()]
    .sort((a, b) => b.count - a.count || b.latest - a.latest || a.gameId.localeCompare(b.gameId))
    .map((t) => t.gameId)
}

export function rankTrendingGameIds(
  recentRows: TrendingRankRow[],
  fallbackRows: TrendingRankRow[],
  limit: number,
): { ids: string[]; recentCounts: Record<string, number> } {
  const recentTally = tally(recentRows)
  const ids = rankTallies(recentTally).slice(0, limit)

  const recentCounts: Record<string, number> = {}
  for (const t of recentTally.values()) recentCounts[t.gameId] = t.count

  if (ids.length < limit && fallbackRows.length > 0) {
    const chosen = new Set(ids)
    for (const gameId of rankTallies(tally(fallbackRows))) {
      if (ids.length >= limit) break
      if (chosen.has(gameId)) continue
      chosen.add(gameId)
      ids.push(gameId)
    }
  }

  return { ids, recentCounts }
}
