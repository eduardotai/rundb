import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  igdbGameMatchesSeed,
  igdbHasSteamAppId,
  igdbTitleMatchesSeed,
} from '../lib/igdb-game-match'

test('title matching alone can accept a sequel substring', () => {
  assert.equal(igdbTitleMatchesSeed('Dead Space', 'Dead Space 2'), true)
})

test('known Steam AppIDs must match before an IGDB result can enrich a seed', () => {
  const deadSpace2 = {
    name: 'Dead Space 2',
    external_games: [{ category: 1, uid: '47780' }],
  }

  assert.equal(igdbHasSteamAppId(deadSpace2, '17470'), false)
  assert.equal(igdbGameMatchesSeed('Dead Space', deadSpace2, '17470'), false)
})

test('matching Steam AppIDs are authoritative even when names differ', () => {
  const regionalTitle = {
    name: 'Apex Legends: Global Series',
    external_games: [{ external_game_source: 1, uid: 1172470 }],
  }

  assert.equal(igdbGameMatchesSeed('Apex Legends', regionalTitle, '1172470'), true)
})
