import assert from 'node:assert/strict'
import test from 'node:test'

import { rankTrendingGameIds, type TrendingRankRow } from './trending'

function row(gameId: string, createdAt: string): TrendingRankRow {
  return { gameId, createdAt }
}

test('ranks games by recent report count, descending', () => {
  const recent: TrendingRankRow[] = [
    row('a', '2026-06-01T00:00:00Z'),
    row('a', '2026-06-02T00:00:00Z'),
    row('b', '2026-06-03T00:00:00Z'),
    row('a', '2026-06-04T00:00:00Z'),
    row('b', '2026-06-04T00:00:00Z'),
    row('c', '2026-06-01T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 6)
  assert.deepEqual(result.ids, ['a', 'b', 'c'])
  assert.deepEqual(result.recentCounts, { a: 3, b: 2, c: 1 })
})

test('breaks count ties by most recent report first', () => {
  const recent: TrendingRankRow[] = [
    row('old', '2026-06-01T00:00:00Z'),
    row('new', '2026-06-05T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 6)
  assert.deepEqual(result.ids, ['new', 'old'])
})

test('fills remaining slots from fallback without duplicating recent games', () => {
  const recent: TrendingRankRow[] = [row('a', '2026-06-04T00:00:00Z')]
  const fallback: TrendingRankRow[] = [
    row('a', '2026-05-01T00:00:00Z'),
    row('b', '2026-05-02T00:00:00Z'),
    row('b', '2026-05-03T00:00:00Z'),
    row('c', '2026-05-04T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, fallback, 3)
  assert.deepEqual(result.ids, ['a', 'b', 'c'])
  // fill games are not added to recentCounts
  assert.deepEqual(result.recentCounts, { a: 1 })
})

test('with zero recent reports, result is purely the fallback ordering', () => {
  const fallback: TrendingRankRow[] = [
    row('x', '2026-05-01T00:00:00Z'),
    row('y', '2026-05-02T00:00:00Z'),
    row('y', '2026-05-03T00:00:00Z'),
  ]
  const result = rankTrendingGameIds([], fallback, 6)
  assert.deepEqual(result.ids, ['y', 'x'])
  assert.deepEqual(result.recentCounts, {})
})

test('respects the limit', () => {
  const recent: TrendingRankRow[] = [
    row('a', '2026-06-01T00:00:00Z'),
    row('b', '2026-06-02T00:00:00Z'),
    row('c', '2026-06-03T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 2)
  assert.deepEqual(result.ids, ['c', 'b'])
})

test('empty inputs yield an empty result', () => {
  const result = rankTrendingGameIds([], [], 6)
  assert.deepEqual(result.ids, [])
  assert.deepEqual(result.recentCounts, {})
})
