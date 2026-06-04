import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createSteamLinkState,
  STEAM_LINK_STATE_TTL_MS,
  validateSteamLinkState,
} from '../lib/steam'

test('Steam link state validates only when the callback state matches the session cookie', () => {
  const state = createSteamLinkState('user-123', 1_700_000_000_000, 'nonce-abc')

  assert.deepEqual(validateSteamLinkState({
    state,
    cookieValue: state,
    now: 1_700_000_001_000,
  }), {
    ok: true,
    userId: 'user-123',
    createdAt: 1_700_000_000_000,
    nonce: 'nonce-abc',
  })

  assert.deepEqual(validateSteamLinkState({
    state,
    cookieValue: undefined,
    now: 1_700_000_001_000,
  }), {
    ok: false,
    reason: 'state_mismatch',
  })

  assert.deepEqual(validateSteamLinkState({
    state,
    cookieValue: 'user-123:1700000000000:attacker',
    now: 1_700_000_001_000,
  }), {
    ok: false,
    reason: 'state_mismatch',
  })
})

test('Steam link state expires after the configured callback window', () => {
  const state = createSteamLinkState('user-123', 1_700_000_000_000, 'nonce-abc')

  assert.deepEqual(validateSteamLinkState({
    state,
    cookieValue: state,
    now: 1_700_000_000_000 + STEAM_LINK_STATE_TTL_MS + 1,
  }), {
    ok: false,
    reason: 'state_expired',
  })
})
