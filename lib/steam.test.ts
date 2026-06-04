import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STEAM_LINK_STATE_TTL_MS,
  createSteamLinkState,
  validateSteamLinkState,
} from './steam'

test('createSteamLinkState produces a parseable user-bound state', () => {
  const state = createSteamLinkState('user-123', 1_000, 'nonce-abc')

  assert.equal(state, 'user-123:1000:nonce-abc')
  assert.deepEqual(validateSteamLinkState({ state, cookieValue: state, now: 1_000 }), {
    ok: true,
    userId: 'user-123',
    createdAt: 1_000,
    nonce: 'nonce-abc',
  })
})

test('validateSteamLinkState rejects callbacks without the initiating browser cookie', () => {
  const state = createSteamLinkState('victim-user', 1_000, 'attacker-steam-flow')

  assert.deepEqual(validateSteamLinkState({ state, now: 1_000 }), {
    ok: false,
    reason: 'state_mismatch',
  })
  assert.deepEqual(
    validateSteamLinkState({ state, cookieValue: 'other-user:1000:other-nonce', now: 1_000 }),
    { ok: false, reason: 'state_mismatch' }
  )
})

test('validateSteamLinkState rejects missing, malformed, and expired state', () => {
  assert.deepEqual(validateSteamLinkState({ state: null, cookieValue: undefined }), {
    ok: false,
    reason: 'missing_state',
  })

  assert.deepEqual(validateSteamLinkState({ state: 'not-enough-parts', cookieValue: 'not-enough-parts' }), {
    ok: false,
    reason: 'invalid_state',
  })

  const expired = createSteamLinkState('user-123', 1_000, 'nonce-abc')
  assert.deepEqual(
    validateSteamLinkState({
      state: expired,
      cookieValue: expired,
      now: 1_000 + STEAM_LINK_STATE_TTL_MS + 1,
    }),
    { ok: false, reason: 'state_expired' }
  )
})
