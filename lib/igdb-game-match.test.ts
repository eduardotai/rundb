import assert from 'node:assert/strict'
import test from 'node:test'

import { igdbTitleMatchesSeed } from './igdb-game-match'

test('accepts exact and safe subtitle matches', () => {
  assert.equal(igdbTitleMatchesSeed("Baldur's Gate 3", 'Baldurs Gate 3'), true)
  assert.equal(igdbTitleMatchesSeed('The Witcher 3: Wild Hunt', 'The Witcher 3'), true)
  assert.equal(igdbTitleMatchesSeed('Hades II', 'Hades 2'), true)
})

test('rejects sequel and franchise false positives', () => {
  assert.equal(igdbTitleMatchesSeed('Counter-Strike 2', 'Counter-Strike'), false)
  assert.equal(igdbTitleMatchesSeed('Hades', 'Hades II'), false)
  assert.equal(igdbTitleMatchesSeed('Resident Evil 4', 'Resident Evil 2'), false)
})

test('rejects unrelated low-overlap titles', () => {
  assert.equal(igdbTitleMatchesSeed('Starfield', 'The Outer Worlds'), false)
})
