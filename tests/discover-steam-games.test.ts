import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseSteamReleaseYear,
  appDetailsToSeed,
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
