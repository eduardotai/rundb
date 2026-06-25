import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseSteamReleaseYear,
  appDetailsToSeed,
  filterNewSeeds,
} from '../lib/server/discover-steam-games'

test('parseSteamReleaseYear extracts a 4-digit year from a Steam date string', () => {
  assert.equal(parseSteamReleaseYear('19 May, 2026'), 2026)
  assert.equal(parseSteamReleaseYear('Feb 27, 2026'), 2026)
})

test('parseSteamReleaseYear returns null when no year is present', () => {
  assert.equal(parseSteamReleaseYear('Coming soon'), null)
  assert.equal(parseSteamReleaseYear(undefined), null)
})

test('appDetailsToSeed maps a recent game to a SeedGame with a normalized slug', () => {
  const res = {
    success: true,
    data: {
      type: 'game',
      name: "Assassin's Creed Shadows",
      steam_appid: 3159330,
      release_date: { coming_soon: false, date: '20 Mar, 2025' },
    },
  }
  assert.deepEqual(appDetailsToSeed('3159330', res, { sinceYear: 2025, includeUnreleased: false }), {
    name: "Assassin's Creed Shadows",
    slug: 'assassins-creed-shadows',
    steamAppId: '3159330',
  })
})

test('appDetailsToSeed drops non-game types', () => {
  const res = {
    success: true,
    data: { type: 'dlc', name: 'Some DLC', release_date: { coming_soon: false, date: '1 Jan, 2026' } },
  }
  assert.equal(appDetailsToSeed('111', res, { sinceYear: 2025, includeUnreleased: false }), null)
})

test('appDetailsToSeed drops games older than sinceYear', () => {
  const res = {
    success: true,
    data: { type: 'game', name: 'Old Game', release_date: { coming_soon: false, date: '5 Nov, 2019' } },
  }
  assert.equal(appDetailsToSeed('222', res, { sinceYear: 2025, includeUnreleased: false }), null)
})

test('appDetailsToSeed gates coming-soon titles behind includeUnreleased', () => {
  const res = {
    success: true,
    data: { type: 'game', name: 'Future Game', release_date: { coming_soon: true, date: 'Coming soon' } },
  }
  assert.equal(appDetailsToSeed('333', res, { sinceYear: 2025, includeUnreleased: false }), null)
  assert.deepEqual(appDetailsToSeed('333', res, { sinceYear: 2025, includeUnreleased: true }), {
    name: 'Future Game',
    slug: 'future-game',
    steamAppId: '333',
  })
})

test('appDetailsToSeed returns null when the appdetails request was unsuccessful', () => {
  assert.equal(appDetailsToSeed('444', { success: false }, { sinceYear: 2025, includeUnreleased: false }), null)
  assert.equal(appDetailsToSeed('444', undefined, { sinceYear: 2025, includeUnreleased: false }), null)
})

test('filterNewSeeds returns only games absent by slug or steamAppId', () => {
  const discovered = [
    { name: 'New Game A', slug: 'new-game-a', steamAppId: '111' },
    { name: 'Existing By Slug', slug: 'exists-slug', steamAppId: '222' },
    { name: 'Existing By AppId', slug: 'new-app', steamAppId: '999' },
    { name: 'Another New', slug: 'another-new', steamAppId: '333' },
  ]
  const existing = [
    { slug: 'exists-slug', steam_app_id: '222' },
    { slug: 'other', steam_app_id: '999' },
  ]
  const fresh = filterNewSeeds(discovered, existing)
  assert.equal(fresh.length, 2)
  assert.deepEqual(fresh.map((s) => s.slug), ['new-game-a', 'another-new'])
})

test('filterNewSeeds is a no-op when no existing', () => {
  const discovered = [{ name: 'Only', slug: 'only', steamAppId: '1' }]
  assert.deepEqual(filterNewSeeds(discovered, []), discovered)
})

test('filterNewSeeds treats missing steam_app_id as absent', () => {
  const discovered = [{ name: 'X', slug: 'x', steamAppId: '42' }]
  const existing = [{ slug: 'y', steam_app_id: null }]
  assert.equal(filterNewSeeds(discovered, existing).length, 1)
})
