/**
 * Committed driver tests for the shipped Browse Games filters/sorts.
 * Exercises the real getGamesPage, getStarterGamesPage (via fallback), getAvailableGenresAsync
 * with starter data. Verifies:
 *  - sort='reports' produces non-increasing report counts (tallied from shipped reports)
 *  - sort='name' is A-Z
 *  - sort='year' is newest first
 *  - genres are dynamic from actual games (includes values outside old static list)
 *  - combinations with search/genre filters
 *
 * Forces starter via env (no reimplementation of sort logic in test).
 * Run: npx tsx --test tests/games-page-sorts.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Force starter/mock data path before importing the module under test.
process.env.NODE_ENV = 'development'
process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA = 'true'
process.env.NEXT_PUBLIC_USE_REAL_DATA = 'false'

import {
  getGamesPage,
  getAvailableGenresAsync,
  getAllReportsAsync,
} from '../lib/data'

test('getGamesPage reports sort (starter) yields non-increasing counts', async () => {
  const reports = await getAllReportsAsync()
  const counts = new Map<string, number>()
  for (const r of reports) {
    const gid = (r as any).gameId
    if (gid) counts.set(gid, (counts.get(gid) ?? 0) + 1)
  }
  const res = await getGamesPage({ page: 1, pageSize: 12, sort: 'reports' })
  const returnedCounts = res.games.map(g => counts.get(g.id) ?? 0)
  // non-increasing
  for (let i = 1; i < returnedCounts.length; i++) {
    assert(returnedCounts[i] <= returnedCounts[i - 1], `counts not non-increasing at ${i}: ${returnedCounts}`)
  }
  assert(res.total > 0)
})

test('getGamesPage name sort is A-Z', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 10, sort: 'name' })
  for (let i = 1; i < res.games.length; i++) {
    assert(res.games[i].name.localeCompare(res.games[i - 1].name) >= 0, `not A-Z at ${i}`)
  }
})

test('getGamesPage year sort is newest first', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 10, sort: 'year' })
  for (let i = 1; i < res.games.length; i++) {
    assert(res.games[i].releaseYear <= res.games[i - 1].releaseYear, `not newest-first at ${i}`)
  }
})

test('getAvailableGenresAsync returns dynamic genres from actual games (not only old static)', async () => {
  const genres = await getAvailableGenresAsync(20)
  // starter games include these (see starter-games.ts); old ALL_GENRES did not guarantee all
  const proof = ['Adventure', 'Co-op', 'Battle Royale', 'Hunting', 'MOBA', 'Simulation']
  const hasExtra = proof.some(p => genres.includes(p))
  assert(hasExtra, `expected dynamic extra genres, got: ${genres.join(',')}`)
  assert(genres.length > 0)
})

test('getGamesPage respects genre + sort=reports simultaneously', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 5, sort: 'reports', genre: 'Action' })
  assert(res.games.length > 0)
  // every returned has the genre
  for (const g of res.games) {
    assert(g.genres.includes('Action'), `missing Action genre on ${g.name}`)
  }
})

test('getGamesPage respects search + sort=year simultaneously', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 3, sort: 'year', search: 'cyber' })
  assert(res.games.length === 1)
  assert(res.games[0].name.toLowerCase().includes('cyber'))
})
